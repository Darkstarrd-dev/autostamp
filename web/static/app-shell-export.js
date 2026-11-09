// Copyright 2026 AutoStamp Authors. SPDX-License-Identifier: Apache-2.0
// app-shell-export.js — part of the app-shell module group (split from
// app-shell.js on 2026-11-05; docs/IMPLEMENTATION_PLAN.md §10.1). the export estimate (FACTS §4) and the raster bake channel (W5/W6).
(() => {
  "use strict";

  const S = window.__autoStampShell;
  const q = (sel, root) => (root || document).querySelector(sel);
  const qa = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const doc = document;
  const html = doc.documentElement;
  const api = window.__autoStampApi;
  const state = S.state;


  // ---------- export estimate (UI_SPEC §E1: inline, live, never a request) ----------
  // docs/FACTS §4 measured table: stdlib /DCTDecode writer, single A4 page.
  // Off-grid DPI/quality values interpolate that table (documented in
  // export.estimate.note); the numbers themselves are what the UI shows.
  const FACTS_RASTER = [
    { dpi: 72, q40: 35582, q75: 43722, q92: 57259 },
    { dpi: 150, q40: 104089, q75: 123796, q92: 155781 },
    { dpi: 300, q40: 328844, q75: 378606, q92: 459215 },
  ];

  const A4_PT_AREA = 595.28 * 841.89; // the page FACTS §4 rasterised


  // exportPagesSelected resolves the api.export.pages vocabulary (UI_SPEC §2.2,
  // same words as api.apply.pages) into a *count* for the estimate.
  function exportPagesSelected() {
    const total = state.file && state.file.pages ? state.file.pages.length : 0;
    const raw = String(S.readField("api.export.pages") || "all").trim();
    if (!total || raw === "all" || raw === "") return total;
    let n = 0;
    raw.split(",").forEach((tok) => {
      const part = tok.trim();
      if (!part) return;
      const rng = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (rng) {
        const a = Math.min(Number(rng[1]), Number(rng[2]));
        const b = Math.max(Number(rng[1]), Number(rng[2]));
        for (let i = a; i <= b; i++) if (i >= 1 && i <= total) n++;
        return;
      }
      if (/^\d+$/.test(part) && Number(part) >= 1 && Number(part) <= total) n++;
    });
    return n;
  }

  // exportDpiOf/exportQualityOf resolve the export vocabulary to the numbers
  // the export request sends; computeEstimate reads the same two, so the
  // estimate and the wire can never disagree (UI_SPEC §E1: the estimate IS the
  // FACTS §4 table). dpi comes out already parsed (customDpi expanded) because
  // the export route takes a number, not the panel's 72/150/300/custom word.
  function exportDpiOf() {
    const sel = S.readField("api.export.dpi");
    return sel === "custom" ? Number(S.readField("api.export.customDpi")) || 150 : Number(sel) || 150;
  }


  function exportQualityOf() {
    return Math.min(95, Math.max(40, Number(S.readField("api.export.quality")) || 75));
  }


  function computeEstimate() {
    if (!state.file || !state.file.pages || !state.file.pages.length) return null;
    const pages = state.file.pages;
    const sel = exportPagesSelected();
    const mode = S.readField("api.export.mode") || "vector";
    if (mode === "vector") {
      // vector keeps the document's own bytes; DPI/quality are not read.
      const per = (state.file.size || 0) / pages.length;
      return { mode, dpi: null, quality: null, areaFactor: 1, perPageBytes: per, totalBytes: per * sel };
    }
    // MediaBox area is what the raster writer encodes, so page area scales the
    // FACTS sample; rotation is deliberately ignored.
    let area = 0;
    pages.forEach((pg) => { area += (Number(pg.width) || 0) * (Number(pg.height) || 0); });
    const areaFactor = pages.length ? area / pages.length / A4_PT_AREA : 1;

    const dpi = exportDpiOf();
    const quality = exportQualityOf();

    const atQ = (row) => {
      const pts = [[40, row.q40], [75, row.q75], [92, row.q92]];
      if (quality <= pts[0][0]) return pts[0][1];
      const last = pts[pts.length - 1];
      if (quality >= last[0]) return last[1];
      for (let i = 1; i < pts.length; i++) {
        if (quality <= pts[i][0]) {
          const a = pts[i - 1];
          const b = pts[i];
          return a[1] + ((b[1] - a[1]) * (quality - a[0])) / (b[0] - a[0]);
        }
      }
      return last[1];
    };

    let base;
    const hit = FACTS_RASTER.find((r) => r.dpi === dpi);
    if (hit) base = atQ(hit);
    else {
      const below = FACTS_RASTER.filter((r) => r.dpi < dpi).pop();
      const above = FACTS_RASTER.find((r) => r.dpi > dpi);
      if (below && above) {
        const lo = atQ(below);
        const hi = atQ(above);
        const f = (Math.log(dpi) - Math.log(below.dpi)) / (Math.log(above.dpi) - Math.log(below.dpi));
        base = lo + (hi - lo) * f;
      } else {
        const anchor = below || above;
        base = atQ(anchor) * Math.pow(dpi / anchor.dpi, 2);
      }
    }
    const per = base * areaFactor;
    return { mode, dpi, quality, areaFactor, perPageBytes: per, totalBytes: per * sel };
  }


  function refreshEstimate() {
    const box = S.q("#estimate");
    const total = S.q("#estimate-total");
    const per = S.q("#estimate-per-page");
    if (!box || !total || !per) return;
    const e = computeEstimate();
    if (!e) {
      total.textContent = "-";
      per.textContent = "-";
      return;
    }
    total.textContent = `~ ${S.formatBytes(e.totalBytes)} (${exportPagesSelected()} pages)`;
    per.textContent = e.mode === "vector"
      ? `~ ${S.formatBytes(e.perPageBytes)}/page (vector: ${S.formatBytes(state.file.size || 0)} source / ${state.file.pages.length} pages)`
      : `~ ${S.formatBytes(e.perPageBytes)}/page (raster ${e.dpi} dpi q${e.quality}, page area x${e.areaFactor.toFixed(2)} A4)`;
  }



  // ---------- P5 raster channel (UI_SPEC §8 W5/W6) ----------
  //
  // W5: 保存时自动光栅化 — when the export panel says raster, submitSave bakes
  // the selected pages into a full-page-bitmap asset, adopts it, and only then
  // writes to disk; mode=vector never sends /api/pdf/export (源资产直接写).
  // W6: a per-page FACTS-§4 estimate over 90 MiB blocks the submit BEFORE any
  // request goes out; the server keeps its own hard limit (400 page_too_large),
  // but the front-end refuses to spool that much in the first place.
  const MAX_EXPORT_PAGE_BYTES = 90 * 1024 * 1024; // the server's cap (PLAN P5, W6)


  // exportUpload is the multipart shape the export contract defines: a `spec`
  // field (the JSON string) plus one `page-<n>` file per selected page,
  // ascending (AGENTS §6 P5). It rides app-api's single multipart channel, so
  // the session header and the envelope error handling stay in one place.
  async function exportUpload(spec, parts) {
    return api.uploadMultipart(
      "/api/pdf/export",
      { spec: JSON.stringify(spec) },
      parts.map((p) => ({ name: `page-${p.n}`, blob: p.blob, filename: `page-${p.n}` })),
    );
  }


  // lastExportBody records the last raster submission for S.probe("exportBody"):
  // the exact spec JSON, the page numbers, each blob's byte size and the pixel
  // box each canvas produced. It is filled before the request goes out, so a
  // refused route still pins what the front-end would have sent.
  let lastExportBody = null;

  // lastExport records *which* asset was produced by which bake. The re-save
  // guard in submitSave uses it to refuse a second /api/pdf/export on an
  // already-flattened document: one more JPEG generation per save would be
  // visible quality loss, and the panel parameters alone cannot tell the two
  // cases apart.
  let lastExport = null;


  // exportSpecOf resolves the panel fields into the contract spec (AGENTS §6).
  // exportRaster and the guard share it, so the guard can never drift away
  // from what would actually be sent.
  function exportSpecOf() {
    const rawPages = String(S.readField("api.export.pages") || "all").trim() || "all";
    return {
      assetId: state.file ? state.file.assetId : "",
      mode: "raster",
      dpi: exportDpiOf(),
      quality: exportQualityOf(),
      pages: rawPages,
    };
  }


  // exportKeyOf is the identity of a bake: same dpi/quality/pages on the same
  // asset means the document on screen already is what the user wants written.
  function exportKeyOf(spec) {
    return `${spec.dpi}|${spec.quality}|${spec.pages}`;
  }


  // exportRaster renders the selected pages at scale = dpi/72 into offscreen
  // canvases and posts them as JPEG. The bitmap is the page in its DISPLAY
  // orientation: pdf.js' getViewport applies /Rotate itself (AGENTS §5.17 - the
  // same reason the write side adds no rotation), so no rotation compensation
  // happens here, and the pixel box is exactly what the raster writer turns
  // back into pt (MediaBox = px*72/dpi).
  async function exportRaster() {
    const preview = window.__autoStampPreview;
    if (!preview || !preview.getPage) {
      S.toast("error", S.t("err.apply.noDoc"));
      return null;
    }
    const spec = exportSpecOf();
    const numbers = S.resolvePages(spec.pages, state.file.pages.length);
    const parts = [];
    try {
      for (const n of numbers) {
        const pageObj = await preview.getPage(n);
        const vp = pageObj.getViewport({ scale: spec.dpi / 72 });
        const canvas = doc.createElement("canvas");
        canvas.width = Math.max(1, Math.round(vp.width));
        canvas.height = Math.max(1, Math.round(vp.height));
        const ctx = canvas.getContext("2d", { alpha: false });
        // JPEG has no alpha: start from an opaque white ground so transparent
        // page areas never turn black in the DCT stream.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await pageObj.render({ canvasContext: ctx, viewport: vp, background: "#ffffff" }).promise;
        const blob = await new Promise((ok, no) => {
          canvas.toBlob((b) => (b ? ok(b) : no(new Error("canvas.toBlob 返回空"))), "image/jpeg", spec.quality / 100);
        });
        parts.push({ n, blob, width: canvas.width, height: canvas.height });
      }
    } catch (e) {
      S.toast("error", `export: ${e.message}`);
      return null;
    }
    lastExportBody = {
      spec,
      pages: parts.map((p) => p.n),
      bytesPerPage: parts.map((p) => p.blob.size),
      px: parts.map((p) => [p.width, p.height]),
    };
    let res;
    try {
      res = await exportUpload(spec, parts);
    } catch (e) {
      S.toast("error", `${e.code}: ${e.message}`);
      return null;
    }
    // The export is a derived swap (like split/apply): adopt re-points the
    // preview at the raster asset, so the following save writes the document
    // the user is looking at. state.assets.export carries the id (asset hooks).
    await S.adopt(res, "", { from: "export" });
    lastExport = { assetId: res.assetId, key: exportKeyOf(spec) };
    S.toast("ok", S.t("ok.exported").replace("%d", String(parts.length)).replace("%d", String(spec.dpi)).replace("%d", String(spec.quality)));
    return res;
  }

  Object.assign(S, {
    FACTS_RASTER, exportPagesSelected, exportDpiOf, exportQualityOf, computeEstimate,
    refreshEstimate, MAX_EXPORT_PAGE_BYTES, exportUpload, exportSpecOf, exportKeyOf,
    exportRaster,
    exportBodyOf: () => lastExportBody,
    exportLastBake: () => lastExport,
  });
})();
