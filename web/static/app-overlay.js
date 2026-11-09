//
// The whole point of P2 is that what you see is what the disk path writes
// (AGENTS §5.2), so this module composites with the *same* semantics the PDF
// ExtGState will carry: globalCompositeOperation = the blend name, globalAlpha =
// the opacity, ctx.filter = brightness/saturate (preview-only fields). The
// measured parity values (docs/FACTS §1.3) live in tools/verify/overlay-smoke.mjs
// and in internal/pdfcore/blend_test.go; both sides read the same vocabulary.
//
// Two hard-won facts drive the structure:
//  - ctx.filter / globalCompositeOperation are *context state*: every layer sets
//    them explicitly and wraps in save/restore, and repaint() restores the page
//    bitmap from a snapshot (FACTS §1.4 - the pollution bug this guards against).
//  - the page canvas size = CSS px x DPR (AGENTS/PROJECT_MAP), and the page
//    context is re-transformed to DPR scale right after the snapshot restore, so
//    the seal rect is expressed in page points exactly like pdf.js's viewport.
//
// The affordance DOM mirrors docs/ui/mockup.html (§6): one .instance wrapper per
// stamp instance, holding the .sel-box with five .handle [data-handle=nw|ne|sw|se|rot].
// The mock paints its fake seal into `.instance-seal`; the real app composites
// the seal on the *page* canvas instead (repaint + the FACTS §1.3 pixel parity),
// because a second layer would dilute the blend - so the wrapper carries the
// affordance only, and the per-instance canvas stays offscreen as the probe-only
// backing surface for probe('instancePixels').
// Box visibility is state-gated (css: html[data-state=stamp-*]); SP4
// (2026-11-05) gives cross-page instances the same affordance - the strip is
// selectable, its move drag is the vertical startOffset channel, and the
// corner/rotation handles scale and rotate the whole seal (every page's strip
// repaints from the one instance's parameters).
(() => {
  "use strict";

  const doc = window.document;

  // BLEND_GCO maps the frozen vocabulary (UI_SPEC §2) to the canvas keyword.
  // `normal` is not a valid gco name; `multiply`/`screen`/... are identical.
  const BLEND_GCO = {
    normal: "source-over",
    multiply: "multiply",
    mult: "multiply",
    screen: "screen",
    overlay: "overlay",
    darken: "darken",
    lighten: "lighten",
    "color-dodge": "color-dodge",
    "color-burn": "color-burn",
    "hard-light": "hard-light",
    "soft-light": "soft-light",
    difference: "difference",
    exclusion: "exclusion",
    hue: "hue",
    saturation: "saturation",
    color: "color",
    luminosity: "luminosity",
  };

  // ANCHOR resolves the page-anchor vocabulary to the anchor point in page
  // points (the UI_SPEC §2 pair tl/tc/tr/center/bl/br); offset is applied on top.
  const ANCHOR = {
    tl: (w) => [0, 0],
    tc: (w) => [w / 2, 0],
    tr: (w) => [w, 0],
    center: (w, h) => [w / 2, h / 2],
    bl: (w, h) => [0, h],
    br: (w, h) => [w, h],
  };

  const state = {
    canvas: null,
    ctx: null,
    scale: 1,
    dpr: 1,
    meta: null,
    page: 0,
    snapshot: null,
    // The canvas element the snapshot belongs to: renderCurrent swaps in a new
    // canvas for every render, so element identity is the signal that the page
    // content itself may be different (a stamp, an undo, a different asset).
    surface: null,
    nodes: new Map(), // instanceId -> { wrap, canvas, box, handles }
    rects: new Map(), // instanceId -> page-space rect of the painted box
    strips: new Map(), // instanceId -> strip context of the current page
    // Z4: rotated whole-seal canvases for cross-page instances, keyed
    // "<sealId>|<deg>" (drag slider hands are integers, so the cache is small
    // and stable); the bitmapOf for an instance comes from here when set.
    rotCache: new Map(),
    drag: null,
  };

  const q = (sel) => doc.querySelector(sel);
  const shell = () => window.__autoStampShell;
  const preview = () => window.__autoStampPreview;
  const sealModule = () => window.__autoStampSeal;

  function num(v, dflt) {
    const n = Number(v);
    return Number.isFinite(n) ? n : dflt;
  }

  function parsePair(v, dx, dy) {
    if (typeof v !== "string") return [dx, dy];
    const m = v.split(/[,;\s]+/).filter(Boolean).map(Number);
    if (m.length < 2 || !m.every(Number.isFinite)) return [dx, dy];
    return [m[0], m[1]];
  }

  // parsePages resolves the `pages` field ("all" | "1,3" | "2-4") to page numbers.
  function parsePages(raw, pageCount) {
    const all = [];
    for (let p = 1; p <= pageCount; p += 1) all.push(p);
    if (raw === undefined || raw === null || raw === "" || raw === "all") return all;
    const out = [];
    for (const part of String(raw).split(/[,;\s]+/).filter(Boolean)) {
      const m = part.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) continue;
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;
      for (let p = Math.min(a, b); p <= Math.max(a, b); p += 1) {
        if (p >= 1 && p <= pageCount && !out.includes(p)) out.push(p);
      }
    }
    return out.length ? out : all;
  }

  // rotatedBitmapCanvas bakes the whole-seal rotation into a canvas sized to
  // the rotated bbox (Z4, 2026-11-09: 骑缝章 rotates the WHOLE seal first, the
  // slice columns come out of the turned bitmap, upright on every page). The
  // dims formula is the exact mirror of pdfcore.RotatePNG - both sides derive
  // the strip-box aspect from these px dims so preview and disk cannot drift.
  // ctx.rotate(+deg) turns screen-clockwise (display space, y down), which is
  // also the direction the plain stamp path uses and what RotatePNG samples.
  function rotatedBitmapCanvas(img, deg) {
    const rad = (deg * Math.PI) / 180;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    const wR = Math.max(1, Math.round(img.width * cos + img.height * sin));
    const hR = Math.max(1, Math.round(img.width * sin + img.height * cos));
    const c = doc.createElement("canvas");
    c.width = wR;
    c.height = hR;
    const ctx = c.getContext("2d");
    ctx.translate(wR / 2, hR / 2);
    ctx.rotate(rad);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    return c;
  }

  // effectiveBitmap is the seal the geometry and the paint code work against:
  // a cross-page instance with a rotation paints the ROTATED whole bitmap (the
  // strips slice it column-wise), everything else paints the raw one. The disk
  // mirror is pdfcore addInstance -> RotatePNG -> Strips.
  function effectiveBitmap(inst) {
    const raw = sealModule() ? sealModule().bitmapOf(inst.sealId) : null;
    if (!raw) return null;
    const p = inst.params || {};
    if (!p["api.apply.crossPage"]) return raw;
    const deg = num(p["api.apply.rotation"], 0);
    if (!deg) return raw;
    const key = `${inst.sealId}|${deg}`;
    let c = state.rotCache.get(key);
    if (!c) {
      c = rotatedBitmapCanvas(raw, deg);
      state.rotCache.set(key, c);
      if (state.rotCache.size > 8) {
        // keep the cache bounded: one entry per (seal, angle) is plenty for
        // live drags; oldest entries fall out.
        const oldest = state.rotCache.keys().next().value;
        state.rotCache.delete(oldest);
      }
    }
    return c;
  }

  // rectFor computes the seal rect in *page* points (display space, origin at
  // top-left, y down - the UI_SPEC §2 convention). `strip` narrows the rect to
  // the i-th slice of the seal at the binding edge.
  function rectFor(inst, meta, opts) {
    if (!inst || !meta) return null;
    const img = effectiveBitmap(inst);
    if (!img) return null;
    const p = inst.params || {};
    const pageW = meta.width;

    // HD12: 10% floor as before, but the ceiling moved 0.9 -> 5: corner drags
    // and the +/- keys can pass the slider's 200% (the slider stretches to
    // show the overshoot, the server vocabulary accepts up to 5). V7 (2026-11-05)
    // removed the wheel from this list: Ctrl+wheel is the whole-page zoom now.
    const clamp = (v) => Math.max(0.05, Math.min(5, v));
    const scale = clamp(num(p["api.apply.scale"], 0.202));
    const aspect = img.height && img.width ? img.height / img.width : 1;

    const strip = opts && opts.strip ? opts.strip : null;
    const fullW = scale * pageW;
    const frac = strip && strip.frac !== undefined ? strip.frac : 1 / (strip ? strip.count : 1);
    const w = strip ? fullW * frac : fullW;
    const h = fullW * aspect;
    const off = parsePair(p["api.apply.offset"], 0, 0);

    if (strip) {
      // Cross-page (UI_SPEC §2/§8, decision D2 + SP4 + N4): the band hugs
      // the binding edge and only startOffset moves it along the page — and
      // since N4 (2026-11-09) that channel is a PERCENT (0..100): 0% pins the
      // strip bottom to the page bottom, 100% pins its top to the page top.
      // travel = pageH − whole-box h (the strip h, fullW×aspect), so
      // y = (1 − pct/100) × travel (negative travel = box taller than the
      // page, formula still pins both ends). The disk mirror is
      // pdfcore StampGeom.Box (same formula); the plain offset channel stays
      // ignored - the strip's horizontal slot IS the binding edge.
      const start = num(p["api.apply.startOffset"], 0);
      const x = strip.edge === "left" ? 0 : pageW - w;
      const y = (1 - start / 100) * (meta.height - h);
      return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, strip };
    }

    const name = ANCHOR[p["api.apply.anchor"]] ? p["api.apply.anchor"] : "center";
    const [ax0, ay0] = ANCHOR[name](pageW, meta.height);
    const ax = ax0 + off[0];
    const ay = ay0 + off[1];
    let left = ax;
    let top = ay;
    if (name === "tr" || name === "br") left = ax - w;
    if (name === "center") left = ax - w / 2;
    if (name === "bl" || name === "br") top = ay - h;
    if (name === "center") top = ay - h / 2;
    return { x: left, y: top, w, h, cx: left + w / 2, cy: top + h / 2 };
  }

  // stripContext picks the strip this page shows: D2 keeps single-sided strips
  // on the right edge, duplex alternates odd=right / even=left. Z5 adds the
  // per-slot share: an instance with explicit api.apply.slices (the 随机 draw
  // in app-shell-instances) gets that fraction and the cumulative start; a
  // fraction of 0 means this page sits in a binding gap and shows nothing.
  // Without slices the classic even split runs (frac = 1/count).
  function stripContext(inst, pages) {
    const index = pages.indexOf(state.page);
    if (index < 0) return null;
    const p = (inst.params || {});
    const binding = p["ui.crosspage.binding"] || "right";
    if (binding === "none") return null;
    const useLeft = binding === "alternate" && pages[index] % 2 === 0;
    const count = pages.length;
    const slices = Array.isArray(p["api.apply.slices"]) && p["api.apply.slices"].length
      ? p["api.apply.slices"] : null;
    let frac = 1 / count;
    let cum = index / count;
    if (slices) {
      frac = Math.max(0, Math.min(1, Number(slices[index]) || 0));
      cum = 0;
      for (let i = 0; i < index; i += 1) cum += Math.max(0, Number(slices[i]) || 0);
    }
    return { index, count, binding, edge: useLeft ? "left" : "right", frac, cum };
  }

  // paint is app-preview's hook: the canvas is the freshly rendered page here,
  // so the snapshot capture happens before any seal is drawn.
  function paint(ctx, info) {
    if (!info || !info.canvas) return;
    state.canvas = info.canvas;
    state.ctx = ctx;
    state.scale = info.scale;
    state.dpr = info.dpr || 1;
    state.meta = info.meta;
    state.page = info.page;

    // Re-capture whenever the preview hands over a different canvas element.
    // The old key (page/scale/dpr/size) cannot see a document swap: after
    // `盖到 PDF` the same page at the same zoom has the same size, and the
    // previous document's bitmap got painted straight back over the fresh
    // render - measured 2026-11-02, where the read-back canvas kept showing
    // the pre-stamp page (0 ink anywhere) while the applied asset rendered
    // fine in a fresh pdf.js document.
    if (state.surface !== info.canvas || !state.snapshot) {
      const snap = doc.createElement("canvas");
      snap.width = info.canvas.width;
      snap.height = info.canvas.height;
      snap.getContext("2d").drawImage(info.canvas, 0, 0);
      state.snapshot = snap;
      state.surface = info.canvas;
    }
    layoutNodes();
    repaint();
    syncAffordance();
  }

  // repaint re-composites over the snapshot. It is the cheap drag path (no
  // pdf.js render) and it runs the same drawing code, so the two paths cannot
  // drift apart.
  function repaint() {
    const canvas = state.canvas;
    const ctx = state.ctx;
    if (!canvas || !ctx || !state.snapshot) return;
    const { dpr, scale } = state;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(state.snapshot, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    state.rects = new Map();
    state.strips = new Map();

    const s = shell();
    if (!s || !state.meta) return;
    const pageCount = preview() ? preview().pageCount() : 1;

    for (const inst of s.state.instances) {
      if (!inst.sealId) continue;
      const img = effectiveBitmap(inst);
      if (!img) continue;
      const params = inst.params || {};
      const pages = parsePages(params["api.apply.pages"], pageCount);
      if (!pages.includes(state.page)) continue;

      let strip = null;
      if (params["api.apply.crossPage"]) {
        strip = stripContext(inst, pages);
        if (!strip) continue;
        // Z5 gap page: a fraction of 0 means the binding left this page
        // unsealable. The probe entry stays (count stays honest); no rect,
        // no affordance, no pixels.
        if (strip.frac <= 0) {
          state.strips.set(inst.id, strip);
          continue;
        }
      }

      const rect = rectFor(inst, state.meta, { strip });
      if (!rect) continue;
      state.rects.set(inst.id, rect);
      if (strip) state.strips.set(inst.id, strip);
      drawSeal(ctx, img, rect, params, strip, scale);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
  }

  function drawSeal(ctx, img, rect, params, strip, scale) {
    const p = params || {};
    // UI_SPEC §2: multiply / 正片叠底 is the shipped default (AGENTS §5.39 Z1);
    // an unset or unknown blend name lands there, never on source-over.
    const blend = BLEND_GCO[p["api.apply.blend"]] ? p["api.apply.blend"] : "multiply";
    const opacity = Math.max(0, Math.min(1, num(p["api.apply.opacity"], 1)));
    const brightness = Math.max(0, num(p["api.apply.brightness"], 1));
    const saturate = Math.max(0, num(p["api.apply.saturate"], 1));
    // Z4: a strip's rotation is already BAKED into the whole-seal bitmap
    // (effectiveBitmap), so the slot itself draws upright; only the plain
    // instance rotates live around the box centre.
    const rotation = strip ? 0 : num(p["api.apply.rotation"], 0);

    ctx.save();
    // FACTS §1.4: filter is context state. Everything is set explicitly and
    // save/restore keeps a leak from poisoning the next layer.
    ctx.filter = "none";
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = BLEND_GCO[blend];
    if (brightness !== 1 || saturate !== 1) {
      ctx.filter = `brightness(${brightness}) saturate(${saturate})`;
    }

    // Z5: the source slice starts at the slot's cumulative share (content
    // continuity across the binding gutter) and spans that slot's fraction;
    // the classic even split uses exactly the same math (frac = 1/count,
    // cum = index/count).
    const cum = strip ? (strip.cum !== undefined ? strip.cum : strip.index / strip.count) : 0;
    const fr = strip ? (strip.frac !== undefined ? strip.frac : 1 / strip.count) : 1;
    const sx = img.width * cum;
    const sw = img.width * fr;
    ctx.translate(rect.cx * scale, rect.cy * scale);
    if (rotation) ctx.rotate((rotation * Math.PI) / 180);
    // The destination box is the page slot (strip width / full box); the source
    // slice is the i-th band of the seal image.
    ctx.drawImage(
      img,
      sx,
      0,
      sw,
      img.height,
      -(rect.w / 2) * scale,
      -(rect.h / 2) * scale,
      rect.w * scale,
      rect.h * scale
    );
    ctx.restore();
  }

  // ---------- per-instance DOM (docs/ui/mockup.html §6 vocabulary) ----------

  function ensureNodes() {
    const layer = q("#stamp-layer");
    const s = shell();
    if (!layer || !s) return;
    const live = new Set();
    for (const inst of s.state.instances) {
      live.add(inst.id);
      const node = state.nodes.get(inst.id);
      if (node) {
        // the preview re-renders the stage (new frame, new #stamp-layer), so a
        // node that fell out of the document has to be re-attached here.
        if (!node.wrap.isConnected) layer.append(node.wrap);
        continue;
      }
      const crossPage = Boolean(inst.params && inst.params["api.apply.crossPage"]);
      const wrap = doc.createElement("div");
      wrap.className = "instance";
      wrap.dataset.instance = String(inst.id);
      wrap.dataset.role = "stamp-instance";
      wrap.dataset.mode = crossPage ? "crosspage" : "normal";
      wrap.dataset.selected = "false";
      const box = doc.createElement("div");
      box.className = "sel-box";
      box.dataset.stampFor = String(inst.id);
      box.dataset.role = "stamp-box";
      const label = doc.createElement("span");
      label.className = "sr-only";
      label.dataset.i18n = "stamp.box.aria";
      label.dataset.i18nCn = "选中印章实例的位置";
      label.textContent = "Selected stamp instance position";
      box.append(label);
      // probe-only backing surface; deliberately NOT appended to the wrapper.
      // Attaching it used to paint the seal a second time next to the page
      // canvas composite (the 25%-ghost bug, 2026-11-04: the DOM copy draws
      // the seal at natural size inside the fit-scaled box, so only the top
      // left portion is visible and it lands over the real composite).
      const canvas = doc.createElement("canvas");
      canvas.dataset.instance = String(inst.id);
      canvas.dataset.role = "stamp-canvas";
      const handles = [];
      for (const name of ["nw", "ne", "sw", "se", "rot"]) {
        const h = doc.createElement("span");
        h.className = "handle";
        h.dataset.handle = name;
        h.dataset.role = "stamp-handle";
        h.setAttribute("aria-label", name);
        box.append(h);
        handles.push(h);
      }
      wrap.append(box);
      layer.append(wrap);
      state.nodes.set(inst.id, { wrap, canvas, box, handles });
      bindAffordance(box);
    }
    for (const [id, node] of Array.from(state.nodes.entries())) {
      if (live.has(id)) continue;
      node.wrap.remove();
      state.nodes.delete(id);
    }
  }

  // layoutNodes sizes each selection box to the painted rect, and refreshes
  // the offscreen probe canvas for the instance (device pixels = CSS px x DPR).
  function layoutNodes() {
    const s = shell();
    if (!s) return;
    for (const [id, node] of state.nodes.entries()) {
      const rect = state.rects.get(id);
      if (!rect) continue;
      const wCss = Math.max(1, Math.round(rect.w * state.scale));
      const hCss = Math.max(1, Math.round(rect.h * state.scale));
      node.box.style.left = `${rect.x * state.scale}px`;
      node.box.style.top = `${rect.y * state.scale}px`;
      node.box.style.width = `${wCss}px`;
      node.box.style.height = `${hCss}px`;
      // The backing canvas keeps the device-pixel box of the rect so the
      // instancePixels probe reads the same seal the page canvas shows.
      node.canvas.width = Math.round(wCss * state.dpr);
      node.canvas.height = Math.round(hCss * state.dpr);
      drawInstanceCanvas(node.canvas, id);
    }
    void s;
  }

  // drawInstanceCanvas paints one instance onto its offscreen probe canvas. It
  // runs the same drawing code as the page composite (drawSeal) so the probe
  // can never diverge from what the user sees; the canvas itself is never
  // attached to the document (single-draw contract).
  function drawInstanceCanvas(canvas, id) {
    const s = shell();
    const inst = s && s.instanceById(id);
    const img = inst ? effectiveBitmap(inst) : null;
    const rect = state.rects.get(id);
    if (!img || !rect) return;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    const local = {
      x: 0, y: 0, w: rect.w, h: rect.h,
      cx: rect.w / 2, cy: rect.h / 2,
    };
    const strip = state.strips.get(id) || null;
    drawSeal(ctx, img, local, inst.params || {}, strip, 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
  }

  // syncAffordance keeps the selected/hidden state honest: only the selected
  // instance gets data-selected="true" (css shows its box), and the mode flag
  // (crosspage vs normal) is what css paints the green strip box + ns-resize
  // cursor with (SP4: cross-page keeps its handles).
  function syncAffordance() {
    ensureNodes();
    layoutNodes();
    const s = shell();
    const selected = s ? s.selectedInstance() : null;
    for (const [id, node] of state.nodes.entries()) {
      const inst = s ? s.instanceById(id) : null;
      const crossPage = Boolean(inst && inst.params && inst.params["api.apply.crossPage"]);
      node.wrap.dataset.mode = crossPage ? "crosspage" : "normal";
      node.wrap.dataset.selected = String(Boolean(selected && selected.id === id));
    }
  }

  // ---------- interactions ----------

  function pagePoint(ev) {
    if (!state.canvas || !state.scale) return null;
    const box = state.canvas.getBoundingClientRect();
    return { x: (ev.clientX - box.left) / state.scale, y: (ev.clientY - box.top) / state.scale };
  }

  // hitTest returns the topmost instance whose box contains a page point.
  // Z4: a cross-page instance's rotation is baked into the bitmap, so its
  // strip box is axis-aligned in page space - the rotation undo below is only
  // for plain instances (where the image turns live inside the box).
  function hitTest(pt) {
    if (!pt) return null;
    const s = shell();
    if (!s) return null;
    const ids = Array.from(state.rects.keys()).reverse();
    for (const id of ids) {
      const inst = s.instanceById(id);
      if (!inst) continue;
      const rect = state.rects.get(id);
      const params = inst.params || {};
      const rot = num(params["api.apply.rotation"], 0);
      const baked = Boolean(params["api.apply.crossPage"]);
      if (!rot || baked) {
        if (pt.x >= rect.x && pt.x <= rect.x + rect.w && pt.y >= rect.y && pt.y <= rect.y + rect.h) return inst;
        continue;
      }
      // Rotated boxes are hit-tested in their own frame: undo the rotation
      // about the box centre first.
      const rad = (-rot * Math.PI) / 180;
      const dx = pt.x - rect.cx;
      const dy = pt.y - rect.cy;
      const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
      const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
      if (Math.abs(lx) <= rect.w / 2 && Math.abs(ly) <= rect.h / 2) return inst;
    }
    return null;
  }

  // selectAt is the canvas click route: pick the seal under the point, or let
  // the caller clear the selection (UI_SPEC §1's opened / stamp-selected pair).
  function selectAt(ev) {
    const inst = hitTest(pagePoint(ev));
    if (!inst) return null;
    shell().selectInstance(inst.id);
    return inst.id;
  }

  function writeOffset(dx, dy) {
    shell().setParam("api.apply.offset", `${Math.round(dx)},${Math.round(dy)}`);
  }

  // beginDrag starts a move / corner-scale / rotate drag. SP4: a cross-page
  // instance takes the move drag too - but it rides the vertical startOffset
  // channel (the strip's horizontal slot is the binding edge, UI_SPEC D2), so
  // the drag never touches the plain offset field.
  function beginDrag(ev, mode, handle) {
    const s = shell();
    const inst = s.selectedInstance();
    if (!inst) return false;
    const pt = pagePoint(ev);
    if (!pt) return false;
    const rect = state.rects.get(inst.id);
    if (!rect) return false;
    const p = inst.params || {};
    const [ox, oy] = parsePair(p["api.apply.offset"], 0, 0);
    state.drag = {
      mode,
      handle: handle || null,
      id: inst.id,
      startX: pt.x,
      startY: pt.y,
      baseOffset: [ox, oy],
      baseStart: num(p["api.apply.startOffset"], 0),
      baseScale: num(p["api.apply.scale"], 0.202),
      rect,
    };
    s.setState(mode === "move" ? "stamp-dragging" : "stamp-resizing");
    return true;
  }

  function moveDrag(ev) {
    if (!state.drag) return false;
    const pt = pagePoint(ev);
    if (!pt) return false;
    const d = state.drag;
    const dx = pt.x - d.startX;
    const dy = pt.y - d.startY;
    const inst = shell().instanceById(d.id);
    if (!inst) return false;
    const p = inst.params || {};
    switch (d.mode) {
      case "move":
        if (p["api.apply.crossPage"]) {
          // SP4 + N4: the vertical drag is the percent startOffset channel
          // (pt.y; the strip's slot is the binding edge, so dx has nothing to
          // do). y = (1 − pct/100) × travel  ⇒  Δpct = −dy/travel × 100,
          // clamped to the vocabulary range 0..100.
          const travel = state.meta ? state.meta.height - d.rect.h : d.rect.h;
          if (Math.abs(travel) > 1e-9) {
            const next = Math.max(0, Math.min(100,
              +(d.baseStart - (dy / travel) * 100).toFixed(2)));
            shell().setParam("api.apply.startOffset", next);
          }
        } else {
          // The plain instance moves by offset (pt, y down).
          writeOffset(d.baseOffset[0] + dx, d.baseOffset[1] + dy);
        }
        break;
      case "scale": {
        // A corner drag resizes around the same anchor: the new scale is the
        // width ratio. HD12: it may pass the slider's 200% - the ceiling is
        // the server vocabulary's 5, and the shell stretches the slider to
        // echo the overshoot.
        const sign = d.handle === "nw" || d.handle === "sw" ? -1 : 1;
        const ratio = d.rect.w ? (d.rect.w + dx * sign) / d.rect.w : 1;
        const next = Math.max(0.05, Math.min(5, +(d.baseScale * ratio).toFixed(4)));
        shell().setParam("api.apply.scale", next);
        break;
      }
      case "rotate": {
        const ang = (Math.atan2(pt.y - d.rect.cy, pt.x - d.rect.cx) * 180) / Math.PI - 90;
        const norm = ((ang + 180) % 360) - 180;
        shell().setParam("api.apply.rotation", Math.round(norm));
        break;
      }
      default:
        break;
    }
    repaint();
    layoutNodes();
    return true;
  }

  function endDrag() {
    if (!state.drag) return false;
    state.drag = null;
    const s = shell();
    s.setState(s.selectedInstance() ? "stamp-selected" : "opened");
    return true;
  }

  function bindAffordance(box) {
    box.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      const handle = ev.target && ev.target.dataset ? ev.target.dataset.handle : null;
      if (handle === "rot") beginDrag(ev, "rotate", handle);
      else if (handle) beginDrag(ev, "scale", handle);
      else beginDrag(ev, "move");
      if (state.drag && box.setPointerCapture) {
        try {
          box.setPointerCapture(ev.pointerId);
        } catch (e) {
          /* capture is a nicety; the stage listener covers the drag anyway */
        }
      }
    });
    box.addEventListener("pointermove", moveDrag);
    box.addEventListener("pointerup", (ev) => {
      if (box.releasePointerCapture) {
        try {
          box.releasePointerCapture(ev.pointerId);
        } catch (e) {
          /* already released */
        }
      }
      endDrag();
    });
    box.addEventListener("pointercancel", endDrag);
  }

  // bindStage owns the canvas-side press: hit-test selects (and starts the
  // move drag), and a press on empty page background clears the selection.
  // HD10: with add-seal mode on, the same empty-page press *places* a copy of
  // the current seal centered on the click instead - on the page being shown
  // (HD11), which is the whole point of the mode. SP4: with the cross-page
  // add mode on, the press places a cross-page *strip* instance - the click's
  // height becomes the percent startOffset (N4), and the strip anchors on the
  // binding edge of every page (the same instance answers on all of them).
  function bindStage() {
    const stage = q("#preview-stage");
    if (!stage) return;
    stage.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest && ev.target.closest(".instance")) return;
      const s = shell();
      const picked = selectAt(ev);
      if (!picked) {
        if (s && s.state && s.state.file && state.canvas && state.meta) {
          const pt = pagePoint(ev);
          if (pt && s.state.crosspageAdd) {
            ev.preventDefault();
            s.addCrossInstanceAt(pt);
            return;
          }
          if (pt && s.state.addMode) {
            ev.preventDefault();
            s.addInstanceAt(pt);
            return;
          }
        }
        const sh = shell();
        if (sh.selectedInstance()) sh.selectInstance(null);
        return;
      }
      beginDrag(ev, "move");
    });
    stage.addEventListener("pointermove", (ev) => {
      if (state.drag) moveDrag(ev);
    });
    doc.addEventListener("pointerup", endDrag);
    doc.addEventListener("pointercancel", endDrag);
  }

  function bindEvents() {
    const refresh = () => {
      repaint();
      syncAffordance();
    };
    doc.addEventListener("autostamp:param", refresh);
    doc.addEventListener("autostamp:seal", refresh);
    doc.addEventListener("autostamp:instance", refresh);
    doc.addEventListener("autostamp:page", () => syncAffordance());
    doc.addEventListener("autostamp:lang", () => syncAffordance());
  }


  // sample reads a page-space rectangle in *device* pixels. source="page" is
  // the snapshot (the page before any seal), source="composite" is what the
  // user sees. It is the same convention app-preview's sample() uses, and it
  // is what tools/verify/overlay-smoke.mjs compares against the blend formula.
  function sample(x, y, w, h, source) {
    const canvas = state.canvas;
    if (!canvas) return { data: new Uint8ClampedArray(0), w: 0, h: 0 };
    const ctx = source === "page" && state.snapshot ? state.snapshot.getContext("2d") : state.ctx;
    const d = ctx.getImageData(
      Math.round(x * state.scale * state.dpr),
      Math.round(y * state.scale * state.dpr),
      Math.max(1, Math.round(w * state.scale * state.dpr)),
      Math.max(1, Math.round(h * state.scale * state.dpr))
    );
    return { data: Array.from(d.data), w: d.width, h: d.height, scale: state.scale, dpr: state.dpr };
  }

  function probe(name) {
    switch (name) {
      case "rects": {
        const out = [];
        for (const r of state.rects.values()) {
          out.push({ x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.w.toFixed(2), h: +r.h.toFixed(2) });
        }
        return out;
      }
      case "strips":
        return Array.from(state.strips.entries()).map(([id, strip]) => ({
          id,
          index: strip.index,
          count: strip.count,
          edge: strip.edge,
          binding: strip.binding,
          frac: strip.frac, // Z5: this page's share of the whole seal width
          cum: strip.cum, // and its cumulative start (uneven slices)
        }));
      case "view":
        return { scale: state.scale, dpr: state.dpr, page: state.page };
      case "affordance": {
        const layer = q("#stamp-layer");
        if (!layer) return [];
        return Array.from(layer.querySelectorAll(".instance")).map((el) => {
          const box = el.querySelector(".sel-box");
          const b = box.getBoundingClientRect();
          return {
            for: el.dataset.instance,
            mode: el.dataset.mode,
            selected: el.dataset.selected === "true",
            visible: Boolean(box.getClientRects().length),
            handles: el.querySelectorAll(".handle").length,
            x: Math.round(b.left),
            y: Math.round(b.top),
            w: Math.round(b.width),
            h: Math.round(b.height),
          };
        });
      }
      case "snapshot":
        return state.snapshot
          ? {
              w: state.snapshot.width,
              h: state.snapshot.height,
              page: state.page,
              scale: +state.scale.toFixed(4),
              dpr: state.dpr,
            }
          : null;
      case "canvasRect": {
        if (!state.canvas) return null;
        const r = state.canvas.getBoundingClientRect();
        return { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
      }
      case "filter":
        return state.ctx ? state.ctx.filter || "none" : null;
      case "instancePixels": {
        // offscreen per-instance canvases (not in the DOM; the page canvas is
        // the only painted surface).
        const out = [];
        for (const [id, node] of state.nodes.entries()) {
          const c = node.canvas;
          const ctx = c.getContext("2d");
          const samples = [];
          for (const [fx, fy] of [["0.5", "0.5"], ["0.02", "0.5"], ["0.5", "0.02"]]) {
            const px = Math.round(c.width * Number(fx));
            const py = Math.round(c.height * Number(fy));
            const d = ctx.getImageData(px, py, 1, 1).data;
            samples.push([d[0], d[1], d[2], d[3]]);
          }
          out.push({ id, w: c.width, h: c.height, samples });
        }
        return out;
      }
      default:
        throw new Error(`unknown overlay probe: ${name}`);
    }
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", () => {
    bindStage();
    bindEvents();
  });
  else {
    bindStage();
    bindEvents();
  }

  window.__autoStampOverlay = {
    paint,
    repaint,
    syncAffordance,
    selectAt,
    hitTest,
    parsePages,
    sample,
    rectFor: (inst) => rectFor(inst, state.meta, {}),
    beginDrag,
    moveDrag,
    endDrag,
    probe,
    state,
  };
})();
