// Copyright 2026 AutoStamp Authors. SPDX-License-Identifier: Apache-2.0
// app-shell-docops.js — part of the app-shell module group (split from
// app-shell.js on 2026-11-05; docs/IMPLEMENTATION_PLAN.md §10.1). the document funnel: open/load gate + adopt + split/stamp/undo + save.
(() => {
  "use strict";

  const S = window.__autoStampShell;
  const q = (sel, root) => (root || document).querySelector(sel);
  const qa = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const doc = document;
  const html = doc.documentElement;
  const api = window.__autoStampApi;
  const state = S.state;


  // submitSave posts the real /api/pdf/save route (AGENTS §6). The target has
  // exactly three channels and the server rejects an ambiguous request, so the
  // front-end picks one (SV1): replaceOriginal for the §7 drive twin,
  // otherwise the path the native save dialog reported (state.saveTarget).
  //
  // W1 已确认: an instance that is still only a preview gets baked first, so
  // 保存 never silently drops what the user is looking at. A failed bake aborts
  // the save - writing the document without the seal would be worse.
  async function submitSave(replaceOriginal) {
    if (state.instances.some((i) => i.sealId)) {
      const baked = await stampIntoPDF({ quiet: true });
      if (!baked) return;
    }
    if (!state.file) {
      S.toast("error", S.t("err.apply.noDoc"));
      return;
    }
    // W5: raster save chain. mode=vector never sends /api/pdf/export (源资产
    // 直接写); mode=raster bakes the selected pages first, so the file on disk
    // IS the flattened document. A failed export aborts the save - writing the
    // non-rasterised document behind the user's back would be worse.
    if ((S.readField("api.export.mode") || "vector") === "raster") {
      // W6: block on the per-page estimate BEFORE anything goes out; the
      // network log must stay empty when this fires.
      const est = S.computeEstimate();
      if (est && est.perPageBytes > S.MAX_EXPORT_PAGE_BYTES) {
        S.toast("warn", S.t("warn.export.tooBig"));
        return;
      }
      // A second 保存 of an already-flattened document must not re-bake: the
      // extra JPEG generation is visible quality loss. It re-bakes only when
      // the document is not the export asset (undo, a new seal, a new open) or
      // when the user changed dpi/quality/pages — that is a new write intent.
      const spec = S.exportSpecOf();
      const bake = S.exportLastBake();
      const rebake =
        !bake || bake.assetId !== state.file.assetId || bake.key !== S.exportKeyOf(spec);
      if (rebake) {
        const exported = await S.exportRaster();
        if (!exported) return;
      }
    }
    const body = { assetId: state.file.assetId, replaceOriginal: Boolean(replaceOriginal) };
    if (!replaceOriginal) body.targetPath = state.saveTarget || "";
    try {
      const res = await api.request("/api/pdf/save", { method: "POST", body });
      state.assets.save = res && res.assetId ? res.assetId : state.file.assetId;
      S.renderAssetHooks();
      S.setModal(null);
      S.setState("opened");
      S.toast("ok", res && res.message ? res.message : S.t("ok.saved"));
    } catch (e) {
      S.toast("error", `${e.code}: ${e.message}`);
    }
  }



  // ---------- open: the local-file channel (P1, AGENTS §6) ----------
  //
  // Two ways in: the native picker (#btn-open / #empty-pick) and the §7 drive
  // channel openByPath(path) (HD19: the path box is gone from the empty state).
  // Drag and paste land in the same submitFiles funnel. Every channel ends in
  // adopt(), which is the only place that changes the document state.

  // pickAndOpen asks the server to show the native dialog. A cancel is normal
  // (no toast); an unsupported platform just gets the error toast (HD19 left
  // no path box to fall back to).
  async function pickAndOpen() {
    let res;
    try {
      res = await api.pick({ filter: "pdf", multi: true });
    } catch (e) {
      S.toast("error", `${e.code}: ${e.message}`);
      return;
    }
    state.lastGrant = res && res.picks && res.picks[0] ? res.picks[0].pathGrantId : "";
    S.renderAssetHooks();
    if (!res || res.cancelled || !res.picks || !res.picks.length) return;
    if (res.picks.length > 1) {
      // The extra grants are real (owner-bound, TTL): P6's batch flow consumes
      // them. P1 opens the first one and keeps the rest in the console.
      console.info("extra picks (batch flow is P6):", res.picks.slice(1).map((p) => p.path));
    }
    await openGrant(res.picks[0], "");
  }


  // openByPath is the §7 drive channel (HD19): it takes the path as an
  // argument. POST /api/fs/pick with filePath grants an existing file without
  // a dialog (UI_SPEC §2 api.fs.pick.filePath, ctl=no). No UI input reads it.
  async function openByPath(arg) {
    const path = String(arg == null ? "" : arg).trim();
    if (!path) {
      S.toast("error", "openByPath: empty path");
      return;
    }
    let res;
    try {
      res = await api.pick({ filePath: path, filter: "pdf" });
    } catch (e) {
      S.toast("error", `${e.code}: ${e.message}`);
      return;
    }
    if (!res || !res.picks || !res.picks.length) return;
    state.lastGrant = res.picks[0].pathGrantId;
    S.renderAssetHooks();
    await openGrant(res.picks[0], "");
  }


  async function openGrant(pick, pw) {
    state.pending = { kind: "grant", pick };
    try {
      const info = await api.openGrant(pick.pathGrantId, { pw, name: pick.path });
      state.pending = null;
      return await adopt(info);
    } catch (e) {
      return openFailed(e);
    }
  }


  // handleFiles is the multipart upload route: it is reached from the paste/drop
  // gate below, which has already rejected everything but a single PDF (PD1/PD2).
  async function handleFiles(files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    if (list.length > 1) console.info("extra dropped files (batch flow is P6):", list.map((f) => f.name));
    const file = list[0];
    state.pending = { kind: "file", file };
    try {
      const info = await api.uploadPDF(file, "");
      state.pending = null;
      return await adopt(info);
    } catch (e) {
      return openFailed(e);
    }
  }


  // ---------- PD1/PD2: the load gate (UI_SPEC §8) ----------
  //
  // submitFiles is the single funnel for paste + drop. classifyLoad encodes
  // the accepted shapes: "one PDF" (open it) or "images only, one or many"
  // (load as seals). Any other list (multiple PDFs, PDF+image mix, foreign
  // files) is refused with a named reason - never silently swallowed, and
  // never loaded. The upload buttons bypass the gate by design (their input
  // accepts .pdf only).
  const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|webp|tiff?)$/i;

  const isImageFile = (f) => (f.type || "").startsWith("image/") || IMAGE_EXT.test(f.name || "");

  const isPdfFile = (f) => (f.type || "") === "application/pdf" || /\.pdf$/i.test(f.name || "");


  function classifyLoad(files) {
    if (!files.length) return "empty";
    let imgs = 0;
    let pdfs = 0;
    for (const f of files) {
      if (isImageFile(f)) imgs += 1;
      else if (isPdfFile(f)) pdfs += 1;
      else return "other";
    }
    if (pdfs && imgs) return "mix";
    if (pdfs) return files.length === 1 ? "pdf" : "multi";
    if (imgs === files.length) return "seals";
    return "other";
  }


  let loadLog = null;

  function noteLoad(kind, reason, files) {
    loadLog = { kind, reason: reason || "", names: (files || []).map((f) => f.name), count: (files || []).length };
  }


  // rollbackInstance / instanceNameFor are gone with HD17: loading a seal
  // never creates or repairs an instance any more.
  async function loadSeals(files) {
    // HD17 (2026-11-05): loading a seal NEVER touches the instance list - every
    // source (paste / drag / header upload / recent dropdown) only prepares the
    // bytes and sets the current seal. Placement lives exclusively in add-seal
    // mode (and the explicit "Add instance" button), which snapshots whatever
    // seal is current at creation time.
    noteLoad("seals", "", files);
    const seal = window.__autoStampSeal;
    if (!seal) {
      S.toast("error", "seal module unavailable");
      return 0;
    }
    let ok = 0;
    for (const f of files) {
      if (await seal.upload(f)) ok += 1;
    }
    if (files.length > 1) S.toast("ok", `${S.t("load.seals.ok")} ×${ok}/${files.length}`);
    return ok;
  }


  function submitFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return null;
    const cls = classifyLoad(files);
    if (cls === "pdf") {
      noteLoad("pdf", "", [files[0]]);
      return handleFiles([files[0]]);
    }
    if (cls === "seals") return loadSeals(files);
    noteLoad("reject", cls, files);
    const key = cls === "multi" ? "load.reject.multi.hint"
      : cls === "mix" ? "load.reject.mix.hint" : "load.reject.other.hint";
    S.toast("warn", S.t(key));
    return null;
  }


  // openFailed maps the contract codes onto the states the UI can show. A
  // missing password is the documented flow: the modal asks for one string that
  // the server then tries as UserPW *and* OwnerPW (internal/pdfcore/read.go).
  function openFailed(e) {
    if (e.code === "password_required" || e.code === "password_invalid") {
      S.setModal("password-modal");
      S.setState("password-error");
      S.toast(e.code === "password_required" ? "warn" : "error", `${e.code}: ${e.message}`);
      return;
    }
    S.toast("error", `${e.code}: ${e.message}`);
    S.setState(state.file ? "opened" : "empty");
  }


  // retryOpen replays the open that failed, now with the typed password. The
  // string goes to the server (structure) and to pdf.js (pages), so both read
  // the same document.
  async function retryOpen() {
    if (!state.pending) {
      S.setModal(null);
      S.setState(state.file ? "opened" : "empty");
      return;
    }
    const pw = S.readField("api.open.pw") || "";
    const { kind, pick, file } = state.pending;
    let info;
    try {
      info = kind === "grant"
        ? await api.openGrant(pick.pathGrantId, { pw, name: pick.path })
        : await api.uploadPDF(file, pw);
    } catch (e) {
      openFailed(e);
      return;
    }
    state.pending = null;
    S.setModal(null);
    await adopt(info, pw);
  }


  // pickSaveTarget (the old "pick a file, then re-type the path" pair) died
  // with SV1: the save modal now asks the backend for ONE native save-as
  // dialog ({save:true} on /api/fs/pick, AGENTS §6) and saves what the dialog
  // reports. The name box is pre-filled with same-name + .stamp.pdf, and the
  // browse starts at the document's own folder (info.path from pdf/open).
  async function saveViaDialog() {
    if (!state.file) {
      S.toast("error", S.t("err.apply.noDoc"));
      return;
    }
    const defaultName = S.baseName(state.file.name || "document") + ".stamp.pdf";
    let startDir = "";
    if (state.file.path) {
      const parts = String(state.file.path).split(/[\\/]+/);
      parts.pop();
      startDir = parts.join("\\");
    }
    let res;
    try {
      res = await api.request("/api/fs/pick", {
        method: "POST",
        body: { save: true, filter: "pdf", defaultName, startDir },
      });
    } catch (e) {
      S.toast("error", `${e.code}: ${e.message}`);
      return;
    }
    if (!res || res.cancelled || !res.targetPath) return; // cancel = quiet
    await saveToPath(res.targetPath);
  }

  // saveToPath is the §7 drive channel (SV1): name the target explicitly and
  // run the same save chain the button uses. The verify scripts use it
  // instead of clicking #save-confirm, because clicking would show the real
  // native dialog and a headless run cannot answer it.
  async function saveToPath(path) {
    state.saveTarget = String(path == null ? "" : path).trim();
    if (!state.saveTarget) {
      S.toast("error", "saveToPath: empty path");
      return;
    }
    const chip = S.q("#save-dest");
    if (chip) chip.textContent = state.saveTarget;
    await submitSave(false);
  }

  // submitReplace is the §7 drive twin of the (unreachable from the UI since
  // SV1) 替换原文件 confirmation: the S1 channel stays, the modal stays,
  // nothing else calls submitSave(true).
  async function submitReplace() {
    await submitSave(true);
  }


  // adopt is the one document-change funnel: metadata from the server, pixels
  // from pdf.js, and the state machine in one place. `opts.from` tells it
  // whether this is a fresh open ("open") or a derived swap ("split"/"apply"):
  // a derived swap keeps the document's title (a split/stamp is the same file)
  // and drops nothing but the D3 veto chips, whose page numbers just changed.
  // A fresh open must forget both undo chains, or 撤销 would re-point at a
  // session asset that belongs to a different document.
  async function adopt(info, pw, opts) {
    // "open" is a fresh open, not a swap: only split/apply/export re-point the
    // preview onto an asset that descends from the current document.
    const derived = Boolean(opts && opts.from && opts.from !== "open");
    // The server reports the raw MediaBox plus /Rotate. Everything the UI
    // measures (pdf.js canvas, overlay frame, strip previews, estimate area)
    // is the *display* frame, so the page list is normalised once here: swap
    // the sides when /Rotate is 90 or 270 and forget the rotation, exactly as
    // internal/pdfcore/stamp.go DisplaySize does on the write side.
    const pages = S.normalisePages(info.pages || []);
    info.pages = pages;
    const name = derived ? (state.file && state.file.name) || info.name : info.name;
    // SV1: the disk original from pdf/open (openResult.path) rides in
    // state.file.path — the save dialog browses to it, the replace confirmation
    // shows it, and derived swaps carry it forward (split/apply/export answer
    // with the same origin).
    const path = info.path || (derived && state.file && state.file.path) || "";
    state.file = { assetId: info.assetId, name, path, size: info.size, pages };
    state.lastInfo = info;
    if (!derived) {
      state.assets.open = info.assetId;
      // A new document invalidates every derived asset id that is still on the
      // screen; leaving stale ids would let Save point at a dead session file.
      state.assets.split = "";
      state.assets.apply = "";
      state.assets.export = "";
      state.assets.save = "";
      state.splitChain = null;
      state.applyChain = null;
    } else {
      state.assets[opts.from] = info.assetId;
    }
    state.vetoed = new Set();
    S.refreshEstimate();
    S.setDocTitle();
    S.renderAssetHooks();
    // The state flips *before* the first paint on purpose: #preview-stage is
    // display:none in the empty S.state(style.css), so pdf.js would otherwise
    // compute its fit-zoom against a zero-size container and the page would
    // land at the wrong scale. The document is already open at this point (the
    // server answered), so entering "opened" here is truthful; a render failure
    // surfaces as a toast with an empty stage.
    S.setState("opened");
    const p = window.__autoStampPreview;
    if (p) {
      if (p.setPassword) p.setPassword(pw || "");
      await p.open(info);
    }
    // The rail (app-pager) rebuilds on this event; a derived swap counts too,
    // because the page count is what changed (split adds, stamp does not).
    S.notify("autostamp:open", info);
    if (info.pages && info.pages.length && !info.pages.some((pg) => pg.hasFonts)) {
      // UI_SPEC 4: a document whose pages are only images has nothing to
      // extract; say so instead of letting the search box look broken.
      S.toast("warn", S.t("warn.noText.hint"));
    }
    return info;
  }


  // splitModeOf maps the retired panel segment words onto the server
  // vocabulary. SP1: with the split panel gone there is no control left; the
  // heuristic ("auto") is the default and the §7 drive API (runSplit(opts))
  // overrides per call.
  function splitModeOf() {
    const manual = S.readField("ui.split.mode") || "off";
    if (manual === "v2") return "rows-cols";
    if (manual === "h2") return "rows-cols";
    if (manual === "grid") return "rows-cols";
    return "auto";
  }


  // splitGridOf honours the segment: 2-up LR is 1x2, 2-up TB is 2x1, and only
  // "grid" reads the rows/cols boxes (otherwise those boxes would silently
  // override what the segment says).
  function splitGridOf(mode) {
    if (mode === "v2") return { rows: 1, cols: 2 };
    if (mode === "h2") return { rows: 2, cols: 1 };
    return {
      rows: Number(S.readField("api.split.rows")) || 1,
      cols: Number(S.readField("api.split.cols")) || 1,
    };
  }


  function cutsOf() {
    return String(S.readField("api.split.cutFractions") || "")
      .split(/[ ,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }


  // vetoedPagesOf is the D3 drive-API channel: state.vetoed answers only to
  // §7 vetoPage now (the #split-veto chip row left with the sidebar section).
  // spreadPages keeps the heuristic itself - the shell probe (and pdf.js's
  // split-mark painting) still need the "which pages are spreads" answer.
  function spreadPages() {
    const out = [];
    (state.file && state.file.pages ? state.file.pages : []).forEach((pg) => {
      const w = Number(pg.width) || 0;
      const h = Number(pg.height) || 0;
      if (w > h && w / h > 0.7) out.push(Number(pg.number) || out.length + 1);
    });
    return out;
  }

  function splitPagesFor(total) {
    const picked = S.resolvePages(S.readField("api.split.pages"), total);
    return picked.filter((n) => !state.vetoed.has(n));
  }


  // splitBodyOf is the /api/pdf/split request body (AGENTS §6). It is its own
  // function so the button and S.probe("chain") can never drift apart.
  function splitBodyOf() {
    const total = ((state.file && state.file.pages) || []).length;
    const grid = splitGridOf(S.readField("ui.split.mode"));
    return {
      splitMode: splitModeOf(),
      rows: grid.rows,
      cols: grid.cols,
      customCuts: cutsOf(),
      vetoPages: [...state.vetoed].sort((a, b) => a - b),
      splitPages: splitPagesFor(total).join(",") || "none",
    };
  }

  // runSplit posts /api/pdf/split (AGENTS §6). SP1: with the sidebar panel
  // gone this is the §7 drive API - opts overrides the (control-less) default
  // vocabulary per call, so verify scripts can pin splitMode/rows/cols/pages.
  async function runSplit(opts) {
    if (!state.file) {
      S.toast("error", S.t("err.apply.noDoc"));
      return null;
    }
    const body = { assetId: state.file.assetId, ...splitBodyOf(), ...(opts || {}) };
    let res;
    try {
      res = await api.request("/api/pdf/split", { method: "POST", body });
    } catch (e) {
      S.toast("error", `${e.code}: ${e.message}`);
      return null;
    }
    // The cut is a new page set, so the pre-cut document is what 撤销切分
    // re-opens. The veto chips reset because the page numbers moved.
    state.splitChain = { info: state.lastInfo, mode: S.readField("ui.split.mode") };
    await adopt(res, "", { from: "split" });
    S.toast("ok", S.t("split.ok"));
    return res;
  }


  async function undoSplit() {
    if (!state.splitChain || !state.splitChain.info) {
      S.toast("warn", S.t("err.undo.empty"));
      return false;
    }
    const info = state.splitChain.info;
    state.splitChain = null;
    await adopt(info, "", { from: "open" });
    state.assets.open = info.assetId;
    state.assets.split = "";
    S.toast("ok", S.t("ok.undoStep"));
    return true;
  }


  // stampBodyOf assembles one /api/pdf/apply entry per instance (AGENTS §6).
  // Geometry follows the instance's mode (decision U1): `pos` sends the page
  // point and deliberately omits anchor/offset, `anchor` sends the corner +
  // offset and omits pos. The server's precedence rule is the same.
  function stampBodyOf() {
    return state.instances
      .filter((i) => i.sealId)
      .map((i) => {
        const p = i.params || {};
        const entry = {
          blend: p["api.apply.blend"] !== undefined ? p["api.apply.blend"] : S.readField("api.apply.blend"),
          opacity: S.numAt(p, "api.apply.opacity", "api.apply.opacity"),
          scale: S.numAt(p, "api.apply.scale", "api.apply.scale"),
          rotation: S.numAt(p, "api.apply.rotation", "api.apply.rotation"),
          // UI5-B2: color tuning bakes into the seal pixels server-side
          // (the disk mirror is pdfcore.AdjustPNG with the same formulas).
          brightness: S.numAt(p, "api.apply.brightness", "api.apply.brightness"),
          saturate: S.numAt(p, "api.apply.saturate", "api.apply.saturate"),
          ink: S.numAt(p, "api.apply.ink", "api.apply.ink"),
          pages: p["api.apply.pages"] !== undefined ? p["api.apply.pages"] : S.readField("api.apply.pages"),
          crossPage: Boolean(p["api.apply.crossPage"]),
          sealId: i.sealId,
        };
        if (Boolean(p["api.apply.crossPage"])) {
          entry.binding = p["ui.crosspage.binding"] !== undefined ? p["ui.crosspage.binding"] : S.readField("ui.crosspage.binding");
          entry.startOffset = S.numAt(p, "api.apply.startOffset", "api.apply.startOffset");
          // Z5: the 随机 draw's per-slot shares travel verbatim — the disk must
          // land the exact distribution the user saw in the preview.
          if (Array.isArray(p["api.apply.slices"]) && p["api.apply.slices"].length) {
            entry.slices = p["api.apply.slices"].map((v) => +Number(v).toFixed(4));
          }
        }
        // HD12: one geometry channel for the canvas: anchor + offset (the
        // pos box never existed for instances any more, and the server's pos
        // precedence stays available for the stamp-all-pages defaults).
        entry.anchor = p["api.apply.anchor"] !== undefined ? p["api.apply.anchor"] : S.readField("api.apply.anchor");
        entry.offset = p["api.apply.offset"] !== undefined ? p["api.apply.offset"] : S.readField("api.apply.offset");
        return entry;
      });
  }


  // stampIntoPDF bakes the instances into a new asset, then clears them (W2):
  // the document the user is looking at *is* the stamped one now, so leaving
  // the instances on screen would double-draw the seal and every later Save
  // would stamp it a second time.
  async function stampIntoPDF(opts) {
    if (!state.file) {
      if (!(opts && opts.quiet)) S.toast("error", S.t("err.apply.noDoc"));
      return null;
    }
    const instances = stampBodyOf();
    if (!instances.length) {
      if (!(opts && opts.quiet)) S.toast("warn", S.t("err.apply.noSeal"));
      return null;
    }
    let res;
    try {
      res = await api.request("/api/pdf/apply", { method: "POST", body: { assetId: state.file.assetId, instances } });
    } catch (e) {
      S.toast("error", `${e.code}: ${e.message}`);
      return null;
    }
    state.applyChain = {
      info: state.lastInfo,
      instances: state.instances.map((i) => ({
        id: i.id, name: i.name, sealId: i.sealId, crossPage: i.crossPage,
        params: { ...(i.params || {}) },
      })),
      selected: state.selected,
    };
    state.instances = [];
    state.selected = null;
    state.nextInstance = 1;
    S.renderInstances();
    await adopt(res, "", { from: "apply" });
    if (!(opts && opts.quiet)) S.toast("ok", S.t("ok.applied"));
    return res;
  }


  async function undoStamping() {
    if (!state.applyChain || !state.applyChain.info) {
      S.toast("warn", S.t("err.undo.empty"));
      return false;
    }
    const chain = state.applyChain;
    state.applyChain = null;
    state.instances = chain.instances;
    state.selected = chain.selected;
    state.nextInstance = chain.instances.reduce((m, i) => Math.max(m, Number(i.id) || 0), 0) + 1;
    S.renderInstances();
    await adopt(chain.info, "", { from: "open" });
    state.assets.open = chain.info.assetId;
    state.assets.apply = "";
    S.toast("ok", S.t("ok.undoStep"));
    return true;
  }

  Object.assign(S, {
    submitSave, pickAndOpen, openByPath, openGrant, handleFiles, classifyLoad, loadSeals,
    submitFiles, openFailed, retryOpen, saveViaDialog, saveToPath, submitReplace, adopt, spreadPages,
    splitModeOf, splitGridOf, cutsOf, splitPagesFor, splitBodyOf, runSplit, undoSplit,
    stampBodyOf, stampIntoPDF, undoStamping,
    loadLogOf: () => loadLog,
    vetoPage: (n) => {
      if (state.vetoed.has(n)) state.vetoed.delete(n);
      else state.vetoed.add(n);
      return [...state.vetoed];
    },
  });
})();
