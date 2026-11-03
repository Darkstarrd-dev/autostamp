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
      shell().setSealForSelected(meta.sealId);
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
      shell().setSealForSelected(meta.sealId);
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
    const button = doc.getElementById("seal-upload");
    const input = doc.getElementById("seal-file-input");
    const revertBtn = doc.getElementById("seal-despill-revert");
    if (!button || !input) return;
    button.addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (file) upload(file);
    });
    if (revertBtn) revertBtn.addEventListener("click", () => revert());
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
    revert,
    bitmapOf,
    renderMeta,
    prepareOptions,
    probe,
    // lastSource exposes the in-memory upload (the verify script needs to know
    // the 撤销 channel has something to re-run).
    lastSource: () => (lastFile ? { name: lastFile.name, bytes: lastFile.size } : null),
  };
})();
