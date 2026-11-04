// Copyright 2026 AutoStamp Authors. SPDX-License-Identifier: Apache-2.0
// app-preview.js — P1: render an opened PDF with pdf.js into #preview-stage.
//
// AGENTS §5.1: the page bitmap is produced in the front-end, never on the
// server; the bytes come from GET /api/pdf/raw (Range-capable, http.ServeContent)
// so a 200-page document is read page by page instead of being held in memory.
//
// AGENTS §5.2: what is drawn here is the pixel contract that P4 must reproduce
// when the seal is written to disk, so the canvas keeps its natural 1:1 scale
// and the DPR factor is applied through RenderParameters.transform only.
//
// The text layer is pdf.js' own TextLayer class (FACTS §1.1: 6.4 exports it in
// build/pdf.min.mjs; the viewer's TextLayerBuilder is in web/pdf_viewer.mjs,
// which is deliberately not vendored). The CSS its spans need is the vendored
// vendor/pdfjs/web/pdf_viewer.css `.textLayer` block; the custom properties it
// reads (--total-scale-factor, --scale-round-x/y) are set here.
(() => {
  "use strict";

  const doc = document;
  const VENDOR = "./vendor/pdfjs/";

  // A page wider than this in device pixels is rendered at a reduced zoom and
  // the user is told (UI_SPEC 4 warn.render.hint): 24 MP is roughly an A4 at
  // 300 dpi with DPR off, and beyond that the canvas starts to thrash.
  const MAX_RENDER_PIXELS = 24e6;

  let pdfjs = null; // loaded once; import() of an ESM module caches by URL

  const state = {
    asset: null, // {assetId,name,pageCount,pages[]} straight from POST /api/pdf/open
    doc: null, // PDFDocumentProxy
    page: 1,
    zoom: 0, // 0 == fit-page (the whole page fits the stage; V4, UI_SPEC §8)
    pw: "", // password typed by the user, kept so Retry re-opens once
    renderTask: null,
    layer: null,
    dpr: 1,
    lastFitZoom: 0,
    lastScaleNote: "",
    destroyed: false,
  };

  const shell = () => window.__autoStampShell;
  const api = () => window.__autoStampApi;
  const q = (sel) => document.querySelector(sel);
  const t = (key) => (shell() && shell().t(key)) || key;

  // ---------- pdf.js ----------

  async function loadPdfjs() {
    if (pdfjs) return pdfjs;
    // Only an ESM build ships (FACTS §1.1), so this must be a dynamic import of
    // the exact vendored path; the CSP keeps script-src to 'self'.
    pdfjs = await import(VENDOR + "build/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = VENDOR + "build/pdf.worker.min.mjs";
    return pdfjs;
  }

  // loadParams is the one place that knows where the vendor assets live. The
  // option names all appear in pdf.mjs (FACTS §1.1); missing any of them makes
  // CJK/JPX/standard-font pages render wrong rather than fail loudly.
  function loadParams(asset) {
    return {
      url: api().rawURL(asset.assetId),
      cMapUrl: VENDOR + "cmaps/",
      cMapPacked: true,
      standardFontDataUrl: VENDOR + "standard_fonts/",
      wasmUrl: VENDOR + "wasm/",
      // The app never needs a JS-evaluated font sanitizer; disabling it keeps
      // the CSP free of 'unsafe-eval' (web/embed.go CSP, FACTS §1.5).
      isEvalSupported: false,
      // The Range/ETag traffic stays visible for the verify scripts: pdf.js fetches
      // this URL itself, so the owner token has to be handed to it explicitly,
      // otherwise /api/pdf/raw answers 400 bad_session (internal/webx/session.go).
      // httpHeaders is applied to the initial request *and* every Range request,
      // so page-2 renders keep the same identity (FACTS §1.1).
      httpHeaders: { [api().sessionHeader]: api().session() },
      disableAutoFetch: true,
      password: state.pw || undefined,
    };
  }

  // ---------- open / close ----------

  async function open(asset) {
    await close();
    state.asset = asset;
    state.page = 1;
    state.destroyed = false;
    const lib = await loadPdfjs();
    const task = lib.getDocument(loadParams(asset));
    // The loading task is the destroy handle (PDFDocumentProxy has no destroy()
    // in pdf.js 6.4: build/pdf.min.mjs, FACTS §1.1), so it has to stay around.
    state.task = task;
    state.doc = await task.promise;
    state.pages = asset.pages || [];
    state.page = 1;
    if (state.doc.numPages !== asset.pageCount) {
      // The server reported the structure once; pdf.js agrees, and if it does
      // not, that is a bug worth surfacing instead of trusting either side.
      // eslint-disable-next-line no-console
      console.warn(`page count mismatch: server ${asset.pageCount} vs pdf.js ${state.doc.numPages}`);
    }
    observeStage();
    await renderCurrent();
    return { pageCount: state.doc.numPages, page: state.page };
  }

  // Retry re-opens after the user typed a password (password-modal's pw-retry).
  async function reload(pw) {
    state.pw = pw || "";
    if (!state.asset) throw new Error("reload without an open asset");
    return open(state.asset);
  }

  async function close() {
    state.destroyed = true;
    cancelPending();
    clearLayer();
    const task = state.task;
    state.task = null;
    state.doc = null;
    if (task) {
      // destroy() terminates the worker and releases the document; a task whose
      // promise never settled rejects with the original load error, which is
      // exactly the case nothing to clean up.
      try {
        await task.destroy();
      } catch (e) {
        /* already torn down, or never opened */
      }
    }
    state.asset = null;
    state.pages = [];
    state.page = 1;
    state.zoom = 0;
    state.lastFitZoom = 0;
    const stage = q("#preview-stage");
    if (stage) stage.textContent = "";
  }

  // ---------- geometry ----------

  function pageMeta(n) {
    return (state.pages || [])[n - 1] || null;
  }

  // A viewport for the *current* page, in PDF units (scale 1 == 1 pt).
  function baseViewport(pageObj) {
    return pageObj.getViewport({ scale: 1 });
  }

  // stageWidth/stageHeight measure the layout box the page has to fit into. A
  // hidden container (html[data-state=empty] sets #preview-stage to display:none,
  // style.css) reports width/height 0, which is *not* a guessable number: the
  // callers return 0 and the ResizeObserver below defers the paint.
  function stageWidth() {
    const stage = q("#preview-stage");
    if (!stage) return 0;
    const box = stage.getBoundingClientRect();
    if (box.width <= 0) return 0;
    // The stage is a flex container with padding; the frame needs a little
    // slack (the 8 px below) away from the border edge. The stage has no
    // scrollbars any more (V5: overflow hidden in style.css), so the slack is
    // purely visual, not a scrollbar reservation.
    const style = getComputedStyle(stage);
    const pad = parseFloat(style.paddingLeft || 0) + parseFloat(style.paddingRight || 0);
    return Math.floor(box.width - pad - 8);
  }

  function stageHeight() {
    const stage = q("#preview-stage");
    if (!stage) return 0;
    const box = stage.getBoundingClientRect();
    if (box.height <= 0) return 0;
    const style = getComputedStyle(stage);
    const pad = parseFloat(style.paddingTop || 0) + parseFloat(style.paddingBottom || 0);
    return Math.floor(box.height - pad - 8);
  }

  // fitZoom: the scale that fits the *whole* page into the stage, aspect kept
  // (V4 revises the old fit-width semantics, UI_SPEC §8): neither page
  // dimension may overflow the container at fit, which is also why the stage
  // stays scrollbar-free (V5).
  function fitZoom(pageObj) {
    const vp = baseViewport(pageObj);
    const w = stageWidth();
    const h = stageHeight();
    if (!(vp.width > 0 && vp.height > 0) || w <= 0 || h <= 0) return 0;
    return Math.min(w / vp.width, h / vp.height);
  }

  function zoomValue(pageObj) {
    return state.zoom > 0 ? state.zoom : fitZoom(pageObj);
  }

  let stageObserver = null;
  let lastStageWidth = 0;
  let lastStageHeight = 0;

  function cancelPending() {
    if (state.renderTask) {
      try {
        state.renderTask.cancel();
      } catch (e) {
        /* the promise rejects with RenderingCancelledException; handled above */
      }
      state.renderTask = null;
    }
  }

  // observeStage watches the container, not the page: a window resize, the
  // panel collapse or the empty->opened transition all change the box the page
  // has to fit into, and a fit-mode page has to be re-fitted (both directions,
  // V4). An explicit zoom (Ctrl+wheel, + / -) is kept as-is; the fit note is
  // what gets recomputed instead.
  function observeStage() {
    if (stageObserver || typeof ResizeObserver !== "function") return;
    const stage = q("#preview-stage");
    if (!stage) return;
    stageObserver = new ResizeObserver(() => {
      if (!state.doc) return;
      const w = stageWidth();
      const h = stageHeight();
      if (w <= 0 || h <= 0) return;
      if (Math.abs(w - lastStageWidth) <= 2 && Math.abs(h - lastStageHeight) <= 2) return;
      lastStageWidth = w;
      lastStageHeight = h;
      if (state.zoom > 0 && !state.pendingFit) {
        // Explicit zoom: the page stays where the user put it, only the fit note
        // and the MP readout go stale, so they are what gets refreshed.
        state.doc
          .getPage(state.page)
          .then((pageObj) => {
            state.lastFitZoom = fitZoom(pageObj);
            const canvas = state.frame && state.frame.querySelector("canvas.page-canvas");
            const meta = pageMeta(state.page);
            if (!canvas) return;
            updateReadout(
              meta,
              { width: canvas.width / state.dpr, height: canvas.height / state.dpr },
              zoomValueOf(meta),
              Boolean(state.lastScaleNote)
            );
          })
          .catch(() => {});
        return;
      }
      renderCurrent();
    });
    stageObserver.observe(stage);
  }

  async function renderCurrent() {
    if (!state.doc) return null;
    cancelPending();
    clearLayer();

    const pageObj = await state.doc.getPage(state.page);
    const meta = pageMeta(state.page);
    // pdf.js' own text-layer math uses OutputScale.pixelRatio (FACTS §1.7), so
    // the canvas backing store must use the same ratio or the text layer's
    // spans land at the wrong offsets.
    const dpr = pdfjs.OutputScale ? pdfjs.OutputScale.pixelRatio : (window.devicePixelRatio || 1);
    state.dpr = dpr;

    let scale = zoomValue(pageObj);
    if (!(scale > 0)) {
      // The stage has no measurable width right now (open() can run while the
      // shell still hides #preview-stage in the empty state). Painting at the
      // old 240 px floor would fit a page into nothing; the ResizeObserver
      // installed by observeStage() renders as soon as the container has a
      // real width, so nothing is thrown away here.
      state.pendingFit = true;
      return null;
    }
    let vp = pageObj.getViewport({ scale });
    let pixels = Math.round(vp.width * dpr) * Math.round(vp.height * dpr);
    let reduced = false;
    if (pixels > MAX_RENDER_PIXELS) {
      scale = Math.max(0.02, scale * Math.sqrt(MAX_RENDER_PIXELS / pixels));
      vp = pageObj.getViewport({ scale });
      pixels = Math.round(vp.width * dpr) * Math.round(vp.height * dpr);
      reduced = true;
    }

    const stage = q("#preview-stage");
    // #stamp-layer is contract markup (index.html), and the affordance nodes
    // live inside the *page frame* so its inset:0 box covers the canvas
    // exactly - the page-point -> client-point maths depends on that anchor.
    let layer = doc.getElementById("stamp-layer");
    if (!layer) {
      layer = doc.createElement("div");
      layer.id = "stamp-layer";
      layer.setAttribute("aria-hidden", "true");
    }
    const frame = doc.createElement("div");
    frame.className = "page-frame";
    frame.dataset.page = String(state.page);
    const canvas = doc.createElement("canvas");
    canvas.className = "page-canvas";
    frame.appendChild(canvas);
    stage.replaceChildren(frame);
    frame.appendChild(layer);
    state.frame = frame;

    const cssW = Math.floor(vp.width);
    const cssH = Math.floor(vp.height);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.round(vp.width * dpr);
    canvas.height = Math.round(vp.height * dpr);

    const ctx = canvas.getContext("2d", { alpha: false });
    state.renderTask = pageObj.render({
      canvasContext: ctx,
      viewport: vp,
      transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0],
      background: "#ffffff",
    });
    try {
      await state.renderTask.promise;
    } catch (e) {
      if (e && e.name === "RenderingCancelledException") return null;
      throw e;
    } finally {
      state.renderTask = null;
    }

    state.lastFitZoom = fitZoom(pageObj);
    state.lastScale = scale;
    state.pendingFit = false;
    state.lastScaleNote = reduced ? `${scale.toFixed(3)}` : "";

    // The text layer is an overlay: it must not change what the canvas drew,
    // and it must not break the render if the page has no text at all.
    await attachTextLayer(pageObj, vp, frame);

    // P2: seals are drawn *into* this canvas (not a DOM layer) because the
    // blend modes have to composite against the page pixels — the measured
    // preview == disk equivalence in FACTS §1.3 only holds on this path.
    // A missing overlay module (P2 not loaded) never breaks the page.
    await paintSeals(ctx, { page: state.page, meta, scale, dpr });

    updateReadout(meta, vp, scale, reduced);
    doc.dispatchEvent(new CustomEvent("autostamp:page", { detail: { page: state.page, pageCount: pageCount() } }));
    return { page: state.page, width: vp.width, height: vp.height, scale, dpr, reduced };
  }

  async function attachTextLayer(pageObj, viewport, frame) {
    const layer = window.__autoStampTextLayer;
    if (!layer) return;
    try {
      state.layer = await layer.attach({ pdfjs, pageObj, viewport, frame, dpr: state.dpr });
    } catch (e) {
      // A missing text layer never fails the page: the canvas already drew it.
      // eslint-disable-next-line no-console
      console.warn("text layer skipped:", e && e.message);
      state.layer = null;
    }
  }

  function clearLayer() {
    if (state.layer && state.layer.cancel) {
      try {
        state.layer.cancel();
      } catch (e) { /* already finished */ }
    }
    if (state.layer && state.layer.div && state.layer.div.parentNode) {
      state.layer.div.remove();
    }
    state.layer = null;
  }

  // The ruler and the readout are i18n-tagged elements; the numbers are appended
  // to the localized label instead of replacing it, so applyLang() and this
  // function do not fight over the text (applyLang re-fires this via
  // "autostamp:lang").
  function updateReadout(meta, vp, scale, reduced) {
    const ruler = q("#preview-ruler");
    const readout = q("#pixel-readout");
    if (!ruler || !readout) return;
    const wPt = meta ? meta.width : vp.width;
    const hPt = meta ? meta.height : vp.height;
    ruler.textContent = `${t("ruler.hint")} ${fmtPt(wPt)} × ${fmtPt(hPt)} pt`;
    const mp = (Math.round(vp.width * state.dpr) * Math.round(vp.height * state.dpr)) / 1e6;
    readout.textContent = `${Math.round(vp.width)} × ${Math.round(vp.height)} px · scale ${scale.toFixed(3)} · ${mp.toFixed(1)} MP`;
    if (reduced && shell()) {
      shell().toast("warn", `${t("warn.render.hint")} (${mp.toFixed(1)} MP)`);
    }
  }

  const fmtPt = (n) => (Math.round(n * 10) / 10).toFixed(1);

  // ---------- navigation / zoom ----------

  const pageCount = () => (state.doc ? state.doc.numPages : (state.asset && state.asset.pageCount) || 0);

  async function goTo(n) {
    if (!state.doc) return null;
    const max = pageCount();
    const want = Math.min(Math.max(1, n | 0), max);
    if (want === state.page) return { page: state.page, pageCount: max };
    state.page = want;
    await renderCurrent();
    return { page: state.page, pageCount: max };
  }

  async function next() { return goTo(state.page + 1); }
  async function prev() { return goTo(state.page - 1); }

  // Zooming is a view property: UI_SPEC §5's Ctrl+wheel row names apply.scale
  // as its field, which is only true once an instance owns the wheel (P2). In
  // P1 nothing is selected, so the wheel zooms the view.
  async function zoomBy(step) {
    if (!state.doc) return null;
    const pageObj = await state.doc.getPage(state.page);
    const current = zoomValue(pageObj);
    state.zoom = Math.min(8, Math.max(0.05, current + step));
    return renderCurrent();
  }

  async function zoomTo(value) {
    if (!state.doc) return null;
    state.zoom = Math.min(8, Math.max(0.05, value));
    return renderCurrent();
  }

  async function fit() {
    if (!state.doc) return null;
    state.zoom = 0;
    return renderCurrent();
  }

  // ---------- panning + fit-reset (V4–V6, UI_SPEC §8) ----------
  // The stage shows no scrollbars (V5: overflow hidden, style.css). When the
  // page is zoomed beyond the container the view pans programmatically:
  // Space + arrow keys, Space + left-drag, and the wheel. All of them move
  // scrollLeft/scrollTop, and the browser's own offset clamping pins the page
  // edges to the container edges - a pan can never drag an image edge across
  // the container edge to reveal empty stage background (V5).
  // Ctrl + middle button restores the fit (V6).
  const pan = { space: false, pointer: null };

  function panStage(dx, dy) {
    const stage = q("#preview-stage");
    if (!stage) return false;
    const x0 = stage.scrollLeft;
    const y0 = stage.scrollTop;
    stage.scrollLeft = x0 + dx;
    stage.scrollTop = y0 + dy;
    // out-of-range assignments clamp natively: this is the edge rule.
    return stage.scrollLeft !== x0 || stage.scrollTop !== y0;
  }

  function endPanDrag() {
    const stage = q("#preview-stage");
    if (!pan.pointer) return;
    pan.pointer = null;
    if (stage) {
      delete stage.dataset.pan;
      if (pan.space !== undefined && pan.space) stage.dataset.pan = "space";
    }
  }

  function bindPan() {
    const stage = q("#preview-stage");
    if (!stage || stage.dataset.panBound) return;
    stage.dataset.panBound = "1";

    const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

    // Capture phase on purpose: the shell's ←↑↓→ nudge (stamp position) and
    // the stage's own select-on-press must stay quiet while Space is held.
    doc.addEventListener(
      "keydown",
      (e) => {
        if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || "")) return;
        if (e.code === "Space" && !e.ctrlKey && !e.altKey && !e.metaKey) {
          // Space is the pan modifier; swallow its native half (page scroll,
          // focused-button activation) while it is held.
          if (!pan.space) {
            pan.space = true;
            stage.dataset.pan = "space";
          }
          e.preventDefault();
          return;
        }
        if (pan.space && ARROWS[e.key]) {
          e.preventDefault();
          e.stopPropagation();
          const step = Math.max(40, Math.round(Math.min(stage.clientWidth, stage.clientHeight) * 0.15));
          panStage(ARROWS[e.key][0] * step, ARROWS[e.key][1] * step);
        }
      },
      true
    );
    doc.addEventListener("keyup", (e) => {
      if (e.code !== "Space" || !pan.space) return;
      pan.space = false;
      endPanDrag();
      delete stage.dataset.pan;
    });
    // Losing the window while Space is held must not leave a stuck modifier.
    window.addEventListener("blur", () => {
      pan.space = false;
      endPanDrag();
      delete stage.dataset.pan;
    });

    stage.addEventListener(
      "pointerdown",
      (e) => {
        // V6: Ctrl + middle button = back to fit (also kills the autoscroll).
        if (e.button === 1 && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          e.stopPropagation();
          fit();
          return;
        }
        // V5: Space + left button = grab-pan the stage, not the stamp.
        if (pan.space && e.button === 0) {
          e.preventDefault();
          e.stopPropagation();
          pan.pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, left: stage.scrollLeft, top: stage.scrollTop };
          stage.dataset.pan = "drag";
          if (stage.setPointerCapture) {
            try {
              stage.setPointerCapture(e.pointerId);
            } catch {
              /* capture is a nicety */
            }
          }
        }
      },
      true
    );
    stage.addEventListener("pointermove", (e) => {
      if (!pan.pointer || e.pointerId !== pan.pointer.id) return;
      e.preventDefault();
      stage.scrollLeft = pan.pointer.left + (pan.pointer.x - e.clientX);
      stage.scrollTop = pan.pointer.top + (pan.pointer.y - e.clientY);
    });
    const stopPan = (e) => {
      if (pan.pointer && e.pointerId === pan.pointer.id) endPanDrag();
    };
    stage.addEventListener("pointerup", stopPan);
    stage.addEventListener("pointercancel", stopPan);

    // Plain wheel pans the view (the old native scroll kept working without a
    // visible scrollbar); Ctrl+wheel stays the zoom gesture (V3, app-shell).
    stage.addEventListener(
      "wheel",
      (e) => {
        if (e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        panStage(e.deltaX || 0, e.deltaY || 0);
      },
      { passive: false }
    );
  }

  // ---------- pixel probes (AGENTS §8) ----------

  // sample returns the RGBA of a PDF-unit square patch anchored in the current
  // page: x,y,w,h are PDF points, so the verify script can compare the seal's
  // preview pixels against the hand-computed formula without knowing the zoom.
  function sample(x, y, w, h) {
    const frame = state.frame;
    if (!frame) throw new Error("no page rendered");
    const canvas = frame.querySelector("canvas.page-canvas");
    if (!canvas) throw new Error("no page canvas");
    const ctx = canvas.getContext("2d");
    const scale = zoomValueOf(pageMeta(state.page));
    const sx = Math.round(x * scale * state.dpr);
    const sy = Math.round(y * scale * state.dpr);
    const sw = Math.max(1, Math.round(w * scale * state.dpr));
    const sh = Math.max(1, Math.round(h * scale * state.dpr));
    const data = ctx.getImageData(sx, sy, sw, sh).data;
    return { x: sx, y: sy, w: sw, h: sh, dpr: state.dpr, scale, data: Array.from(data) };
  }

  function zoomValueOf(meta) {
    // The last render stored the effective scale; recover it from the canvas
    // size so a probe never has to trust a stale state field.
    const canvas = state.frame && state.frame.querySelector("canvas.page-canvas");
    if (!canvas || !meta || !meta.width) return 1;
    return canvas.width / state.dpr / meta.width;
  }

  function probe(name) {
    switch (name) {
      case "page":
        return state.page;
      case "pageCount":
        return pageCount();
      case "asset":
        return state.asset ? { assetId: state.asset.assetId, name: state.asset.name, kind: state.asset.kind } : null;
      case "zoom":
        // The effective scale, not the raw state field: in fit mode state.zoom
        // stays 0 and the verify scripts need the value that actually painted.
        return state.zoom > 0 ? state.zoom : state.lastScale || state.lastFitZoom || 0;
      case "fitZoom":
        return state.lastFitZoom;
      case "dpr":
        return state.dpr;
      case "canvas": {
        const canvas = state.frame && state.frame.querySelector("canvas.page-canvas");
        if (!canvas) return null;
        const box = canvas.getBoundingClientRect();
        return {
          backing: [canvas.width, canvas.height],
          css: [Math.round(box.width), Math.round(box.height)],
          page: Number(state.frame.dataset.page),
        };
      }
      case "textLayer": {
        if (!state.layer || !state.layer.div) return { spans: 0, box: null };
        const spans = state.layer.div.querySelectorAll("span");
        const box = state.layer.div.getBoundingClientRect();
        return { spans: spans.length, box: [Math.round(box.width), Math.round(box.height)] };
      }
      case "reduced":
        return state.lastScaleNote;
      case "pan": {
        // The pan contract (V5): offset + native clamp bounds, so the verify
        // scripts can assert the edges never cross the container edges.
        const stage = q("#preview-stage");
        if (!stage) return null;
        return {
          x: Math.round(stage.scrollLeft),
          y: Math.round(stage.scrollTop),
          maxX: Math.max(0, stage.scrollWidth - stage.clientWidth),
          maxY: Math.max(0, stage.scrollHeight - stage.clientHeight),
          space: pan.space,
          overflowing: stage.scrollWidth > stage.clientWidth || stage.scrollHeight > stage.clientHeight,
        };
      }
      default:
        throw new Error(`unknown preview probe: ${name}`);
    }
  }

  // paintSeals hands the composited page canvas to the overlay module. The
  // overlay is optional by design: P1 renders without any seal layer, and the
  // hook keeps P2's drawing code out of the pdf.js pipeline.
  async function paintSeals(ctx, info) {
    const overlay = window.__autoStampOverlay;
    if (!overlay || !overlay.paint) return false;
    try {
      await overlay.paint(ctx, {
        ...info,
        canvas: state.frame && state.frame.querySelector("canvas.page-canvas"),
      });
      return true;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("seal layer skipped:", e && e.message);
      return false;
    }
  }

  window.__autoStampPreview = {
    state,
    // setPassword must run before open(): the password goes into getDocument,
    // so a re-open of a protected document needs it set first.
    setPassword: (pw) => { state.pw = pw || ""; },
    open,
    reload,
    close,
    goTo,
    next,
    prev,
    zoomBy,
    zoomTo,
    fit,
    panStage,
    // The overlay repaints without re-fetching the document.
    redraw: renderCurrent,
    pageCount,
    pageMeta,
    sample,
    probe,
    // The pager module needs the live document to build thumbnails lazily.
    getPage: (n) => (state.doc ? state.doc.getPage(n) : Promise.reject(new Error("no document"))),
  };

  // A language switch re-composes the readouts (they carry data-i18n, so the
  // shell's applyLang already rewrote them; this event puts the numbers back).
  doc.addEventListener("autostamp:lang", () => {
    if (!state.frame) return;
    const meta = pageMeta(state.page);
    const canvas = state.frame.querySelector("canvas.page-canvas");
    if (!meta || !canvas) return;
    const vp = { width: canvas.width / state.dpr, height: canvas.height / state.dpr };
    updateReadout(meta, vp, zoomValueOf(meta), Boolean(state.lastScaleNote));
  });

  // The pan/fit gestures bind once against the static stage markup.
  bindPan();
})();
