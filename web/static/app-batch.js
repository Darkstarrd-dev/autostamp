// Copyright 2026 AutoStamp Authors. SPDX-License-Identifier: Apache-2.0
// app-batch.js — P6: the seal preset library UI + the batch queue (BM1).
//
// The batch has NO server-side job route: the front-end walks the same chain
// per file that the single-document panel drives by hand —
//
//	fs/pick{dir:true} → pdf/open → (pdf/split) → pdf/apply
//	→ pdf/export(raster, pages rendered client-side with pdf.js)
//	→ pdf/save{mkdirs:true} → <dirPath>\_batch\<name>.dpi<N>.q<Q>.pdf
//
// (BM1, UI_SPEC §2/§8). The seal image is prepared ONCE per run from the named
// preset (GET /api/seal/preset/raw → POST /api/pdf/seal/prepare), every file
// reuses that sealId, and the queue runs with the api.batch.concurrency
// setting. Encrypted PDFs never get a password prompt: the row is marked
// batch.status.encrypted and skipped. Output names never overwrite a source
// file (BM2: the dpi/quality suffix lives inside the .pdf single extension).
//
// The preset half (印章卡): 存为预设 / 预设列表 / 应用预设 / 删除预设 against
// GET/POST/DELETE /api/seal/preset. window.__autoStampBatch is the verify hook
// used by tools/verify/batch-smoke.mjs.
(() => {
  "use strict";

  const doc = document;
  const shell = () => window.__autoStampShell;
  const api = () => window.__autoStampApi;

  // Module state. The panel fields (api.batch.*) stay the single source of
  // truth for parameters — they persist through the settings batch group, so
  // nothing here caches dpi/quality/concurrency.
  const st = {
    presets: [], // presetView rows: {name, imageBytes, updatedAt, params}
    queue: [], // {path, grant, status, message, out}
    running: false,
    stopRequested: false,
    dirPath: "", // the folder the current report refers to
  };

  const num = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const t = (key) => (shell() && shell().t(key)) || key;

  // ---------- preset library (seal card) ----------

  // panelParams serialises the panel into presetstore.Params (internal/
  // presetstore/store.go): the exact vocabulary POST /api/pdf/apply accepts,
  // plus the seal.prepare options the next prepare runs with.
  function panelParams() {
    const f = shell().fields();
    return {
      blend: String(f["api.apply.blend"] || "multiply"),
      opacity: num(f["api.apply.opacity"], 0.6),
      scale: num(f["api.apply.scale"], 0.202),
      pos: String(f["api.apply.pos"] || ""),
      anchor: String(f["api.apply.anchor"] || "center"),
      offset: String(f["api.apply.offset"] || "0,0"),
      rotation: num(f["api.apply.rotation"], 0),
      pages: String(f["api.apply.pages"] || "all"),
      crossPage: Boolean(f["api.apply.crossPage"]),
      binding: String(f["ui.crosspage.binding"] || "right"),
      startOffset: num(f["api.apply.startOffset"], 0),
      despill: f["api.seal.prepare.despill"] !== false,
      alphaTrim: f["api.seal.prepare.alphaTrim"] !== false,
      resampleDpi: num(f["api.seal.prepare.resampleDpi"], 300),
    };
  }

  // fillSelect mirrors the library into both selects (#seal-preset-select in
  // the seal card, #batch-preset in the batch card). The batch select keeps an
  // empty "pick a preset" option because an empty value means 不跑 (BR6).
  function fillSelect(sel, keepValue) {
    if (!sel) return;
    const prev = keepValue ? sel.value : "";
    sel.textContent = "";
    if (sel.id === "batch-preset") {
      const ph = doc.createElement("option");
      ph.value = "";
      ph.setAttribute("data-i18n", "batch.preset.placeholder");
      ph.textContent = t("batch.preset.placeholder");
      sel.append(ph);
    }
    st.presets.forEach((p) => {
      const o = doc.createElement("option");
      o.value = p.name;
      o.textContent = p.name;
      sel.append(o);
    });
    if (prev && st.presets.some((p) => p.name === prev)) sel.value = prev;
  }

  async function refreshPresets() {
    const res = await api().presetList();
    st.presets = (res && res.presets) || [];
    fillSelect(doc.getElementById("seal-preset-select"), true);
    fillSelect(doc.getElementById("batch-preset"), true);
    return st.presets;
  }

  async function savePreset() {
    const s = shell();
    const name = String((s.fields()["api.seal.preset.presetName"] || "")).trim();
    if (!name) {
      s.toast("warn", t("seal.preset.nameNeeded"));
      return null;
    }
    // HD17 (2026-11-05): the preset takes the CURRENT seal (instances are no
    // longer assignment targets); the toast stays honest when nothing is open.
    const sealId = s.currentSeal();
    if (!sealId) {
      s.toast("warn", t("seal.preset.noSeal"));
      return null;
    }
    try {
      const view = await api().presetSave({ name, sealId, params: panelParams() });
      s.toast("ok", t("seal.preset.saved"));
      await refreshPresets();
      const sel = doc.getElementById("seal-preset-select");
      if (sel) sel.value = view.name;
      return view;
    } catch (e) {
      s.toast("error", `${e.code}: ${e.message}`);
      return null;
    }
  }

  // loadPreset re-prepares the stored image (so despill/trim/resample apply
  // with the panel's current prepare options, exactly like a fresh upload)
  // and writes the stored apply parameters back into the panel.
  async function loadPreset(name) {
    const s = shell();
    const target = name || (doc.getElementById("seal-preset-select") || {}).value;
    if (!target) {
      s.toast("warn", t("seal.preset.empty"));
      return null;
    }
    const preset = st.presets.find((p) => p.name === target);
    if (!preset) {
      s.toast("warn", t("seal.preset.empty"));
      return null;
    }
    try {
      const bytes = await api().rawBytes(api().presetRawURL(preset.name));
      const file = new File([bytes], `${preset.name}.png`, { type: "image/png" });
      const sealMod = window.__autoStampSeal;
      if (!sealMod || !sealMod.prepare) throw Object.assign(new Error("seal module unavailable"), { code: "internal" });
      const meta = await sealMod.prepare(file);
      // HD17: a loaded preset only becomes the CURRENT seal (HD9 preview card
      // switches to it too); instances are never re-assigned.
      s.setCurrentSeal(meta.sealId, preset.name);
      const p = preset.params || {};
      s.setParams({
        "api.apply.blend": p.blend || "multiply",
        "api.apply.opacity": num(p.opacity, 0.6),
        "api.apply.scale": num(p.scale, 0.202),
        "api.apply.pos": p.pos || "",
        "api.apply.anchor": p.anchor || "center",
        "api.apply.offset": p.offset || "0,0",
        "api.apply.rotation": num(p.rotation, 0),
        "api.apply.pages": p.pages || "all",
        "api.apply.crossPage": Boolean(p.crossPage),
        "ui.crosspage.binding": p.binding || "right",
        "api.apply.startOffset": num(p.startOffset, 0),
      });
      s.toast("ok", t("seal.preset.loaded"));
      return preset;
    } catch (e) {
      s.toast("error", `${e.code || "preset_load"}: ${e.message}`);
      return null;
    }
  }

  async function deletePreset() {
    const s = shell();
    const sel = doc.getElementById("seal-preset-select");
    const name = sel && sel.value;
    if (!name) {
      s.toast("warn", t("seal.preset.empty"));
      return null;
    }
    try {
      await api().presetDelete(name);
      s.toast("ok", t("seal.preset.deleted"));
      await refreshPresets();
      return name;
    } catch (e) {
      s.toast("error", `${e.code}: ${e.message}`);
      return null;
    }
  }

  // ---------- batch queue (BM1) ----------

  // pdfjs loads the vendored ESM build once, the same way app-preview does
  // (CSP keeps script-src to 'self', so the import path must be exact).
  let pdfjsPromise = null;
  function pdfjs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import("./vendor/pdfjs/build/pdf.min.mjs").then((m) => {
        m.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/build/pdf.worker.min.mjs";
        return m;
      });
    }
    return pdfjsPromise;
  }

  // renderRaster mirrors app-shell's exportRaster byte for byte (AGENTS §5.1:
  // page bitmaps are produced in the front-end), but against an offline
  // document: the applied asset's bytes are fetched with the session token and
  // handed to pdf.js as {data}, so the batch never touches the live preview.
  async function renderRaster(assetId, dpi, quality) {
    const bytes = await api().rawBytes(api().rawURL(assetId));
    const lib = await pdfjs();
    const task = lib.getDocument({
      data: new Uint8Array(bytes),
      cMapUrl: "./vendor/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "./vendor/pdfjs/standard_fonts/",
      wasmUrl: "./vendor/pdfjs/wasm/",
      isEvalSupported: false,
    });
    let pdf;
    try {
      pdf = await task.promise;
      const parts = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const vp = page.getViewport({ scale: dpi / 72 });
        const canvas = doc.createElement("canvas");
        canvas.width = Math.max(1, Math.round(vp.width));
        canvas.height = Math.max(1, Math.round(vp.height));
        const ctx = canvas.getContext("2d", { alpha: false });
        // JPEG has no alpha: start from an opaque white ground (as exportRaster).
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp, background: "#ffffff" }).promise;
        const blob = await new Promise((ok, no) => {
          canvas.toBlob((b) => (b ? ok(b) : no(new Error("canvas.toBlob 返回空"))), "image/jpeg", quality / 100);
        });
        parts.push({ n, blob });
      }
      return parts;
    } finally {
      // destroy() terminates the worker; a task abandoned on error must not
      // leak it (app-preview keeps the same discipline).
      try {
        await task.destroy();
      } catch (e) {
        /* already torn down */
      }
    }
  }

  // pagesForDoc resolves the preset's pages vocabulary against ONE document:
  // a batch feeds files of different lengths, so out-of-range pages are
  // dropped (a 1-page file under a "1-2,5" preset is a normal case, not an
  // error) and an empty intersection falls back to all pages.
  function pagesForDoc(raw, total) {
    const v = String(raw === undefined || raw === null ? "all" : raw).trim();
    if (v === "" || v === "all") return "all";
    if (v === "none") return "none";
    const out = new Set();
    v.split(/[,;\s]+/).forEach((tok) => {
      if (!tok) return;
      const m = tok.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) return;
      let a = Number(m[1]);
      let b = m[2] ? Number(m[2]) : a;
      if (b < a) [a, b] = [b, a];
      for (let n = Math.max(1, a); n <= Math.min(total, b); n++) out.add(n);
    });
    return out.size ? [...out].sort((x, y) => x - y).join(",") : "all";
  }

  // applyInstance maps presetstore.Params onto one /api/pdf/apply entry — the
  // same shape app-shell's stampBodyOf builds for a panel instance, with the
  // batch's single prepared sealId.
  function applyInstance(p, sealId) {
    const entry = {
      blend: p.blend || "multiply",
      opacity: num(p.opacity, 0.6),
      scale: num(p.scale, 0.202),
      rotation: num(p.rotation, 0),
      pages: p.pages || "all",
      crossPage: Boolean(p.crossPage),
      sealId,
    };
    if (entry.crossPage) {
      entry.binding = p.binding || "right";
      entry.startOffset = num(p.startOffset, 0);
    }
    if (p.pos) entry.pos = String(p.pos);
    else {
      entry.anchor = p.anchor || "center";
      entry.offset = p.offset || "0,0";
    }
    return entry;
  }

  // batchTarget is the BM2 output name: <dirPath>\_batch\<base>.dpi<N>.q<Q>.pdf
  // (single .pdf extension — fsx.ValidateTargetPath only accepts .pdf/.xps/.oml).
  // It never writes back onto the source path.
  function batchTarget(dirPath, srcPath, dpi, quality) {
    const base = String(srcPath).replace(/^.*[\\/]/, "").replace(/\.pdf$/i, "");
    return `${String(dirPath).replace(/[\\/]+$/, "")}\\_batch\\${base}.dpi${dpi}.q${quality}.pdf`;
  }

  const STATUS_KEYS = {
    pending: "batch.status.pending",
    running: "batch.status.running",
    ok: "batch.status.ok",
    fail: "batch.status.fail",
    encrypted: "batch.status.encrypted",
  };

  function renderQueue() {
    const ul = doc.getElementById("batch-queue");
    if (!ul) return;
    ul.textContent = "";
    st.queue.forEach((item) => {
      const li = doc.createElement("li");
      const stat = doc.createElement("span");
      stat.className = "stat";
      stat.setAttribute("data-i18n", STATUS_KEYS[item.status] || "batch.status.pending");
      stat.textContent = t(STATUS_KEYS[item.status] || "batch.status.pending");
      const name = doc.createElement("span");
      name.textContent = ` ${item.path.split(/[\\/]/).pop()}`;
      li.append(stat, name);
      if (item.out) {
        const out = doc.createElement("span");
        out.className = "chip";
        out.textContent = ` → ${item.out}`;
        li.append(out);
      } else if (item.message) {
        const msg = doc.createElement("span");
        msg.className = "chip";
        msg.textContent = ` ${item.message}`;
        li.append(msg);
      }
      ul.append(li);
    });
    const prog = doc.getElementById("batch-progress");
    if (prog) {
      const done = st.queue.filter((i) => i.status === "ok" || i.status === "fail" || i.status === "encrypted").length;
      prog.textContent = st.running ? `${done}/${st.queue.length}` : t("batch.progress.idle");
    }
  }

  // runOne walks the whole BM1 chain for one queued file. Every failure is a
  // row status, never a thrown batch: the queue must always finish.
  async function runOne(item, preset, sealId, dirPath, dpi, quality, splitOn) {
    const s = shell();
    const f = s.fields();
    item.status = "running";
    renderQueue();
    try {
      // 1. a grant for this file: the dir pick already handed one out, the
      //    textarea flow re-asks /api/fs/pick with the typed path.
      let grant = item.grant;
      if (!grant) {
        const picked = await api().pick({ filePath: item.path, filter: "pdf" });
        grant = picked && picked.picks && picked.picks[0] && picked.picks[0].pathGrantId;
        if (!grant) throw Object.assign(new Error(t("batch.fileFail")), { code: "pick_failed" });
      }
      // 2. open. A password-protected file is skipped without any prompt (BM4).
      let info;
      try {
        info = await api().openGrant(grant, { name: item.path });
      } catch (e) {
        if (e.code === "password_required" || e.code === "password_invalid") {
          item.status = "encrypted";
          item.message = e.code;
          return;
        }
        throw e;
      }
      let assetId = info.assetId;
      let current = info; // the document the next step runs against
      // 3. optional split; the batch word list is splitMode/rows/cols, the
      //    rest of the split vocabulary rides the route defaults.
      if (splitOn) {
        const splitRes = await api().request("/api/pdf/split", {
          method: "POST",
          body: {
            assetId,
            splitMode: String(f["api.batch.splitMode"] || "auto"),
            rows: num(f["api.batch.rows"], 2),
            cols: num(f["api.batch.cols"], 2),
            customCuts: [],
            vetoPages: [],
            splitPages: "all",
          },
        });
        assetId = splitRes.assetId;
        current = splitRes;
      }
      // 4. stamp the preset parameters with the shared sealId; the preset's
      //    pages list is resolved against THIS document (pagesForDoc).
      const total = (current && current.pages ? current.pages.length : 0) || 1;
      const entry = applyInstance(preset.params || {}, sealId);
      entry.pages = pagesForDoc(entry.pages, total);
      const applyRes = await api().request("/api/pdf/apply", {
        method: "POST",
        body: { assetId, instances: [entry] },
      });
      assetId = applyRes.assetId;
      // 5. raster export: pages rendered client-side, uploaded as page-<n>.
      const parts = await renderRaster(assetId, dpi, quality);
      const exportRes = await api().uploadMultipart(
        "/api/pdf/export",
        { spec: JSON.stringify({ assetId, mode: "raster", dpi, quality, pages: "all" }) },
        parts.map((p) => ({ name: `page-${p.n}`, blob: p.blob, filename: `page-${p.n}` })),
      );
      // 6. save into <dirPath>\_batch with mkdirs (the folder may not exist).
      const target = batchTarget(dirPath, item.path, dpi, quality);
      const saveRes = await api().request("/api/pdf/save", {
        method: "POST",
        body: { assetId: exportRes.assetId, targetPath: target, mkdirs: true },
      });
      item.status = "ok";
      item.out = (saveRes && saveRes.message) || target;
    } catch (e) {
      item.status = "fail";
      item.message = `${e.code || "error"}: ${e.message}`;
    }
  }

  async function startBatch() {
    const s = shell();
    if (!s || st.running) return false;
    // BR6: a batch without a preset does not start.
    const f = s.fields();
    const presetName = String(f["api.batch.presetName"] || "").trim();
    if (!presetName) {
      s.toast("warn", t("batch.noPreset"));
      return false;
    }
    st.running = true;
    st.stopRequested = false;
    try {
      // 1. resolve the folder: typed path first, else the native dialog.
      let dirPath = String(f["api.batch.dirPath"] || "").trim();
      let picked;
      if (dirPath) picked = await api().pick({ dir: true, filePath: dirPath, filter: "pdf" });
      else picked = await api().pick({ dir: true, filter: "pdf" });
      if (!picked || picked.cancelled) {
        st.running = false;
        return false;
      }
      dirPath = picked.dirPath || dirPath;
      const picks = (picked.picks || []).filter((p) => p && p.path);
      if (!picks.length) {
        s.toast("warn", t("batch.empty"));
        st.running = false;
        renderQueue();
        return false;
      }
      s.setParams({ "api.batch.dirPath": dirPath });
      st.dirPath = dirPath;
      // 2. the preset's image bytes → one sealId shared by the whole run.
      const preset = st.presets.find((p) => p.name === presetName);
      if (!preset) throw Object.assign(new Error(t("batch.noPreset")), { code: "preset_not_found" });
      const bytes = await api().rawBytes(api().presetRawURL(preset.name));
      const file = new File([bytes], `${preset.name}.png`, { type: "image/png" });
      const meta = await api().sealPrepare(file, {
        despill: preset.params && preset.params.despill !== false,
        alphaTrim: preset.params && preset.params.alphaTrim !== false,
        resampleDpi: num(preset.params && preset.params.resampleDpi, 300),
      });
      // 3. resolve the raster parameters (BM1) from the panel fields.
      const dpiSeg = String(f["api.batch.dpi"] || "150");
      const dpi = dpiSeg === "custom" ? num(f["api.batch.customDpi"], 150) : num(dpiSeg, 150);
      const quality = num(f["api.batch.quality"], 75);
      const splitOn = Boolean(f["api.batch.autoSplit"]);
      st.queue = picks.map((p) => ({ path: p.path, grant: p.pathGrantId, status: "pending", message: "", out: "" }));
      renderQueue();
      s.toast("ok", t("ok.batch.started").replace("%d", String(st.queue.length)));
      // 4. the front-end queue: at most `concurrency` files run at once.
      const workers = Math.min(8, Math.max(1, num(f["api.batch.concurrency"], 2)));
      let next = 0;
      const loop = async () => {
        for (;;) {
          if (st.stopRequested) return;
          const i = next++;
          if (i >= st.queue.length) return;
          await runOne(st.queue[i], preset, meta.sealId, dirPath, dpi, quality, splitOn);
          renderQueue();
        }
      };
      await Promise.all(Array.from({ length: workers }, loop));
      st.running = false;
      renderQueue();
      // 5. the report toast; a stopped run says so instead of claiming done.
      if (st.stopRequested) {
        s.toast("warn", t("batch.stopped"));
      } else {
        const ok = st.queue.filter((i) => i.status === "ok").length;
        const rest = st.queue.length - ok;
        s.toast("ok", t("ok.batch.done").replace("%d", String(ok)).replace("%d", String(rest)));
      }
      return true;
    } catch (e) {
      st.running = false;
      renderQueue();
      s.toast("error", `${e.code || "batch"}: ${e.message}`);
      return false;
    }
  }

  function stopBatch() {
    if (!st.running) return false;
    st.stopRequested = true;
    return true;
  }

  // ---------- report download (Blob + a[download], no request) ----------

  function reportRows() {
    return st.queue.map((i) => ({
      file: i.path,
      status: i.status,
      output: i.out || "",
      message: i.message || "",
    }));
  }

  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = doc.createElement("a");
    a.href = url;
    a.download = name;
    doc.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function exportReport(kind) {
    const rows = reportRows();
    if (!rows.length) {
      shell().toast("warn", t("batch.empty"));
      return false;
    }
    let blob;
    if (kind === "json") {
      blob = new Blob([JSON.stringify({ dirPath: st.dirPath, files: rows }, null, 2)], { type: "application/json" });
      download("batch-report.json", blob);
    } else {
      const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;
      const csv = ["file,status,output,message"]
        .concat(rows.map((r) => [r.file, r.status, r.output, r.message].map(cell).join(",")))
        .join("\r\n");
      blob = new Blob([csv], { type: "text/csv" });
      download("batch-report.csv", blob);
    }
    return true;
  }

  // ---------- binding ----------

  function bind() {
    // Handlers resolve shell()/api() lazily: defer scripts run before
    // app-shell.js has executed, so bind() must not need the shell — only
    // the first list refresh does, and that one waits for DOMContentLoaded.
    const on = (id, fn) => {
      const el = doc.getElementById(id);
      if (el) el.addEventListener("click", fn);
    };
    on("seal-preset-save", () => savePreset());
    on("seal-preset-load", () => loadPreset());
    on("seal-preset-delete", () => deletePreset());
    on("batch-pick-dir", async () => {
      // The dialog channel: the server answers {dirPath, picks[]} one level deep.
      const s = shell();
      try {
        const res = await api().pick({ dir: true, filter: "pdf" });
        if (!res || res.cancelled || !res.dirPath || !s) return;
        s.setParams({ "api.batch.dirPath": res.dirPath });
      } catch (e) {
        if (s) s.toast("error", `${e.code}: ${e.message}`);
      }
    });
    on("batch-start", () => startBatch());
    on("batch-cancel", () => stopBatch());
    on("batch-export-csv", () => exportReport("csv"));
    on("batch-export-json", () => exportReport("json"));
    // The first preset list load is the only thing that needs the shell; when
    // app-batch runs before app-shell (the defer order), DCL is the ready mark.
    const kick = () => {
      const s = shell();
      if (!s) return;
      refreshPresets().catch((e) => s.toast("error", `${e.code || "preset_list"}: ${e.message}`));
    };
    if (shell() && api()) kick();
    else doc.addEventListener("DOMContentLoaded", kick, { once: true });
    st.bound = true; // verify hook: proves bind() ran to completion
  }

  // probe is the batch-smoke hook: the same no-private-state rule the shell
  // follows — everything reported here is what the UI rendered.
  function probe(name) {
    switch (name) {
      case "presets":
        return st.presets.map((p) => ({ name: p.name, imageBytes: p.imageBytes, params: p.params }));
      case "queue":
        return st.queue.map((i) => ({ path: i.path, status: i.status, out: i.out || "", message: i.message || "" }));
      case "running":
        return st.running;
      case "report":
        return {
          dirPath: st.dirPath,
          total: st.queue.length,
          ok: st.queue.filter((i) => i.status === "ok").length,
          failed: st.queue.filter((i) => i.status === "fail").length,
          encrypted: st.queue.filter((i) => i.status === "encrypted").length,
        };
      case "bound":
        return Boolean(st.bound);
      case "target":
        return batchTarget(st.dirPath || "C:\\dir", "C:\\dir\\doc.pdf", 150, 75);
      default:
        throw new Error(`unknown batch probe: ${name}`);
    }
  }

  window.__autoStampBatch = {
    probe,
    refreshPresets,
    startBatch,
    stopBatch,
    savePreset,
    loadPreset,
    deletePreset,
    exportReport,
  };

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
