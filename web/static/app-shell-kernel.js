// Copyright 2026 AutoStamp Authors. SPDX-License-Identifier: Apache-2.0
// app-shellkernel.js — part of the app-shell module group (split from
// app-shell.js on 2026-11-05; docs/IMPLEMENTATION_PLAN.md §10.1). the shared kernel: state, i18n, field binding, persist plumbing.
(() => {
  "use strict";

  const q = (sel, root) => (root || document).querySelector(sel);

  const qa = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const doc = document;

  const html = doc.documentElement;


  // The facade object is created first so the *other* shell modules (and this
  // one) can cross-reference through the shared `S` while their own code runs.
  const S = window.__autoStampShell = {};

  // STATES mirrors docs/UI_SPEC.md §1. The shell drives <html data-state>; the
  // CSS rules in style.css are what actually show/hide surfaces.
  const STATES = [
    "empty", "open-error", "opened", "stamp-selected", "stamp-dragging",
    "stamp-resizing", "split-preview", "crosspage", "export", "save-confirm",
    "replace-confirm", "password-error",
  ];


  // PERSIST maps a UI_SPEC §2 field to the config.Settings path it saves under
  // (field names are identical on purpose, AGENTS §6). Fields listed as "-" in
  // the spec stay transient. SP1 (2026-11-05): the seal-panel, split-panel,
  // crosspage-sidebar and batch-panel fields lost their controls; the
  // settings groups themselves stay (the Go config still carries them and
  // the §7 drive API still reads server-side defaults).
  const PERSIST = {
    "ui.lang": ["ui", "lang"],
    "ui.theme": ["ui", "theme"],
    "api.apply.blend": ["apply", "blend"],
    "api.apply.opacity": ["apply", "opacity"],
    "api.apply.brightness": ["apply", "brightness"],
    "api.apply.saturate": ["apply", "saturate"],
    "api.apply.ink": ["apply", "ink"],
    "api.apply.scale": ["apply", "scale"],
    "api.apply.pos": ["apply", "pos"],
    "api.apply.anchor": ["apply", "anchor"],
    "api.apply.offset": ["apply", "offset"],
    "api.apply.rotation": ["apply", "rotation"],
    "api.apply.pages": ["apply", "pages"],
    "api.apply.crossPage": ["apply", "crossPage"],
    "ui.crosspage.binding": ["apply", "binding"],
    "api.apply.startOffset": ["apply", "startOffset"],
    "ui.crosspage.cover": ["apply", "cover"],
    "api.export.mode": ["export", "mode"],
    "api.export.dpi": ["export", "dpi"],
    "api.export.customDpi": ["export", "customDpi"],
    "api.export.quality": ["export", "quality"],
    "api.export.pages": ["export", "pages"],
  };


  const NUMERIC = new Set([
    "opacity", "brightness", "saturate", "ink", "scale", "rotation",
    "startOffset", "customDpi", "quality", "cover",
  ]);


  const api = window.__autoStampApi;

  const i18n = window.__autoStampI18n;


  const state = {
    lang: "en",
    theme: "light",
    version: "", // GET /api/health version — the topbar/window title carrier
    settings: null,
    warning: "",
    instances: [],
    nextInstance: 1,
    selected: null,
    modal: null,
    file: null, // {path, assetId} once P1 opens a PDF
    assets: { open: "", split: "", apply: "", export: "", save: "" }, // assetId per route (UI_SPEC §2 asset hooks)
    pending: null, // the open that asked for a password, so Retry can replay it
    lastGrant: "", // last pathGrantId the picker returned (readout chip)
    saveGrant: null, // pathGrantId for the save dialog's target (P4 writes it)
    saveGrantPath: "", // the path the grant covers, so the text box can be edited
    splitChain: null, // previous document snapshot for 撤销切分
    applyChain: null, // previous document + instances for 撤销盖章
    vetoed: new Set(), // D3: page numbers the split must skip
    lastInfo: null, // the answer that opened the current document
    // HD18 (2026-11-05): the floating panel starts collapsed into the gear fab.
    panelCollapsed: true,
    // HD8/HD9/HD10: the seal channel - the seal everything new works with
    // ({sealId, name, path}; null = nothing opened yet).
    currentSeal: null,
    addMode: false, // HD10: fresh off on every load (never persisted)
    // SP4 (2026-11-05): the cross-page placement mode — same session-only
    // lifecycle as addMode, the topbar button beside it is the entry.
    crosspageAdd: false,
  };


  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));


  // ---------- i18n ----------

  // labelFor resolves a key: CATALOG wins, otherwise the element's own text is
  // the en value and data-i18n-cn the cn value (UI_SPEC §4 rule).
  function pairFor(el, kind) {
    const attr = kind === "placeholder" ? "data-i18n-placeholder" : kind === "title" ? "data-i18n-title" : "data-i18n";
    const key = el.getAttribute(attr);
    if (!key) return null;
    const entry = i18n && i18n.CATALOG[key];
    if (entry) return { key, en: entry.en, cn: entry.cn };
    const cnAttr = kind === "placeholder" ? "data-i18n-cn-placeholder" : kind === "title" ? "data-i18n-title-cn" : "data-i18n-cn";
    const cn = el.getAttribute(cnAttr);
    if (!cn) return null;
    let en = null;
    if (kind === "placeholder") en = el.getAttribute("placeholder");
    else if (kind === "title") en = el.getAttribute("title");
    else en = el.textContent.trim();
    return { key, en, cn };
  }


  function applyLang(lang) {
    state.lang = lang === "cn" ? "cn" : "en";
    html.lang = state.lang === "cn" ? "zh-CN" : "en";
    html.dataset.lang = state.lang;
    qa("[data-i18n], [data-i18n-placeholder]").forEach((el) => {
      // Two independent attributes: an element can carry both a label key and a
      // placeholder key (e.g. an input with a visible label chip), so each axis
      // is applied on its own rather than by sniffing which one is present.
      if (el.hasAttribute("data-i18n")) {
        const p = pairFor(el, "text");
        if (p) el.textContent = state.lang === "cn" ? p.cn : p.en;
      }
      if (el.hasAttribute("data-i18n-placeholder")) {
        const p = pairFor(el, "placeholder");
        if (p) el.setAttribute("placeholder", state.lang === "cn" ? p.cn : p.en);
      }
    });
    // HD1: the remaining topbar controls are icons, so their accessible name is
    // the tooltip/aria-label pair, not visible text.
    qa("[data-i18n-title]").forEach((el) => {
      const p = pairFor(el, "title");
      if (!p) return;
      const text = state.lang === "cn" ? p.cn : p.en;
      el.setAttribute("title", text);
      el.setAttribute("aria-label", text);
    });
    qa("#lang-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === state.lang)));
    S.renderInstances();
    persist("ui", { lang: state.lang });
    // The readouts whose text is dynamic (the assetId chips) are rebuilt after
    // the generic i18n pass, so the numbers survive a language switch instead
    // of being overwritten by the label alone.
    renderAssetHooks();
    doc.dispatchEvent(new CustomEvent("autostamp:lang", { detail: { lang: state.lang } }));
    return state.lang;
  }


  // ---------- view state ----------

  function setState(name) {
    if (!STATES.includes(name)) throw new Error(`unknown state: ${name}`);
    html.dataset.state = name;
    // SP1 (2026-11-05): the crosspage/split-preview state branches died with
    // their sidebar sections; the state machine still carries both names.
    // SP5 (2026-11-06): the "export" auto-open branch died with the sidebar -
    // #panel-export now lives inside the save dialog; the state name stays.
    return name;
  }


  function applyTheme(t) {
    if (!["light", "dark"].includes(t)) throw new Error(`unknown theme: ${t}`);
    state.theme = t;
    html.dataset.theme = t;
    qa("#theme-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === t)));
    persist("ui", { theme: t });
    return t;
  }


  // ---------- toast / modals ----------

  let toastTimer = 0;

  function toast(kind, msg) {
    const el = q("#error-toast");
    el.className = kind === "ok" || kind === "warn" ? kind : "";
    el.dataset.level = kind;
    el.dataset.open = "true";
    el.textContent = msg;
    clearTimeout(toastTimer);
    if (kind !== "error") toastTimer = setTimeout(clearToast, 6000);
    return msg;
  }


  function clearToast() {
    const el = q("#error-toast");
    el.dataset.open = "false";
    el.textContent = "";
    return "";
  }


  const MODALS = ["save-modal", "confirm-modal", "password-modal", "shortcuts-modal"];


  function setModal(id) {
    MODALS.forEach((m) => {
      const el = q("#" + m);
      el.dataset.open = String(m === id);
      if (m === id) q("#modal-layer").dataset.open = "true";
    });
    if (!id) q("#modal-layer").dataset.open = "false";
    state.modal = id || null;
    if (id === "save-modal") {
      q("#save-source").textContent = state.file ? state.file.path : t("top.file.hint");
      q("#save-modal").dataset.hasFile = String(!!state.file);
    }
    if (id === "confirm-modal") q("#confirm-path").textContent = state.file ? state.file.path : t("top.file.hint");
    return id || "";
  }


  function t(key) {
    const e = i18n && i18n.CATALOG[key];
    if (!e) return key;
    return state.lang === "cn" ? e.cn : e.en;
  }


  // ---------- field binding ----------

  // A data-field element is a control unless it is a display-only span chip
  // (file name, asset id, the 2-up chip). Segment groups are DIVs and are
  // controls, so they must not be filtered out.
  function fieldEls(name) {
    return qa(`[data-field="${name}"]`).filter((el) => el.tagName !== "SPAN");
  }


  function readField(name) {
    const el = fieldEls(name)[0];
    if (!el) return undefined;
    if (el.type === "checkbox") return el.checked;
    if (el.classList.contains("seg")) return el.querySelector("button[aria-pressed='true']")?.dataset.value;
    if (NUMERIC.has(name.split(".").pop())) return Number(el.value);
    return el.value;
  }


  function writeField(name, value) {
    const el = fieldEls(name)[0];
    if (!el) return;
    if (el.type === "checkbox") el.checked = Boolean(value);
    else if (el.classList.contains("seg")) {
      qa("button", el).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === String(value))));
    } else el.value = String(value);
  }


  // fields() snapshots every writable control — the verify hook and the
  // request builder share it.
  function fields() {
    const out = {};
    qa("[data-field]").forEach((el) => {
      const name = el.getAttribute("data-field");
      if (el.tagName === "SPAN") return; // display-only chip, not a control
      if (out[name] === undefined) out[name] = readField(name);
    });
    return out;
  }


  function setParams(patch) {
    Object.entries(patch || {}).forEach(([name, value]) => {
      if (name === "ui.lang") return applyLang(value);
      if (name === "ui.theme") return applyTheme(value);
      writeField(name, value);
      // The verify hook drives the same events a real edit fires, so the
      // persist path and any side-effect handlers run exactly as in the UI.
      fieldEls(name).forEach((el) => {
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
    return fields();
  }


  // ---------- settings ----------

  let persistTimer = 0;

  function persist(group, kv) {
    if (!api) return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      api.patchSettings({ [group]: kv })
        .then((res) => {
          state.settings = res.settings;
          // HD12: the persisted group doubles as the "Reset" target — keep
          // the snapshot in step with whatever settings the server accepted.
          if (group === "apply") captureDefaults();
          if (res.warning) toast("warn", res.warning);
        })
        .catch((e) => toast("error", `${e.code}: ${e.message}`));
    }, 120);
  }


  function applySettings(s) {
    if (!s) return;
    if (s.ui) {
      if (s.ui.theme) applyTheme(s.ui.theme);
      if (s.ui.lang) applyLang(s.ui.lang);
      // HD16: the persisted visibility restores the backend-terminal panel.
      S.setConsoleVisible(Boolean(s.ui.consoleVisible), false);
    }
    const pairs = [
      // SP1: the seal-prepare options, the split vocabulary and the batch
      // group lost their controls - the server-side defaults (Go config) are
      // what seal/apply/export/split now run on.
      ["apply", ["blend", "opacity", "brightness", "saturate", "ink", "scale", "pos", "anchor", "offset", "rotation", "pages", "crossPage", "binding", "startOffset", "cover"]],
      ["export", ["mode", "dpi", "customDpi", "quality", "pages"]],
    ];
    for (const [group, keys] of pairs) {
      const src = s[group] || {};
      for (const k of keys) {
        const field = fieldForSetting(group, k);
        if (field && src[k] !== undefined) writeField(field, src[k]);
      }
    }
    // HD12: the persisted apply.* group doubles as the "Reset" target —
    // recapture the snapshot whenever settings land (boot only rewrites the
    // controls once, so user edits of the panel never poison it).
    captureDefaults();
  }


  function fieldForSetting(group, key) {
    for (const [field, path] of Object.entries(PERSIST)) {
      if (path[0] === group && path[1] === key) return field;
    }
    return null;
  }



  // ---------- P2: instance parameters and the canvas hand-off ----------
  //
  // The panel's apply-group controls edit the *selected instance*. Every edit
  // both stores the value and asks the overlay to repaint, so the panel, the
  // drag handles and the canvas never disagree (UI_SPEC §3).

  const APPLY_FIELDS = new Set(
    Object.keys(PERSIST).filter((f) => f.startsWith("api.apply.") || f.startsWith("ui.crosspage."))
  );


  // HD12: "Reset" and every new instance answer to the *default snapshot* —
  // the panel controls mirror the selected instance (loadParams), so reading
  // them live would echo the current values back and the button would be a
  // no-op. The snapshot comes from boot + every applySettings round-trip.
  let DEFAULT_PARAMS = null;


  function captureDefaults() {
    const p = {};
    for (const f of APPLY_FIELDS) {
      const v = readField(f);
      if (v !== undefined) p[f] = v;
    }
    // HD12: the geometry channels have no controls any more (the position
    // grid and the anchor/offset row are gone): instances always answer to
    // `center` + offset, and the offset means "page point to stamp". The
    // server still reads an explicit pos for the stamp-all-pages defaults,
    // but the canvas never asks for it.
    p["api.apply.anchor"] = "center";
    p["api.apply.offset"] = "0,0";
    DEFAULT_PARAMS = p;
    return p;
  }


  function defaultParams() {
    if (DEFAULT_PARAMS) return Object.assign({}, DEFAULT_PARAMS);
    return captureDefaults();
  }


  // currentPageWord resolves the page an instance should answer to (HD11):
  // the page the preview shows, as the server's pages vocabulary.
  function currentPageWord() {
    const pv = window.__autoStampPreview;
    const n = pv && pv.state && pv.state.page ? pv.state.page : 1;
    return String(n);
  }


  function instanceById(id) {
    return state.instances.find((i) => i.id === id) || null;
  }


  function selectedInstance() {
    return instanceById(state.selected);
  }


  function notify(name, detail) {
    doc.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  }


  let loadingParams = false;


  function loadParams(inst) {
    if (!inst) return;
    loadingParams = true;
    try {
      for (const [field, value] of Object.entries(inst.params || {})) writeField(field, value);
    } finally {
      loadingParams = false;
    }
    notify("autostamp:param", { instance: inst.id, loaded: true });
  }


  function syncInstanceParam(field, value) {
    const inst = selectedInstance();
    if (!inst) return;
    inst.params = inst.params || defaultParams();
    if (inst.params[field] === value) return;
    inst.params[field] = value;
    if (field === "api.apply.crossPage") {
      inst.crossPage = Boolean(value);
      // CP1/HD11: a cross-page stamp spans every page it lands on; a plain
      // stamp stays with the page it was created on.
      if (value) inst.params["api.apply.pages"] = "all";
    }
    S.renderInstances();
    notify("autostamp:param", { field, value, instance: inst.id });
  }


  // setParam is the drag/keyboard route. Controls that exist (the floating
  // panel's blend/opacity/... sliders) answer through the change events, so
  // the settings persist timer and syncInstanceParam run exactly like a real
  // edit. Geometry channels that lost their controls in HD12 (offset, and
  // the retired pos) live on the instance itself.
  function setParam(field, value) {
    const els = fieldEls(field);
    if (!els.length) {
      const inst = selectedInstance();
      if (!inst) return undefined;
      inst.params = inst.params || defaultParams();
      inst.params[field] = value;
      if (field === "api.apply.crossPage") inst.crossPage = Boolean(value);
      S.renderInstances();
      notify("autostamp:param", { field, value, instance: inst.id });
      return value;
    }
    if (field === "api.apply.scale") growScaleSliders(Number(value));
    writeField(field, value);
    els.forEach((el) => {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    return readField(field);
  }


  // HD12: the scale slider's stated range is 10%..200%, but a corner drag or
  // the +/- keys can push past 200% (V7 removed the wheel from that route).
  // A range input clamps the
  // value to its max, so the slider is stretched (up to the vocabulary's 5)
  // before the value is written - that is how an overshoot shows on the
  // slider instead of being hidden behind it.
  function growScaleSliders(value) {
    if (!Number.isFinite(value)) return;
    fieldEls("api.apply.scale").forEach((el) => {
      if (el.type !== "range") return;
      const need = Math.min(5, Math.max(2, value));
      if (Number(el.max) < need) el.max = String(+need.toFixed(2));
    });
  }

  // baseName strips the extension from a path for menu labels (HD8); the seal
  // channel itself lives in app-shell-seals.js.
  function baseName(path) {
    const part = String(path || "").split(/[\\/]/).pop() || "";
    const dot = part.lastIndexOf(".");
    return dot > 0 ? part.slice(0, dot) : part;
  }


  function queuePersist(name) {
    const path = PERSIST[name];
    if (!path) return; // transient field (filePath, pw, targetPath, ...)
    const key = path[1];
    const value = readField(name);
    persist(path[0], { [key]: NUMERIC.has(key) ? Number(value) : value });
    if (String(name).indexOf("api.export.") === 0) S.refreshEstimate();

  }



  // ---------- page/vocabulary helpers shared by every module ----------
  //
  // normalisePages keeps the UI frame and the write side from disagreeing about
  // a rotated page: after this, width/height are the extent the user sees and
  // rotation is 0.
  function normalisePages(pages) {
    return pages.map((pg) => {
      const rot = Math.abs(Number(pg.rotation) || 0) % 180;
      if (rot === 0) return { ...pg };
      return { ...pg, width: Number(pg.height) || 0, height: Number(pg.width) || 0, rotation: 0 };
    });
  }


  // resolvePages turns the pages vocabulary (UI_SPEC §2.2, shared by
  // api.apply.pages and api.split.pages) into 1-based page numbers. "none"
  // resolves to the empty list, which the routes report instead of cutting
  // everything.
  function resolvePages(raw, total) {
    const v = String(raw === undefined || raw === null ? "all" : raw).trim();
    if (v === "none") return [];
    if (v === "" || v === "all") {
      const all = [];
      for (let i = 1; i <= total; i++) all.push(i);
      return all;
    }
    const out = [];
    v.split(/[,;\s]+/).forEach((tok) => {
      if (!tok) return;
      const m = tok.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) return;
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
        if (i >= 1 && i <= total && out.indexOf(i) < 0) out.push(i);
      }
    });
    return out;
  }


  function numAt(params, field, fallbackField) {
    const v = params && params[field] !== undefined ? params[field] : readField(fallbackField);
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }


  // displayDims mirrors internal/pdfcore/stamp.go DisplaySize: the page extent
  // the user sees, i.e. MediaBox with /Rotate applied (UI_SPEC §8 C1 frame).
  function displayDims(pg) {
    const w = Number(pg.width) || 0;
    const h = Number(pg.height) || 0;
    const rot = Math.abs(Number(pg.rotation) || 0) % 180;
    return rot === 0 ? { width: w, height: h } : { width: h, height: w };
  }


  // Z2 (2026-11-09, 用户指令): new instances get their scale from the page's
  // SHORT edge and the default seal is 42 mm wide (default paper A4). scale is
  // the fraction-of-PAGE-WIDTH contract, so a portrait page's width IS the
  // short edge and 42/short lands the seal at exactly 42 mm; on a landscape
  // page the same 42 mm target divided by the (long) display width is what
  // keeps the seal at 42 mm — the orientation check (displayDims swaps for
  // /Rotate) decides which physical edge the fraction applies to.
  const SEAL_DEFAULT_MM = 42;
  const MM_TO_PT = 72 / 25.4;
  const A4_SHORT_PT = 210 * MM_TO_PT; // 595.28 pt = A4 短边（fallback 用）


  function autoScale() {
    const page = Number(currentPageWord()) || 1;
    const dims = (state.file && (state.file.pages || [])[page - 1]) || null;
    let width = A4_SHORT_PT; // 未打开文档按 A4 竖版短边
    if (dims) {
      const d = displayDims(dims);
      if (d.width > 0) width = d.width;
    }
    return Math.max(0.05, Math.min(5, +((SEAL_DEFAULT_MM * MM_TO_PT) / width).toFixed(4)));
  }


  // setDocTitle writes the window title (HD2, revised by HD5): main.go builds the
  // native caption from the same string, and document.title carries it for the
  // browser tab. The topbar no longer mirrors it - it has no text at all.
  function setDocTitle() {
    const base = `AutoStamp${state.version ? ` ${state.version}` : ""}`;
    doc.title = state.file ? `${base} ${state.file.name}` : base;
  }


  // formatBytes keeps the units language-neutral (KB/MB are not i18n strings).
  function formatBytes(n) {
    if (!n && n !== 0) return "-";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }


  // renderAssetHooks paints the internal readouts: the assetId each route
  // produced, plus the last pathGrantId the picker returned. SP1 (2026-11-05)
  // removed the #asset-hooks container at the top of the sidebar - the
  // assetId ledger (state.assets) stays internal (probe('assets') still reads
  // it); only the grant chip in the empty state / save modal is still a
  // visible readout, so this stays for the language-switch re-label only.
  function renderAssetHooks() {
    qa("[data-field='api.fs.pick.pathGrantId']").forEach((el) => {
      const id = state.lastGrant || "";
      el.textContent = id || "-";
      el.title = `${t("api.fs.pick.pathGrantId.ctl")}: ${id || "-"}`;
    });
  }

  // bindPlumbing was the head of bindControls: the apply-group capture feed,
  // the slider<->number pairs and the generic persist bindings. It runs at
  // parse time (the scripts sit at the end of <body>, so the controls exist).
  function bindPlumbing() {

    // P2: every apply-group edit feeds the selected instance and asks the
    // overlay to repaint (UI_SPEC §3). capture-phase keeps the pair sliders
    // and the number inputs on the same path.
    doc.addEventListener(
      "input",
      (e) => {
        const el = e.target;
        const name = el && el.getAttribute ? el.getAttribute("data-field") : null;
        if (!name || !APPLY_FIELDS.has(name) || loadingParams) return;
        syncInstanceParam(name, readField(name));
      },
      true,
    );
    // pairs: slider <-> number sharing one data-field
    const pairs = new Map();
    qa("[data-field]").forEach((el) => {
      const name = el.getAttribute("data-field");
      if (!fieldEls(name).includes(el)) return;
      if (!pairs.has(name)) pairs.set(name, []);
      pairs.get(name).push(el);
    });
    for (const [name, els] of pairs) {
      if (els.length < 2) continue;
      els.forEach((el) => {
        el.addEventListener("input", () => {
          els.forEach((other) => { if (other !== el) other.value = el.value; });
          queuePersist(name);
        });
      });
    }
    qa("[data-field]").forEach((el) => {
      const name = el.getAttribute("data-field");
      if (!fieldEls(name).includes(el)) return;
      if (el.type === "checkbox") {
        el.addEventListener("change", () => queuePersist(name));
      } else if (el.tagName === "SELECT") {
        el.addEventListener("change", () => queuePersist(name));
      } else if (el.tagName === "INPUT") {
        // Single (unpaired) text/number controls must persist on edit too; the
        // persist timer coalesces the pair handler's duplicate call.
        el.addEventListener("input", () => queuePersist(name));
        el.addEventListener("change", () => queuePersist(name));
      }
    });

  }
  bindPlumbing();

  // The "Reset" target mirror (UI_SPEC §7 probe('defaults')).
  function defaultsProbe() {
    return DEFAULT_PARAMS ? { ...DEFAULT_PARAMS } : captureDefaults();
  }

  Object.assign(S, {
    STATES, state, escapeHtml, pairFor, applyLang, applyTheme, setState, t, toast, clearToast,
    setModal, fields, setParams, readField, writeField, fieldEls, persist, queuePersist,
    notify, applySettings, captureDefaults, defaultParams, defaultsProbe, currentPageWord,
    instanceById, selectedInstance, loadParams, syncInstanceParam, setParam, APPLY_FIELDS,
    baseName, numAt, resolvePages, normalisePages, displayDims, autoScale, formatBytes, setDocTitle,
    renderAssetHooks, q, qa,
    currentSeal: () => (state.currentSeal ? state.currentSeal.sealId : null),
  });
})();
