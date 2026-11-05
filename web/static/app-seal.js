// app-seal.js — P2: the seal image channel (AGENTS §6, /api/pdf/seal/prepare).
//
// The upload button feeds the file to the server, which keys (去白底), trims
// (alpha 包围盒) and resamples it, then returns sealId + the alpha metadata.
// The bytes come back through /api/pdf/seal/raw as an ImageBitmap because the
// session header cannot ride an <img>, and createImageBitmap does not touch
// the page CSP (app-api.bitmapOf).
//
// 撤销 (seal.despill.revert) re-runs the *original* file with despill off, so
// the keying is genuinely reversible before anything is baked to disk.
(() => {
  "use strict";

  const doc = document;
  const api = () => window.__autoStampApi;
  const shell = () => window.__autoStampShell;

  // sealId -> { bitmap, meta, name, bytes }
  const seals = new Map();
  // The raw upload kept in memory so the 撤销 button can re-prepare from it.
  let lastFile = null;

  function prepareOptions(override) {
    const f = shell().fields();
    const opts = {
      despill: f["api.seal.prepare.despill"] !== false,
      alphaTrim: f["api.seal.prepare.alphaTrim"] !== false,
      resampleDpi: Number(f["api.seal.prepare.resampleDpi"]) || 0,
    };
    return Object.assign(opts, override || {});
  }

  function metaLine(meta) {
    if (!meta) return "-";
    const bbox = Array.isArray(meta.alphaBBox) ? meta.alphaBBox : [0, 0, 0, 0];
    const pct = Math.round((meta.opaqueRatio || 0) * 100);
    return [
      `${meta.outWidthPx}x${meta.outHeightPx}px`,
      `${meta.outDpi || "?"}dpi`,
      `src ${meta.srcWidthPx}x${meta.srcHeightPx}px`,
      `alpha[${bbox.join(",")}]`,
      `opaque ${pct}%`,
    ].join(" ");
  }

  function renderMeta(sealId) {
    const chip = doc.getElementById("seal-meta");
    if (!chip) return;
    const entry = seals.get(sealId);
    chip.textContent = entry ? metaLine(entry.meta) : "-";
  }

  async function loadBitmap(sealId) {
    const entry = seals.get(sealId);
    if (!entry || entry.bitmap) return entry;
    entry.bitmap = await api().bitmapOf(api().sealURL(sealId));
    return entry;
  }

  // prepare runs one upload through the server. `file` is the raw upload; the
  // options are the panel's seal.prepare group (optionally overridden, which is
  // how the 撤销 button turns despill off without touching the controls).
  // app-api's envelopeOf unwraps {ok,data} into the payload, so the result here
  // *is* the seal metadata record (docs/UI_SPEC.md §4: sealId + alpha fields).
  async function prepare(file, override) {
    const a = api();
    if (!a) throw new Error("api unavailable");
    const opts = prepareOptions(override);
    const meta = await a.sealPrepare(file, opts);
    if (!meta || !meta.sealId) throw Object.assign(new Error("seal/prepare returned no sealId"), { code: "bad_envelope" });
    seals.set(meta.sealId, {
      meta,
      name: file.name,
      bytes: file.size,
      bitmap: null,
    });
    await loadBitmap(meta.sealId);
    renderMeta(meta.sealId);
    renderPreview(meta.sealId);
    return meta;
  }

  async function upload(file) {
    if (!file) return null;
    // Clipboard/drag File objects can carry an empty `type` when the OS
    // supplies only names (Explorer copies), so the extension is the
    // fallback of this allowlist - the same vocabulary the load gate uses.
    const isImage = (file.type || "").startsWith("image/") || /\.(png|jpe?g|gif|bmp|webp|tiff?)$/i.test(file.name || "");
    if (!isImage) {
      shell().toast("error", shell().t("seal.err.type"));
      return null;
    }
    lastFile = file;
    try {
      const meta = await prepare(file);
      // HD17 (2026-11-05): upload never touches instances - only the current
      // seal changes. HD9: the File funnel feeds the preview card too.
      shell().setCurrentSeal(meta.sealId, file.name);
      shell().toast("ok", shell().t("seal.ok"));
      return meta;
    } catch (e) {
      shell().toast("error", `${e.code || "seal_prepare"}: ${e.message}`);
      return null;
    }
  }

  // revert re-prepares the same bytes with despill off: the alpha keying the
  // server applied is never baked into the preview unless the user re-uploads.
  async function revert() {
    if (!lastFile) {
      shell().toast("warn", shell().t("seal.err.nosource"));
      return null;
    }
    try {
      const meta = await prepare(lastFile, { despill: false });
      shell().setCurrentSeal(meta.sealId, lastFile.name);
      // The copy is the frozen mock string (seal.despill.revert), so the two
      // surfaces say the same thing about the same action.
      shell().toast("ok", shell().t("seal.despill.revert"));
      return meta;
    } catch (e) {
      shell().toast("error", `${e.code || "seal_prepare"}: ${e.message}`);
      return null;
    }
  }

  function bind() {
    // HD8: the sidebar upload button + its file input are gone. The header's
    // upload button drives fs/pick + the JSON seal/prepare channel, and the
    // drop/paste funnel still feeds this module through upload(). The despill
    // revert stays in the seal group because it only works when a browser
    // File is in play (drop/paste); picked paths re-enter through the header.
    const revertBtn = doc.getElementById("seal-despill-revert");
    if (revertBtn) revertBtn.addEventListener("click", () => revert());
  }

  // prepareFromGrant runs a native-picker (or dropdown) path through the JSON
  // shape of the same route (HD8): same options, same registration - only the
  // bytes' origin differs (the server read them from disk). The name is the
  // picked path so the recent-seals list and the preview card agree.
  async function prepareFromGrant(pathGrantId, path) {
    const a = api();
    if (!a) throw new Error("api unavailable");
    const opts = prepareOptions();
    const meta = await a.sealPrepareGrant(pathGrantId, opts);
    if (!meta || !meta.sealId) throw Object.assign(new Error("seal/prepare returned no sealId"), { code: "bad_envelope" });
    seals.set(meta.sealId, {
      meta,
      name: path || `seal ${meta.sealId}`,
      bytes: meta.bytes || 0,
      bitmap: null,
    });
    lastFile = null; // the browser File channel is closed for this seal
    await loadBitmap(meta.sealId);
    renderMeta(meta.sealId);
    renderPreview(meta.sealId);
    return meta;
  }

  // HD9: the bottom-left preview card - the current seal drawn to fit a fixed
  // square, scaled proportionally, on a checkerboard-free transparent surface
  // (style.css paints the card background).
  function renderPreview(sealId) {
    const card = doc.getElementById("seal-preview");
    if (!card) return;
    const s = shell();
    const cur = sealId || (s && s.state.currentSeal && s.state.currentSeal.sealId);
    const entry = cur ? seals.get(cur) : null;
    const nameEl = doc.getElementById("seal-preview-name");
    const cv = doc.getElementById("seal-preview-canvas");
    if (!entry) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    if (nameEl) {
      nameEl.textContent =
        (s && s.state.currentSeal && s.state.currentSeal.name) || String(entry.name || "").replace(/\.[^.]+$/, "");
    }
    if (!cv) return;
    const size = 150;
    cv.width = size;
    cv.height = size;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, size, size);
    const bm = entry.bitmap;
    if (!bm) return;
    const k = Math.min(size / bm.width, size / bm.height, 1);
    const w = Math.max(1, Math.round(bm.width * k));
    const h = Math.max(1, Math.round(bm.height * k));
    ctx.drawImage(bm, (size - w) / 2, (size - h) / 2, w, h);
  }

  function bitmapOf(sealId) {
    const entry = seals.get(sealId);
    return entry && entry.bitmap ? entry.bitmap : null;
  }

  function probe(name) {
    switch (name) {
      case "seals":
        return Array.from(seals.entries()).map(([id, e]) => ({
          sealId: id,
          name: e.name,
          bytes: e.bytes,
          ready: Boolean(e.bitmap),
          meta: e.meta,
        }));
      case "count":
        return seals.size;
      case "meta":
        return metaLine((Array.from(seals.values())[0] || {}).meta);
      default:
        throw new Error(`unknown seal probe: ${name}`);
    }
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", bind);
  else bind();

  window.__autoStampSeal = {
    upload,
    prepare,
    prepareFromGrant,
    prepareOptions,
    bitmapOf,
    renderMeta,
    renderPreview,
    metaLine,
    lastSource: () => lastFile,
    probe,
  };
})();
