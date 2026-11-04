// Copyright 2026 AutoStamp Authors. SPDX-License-Identifier: Apache-2.0
// app-shell.js — the P0/P1 shell: state machine, i18n, theme, panel
// field binding, instance list, modals and shortcuts. No PDF geometry here
// (P1 renders pages, P2 drags seals); the shell only owns contract state.
//
// window.__autoStampShell is the verify hook (docs/UI_SPEC.md §7 mirror) used by
// tools/verify/shell-smoke.mjs.
(() => {
  "use strict";

  const q = (sel, root) => (root || document).querySelector(sel);
  const qa = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const doc = document;
  const html = doc.documentElement;

  // STATES mirrors docs/UI_SPEC.md §1. The shell drives <html data-state>; the
  // CSS rules in style.css are what actually show/hide surfaces.
  const STATES = [
    "empty", "open-error", "opened", "stamp-selected", "stamp-dragging",
    "stamp-resizing", "split-preview", "crosspage", "export", "save-confirm",
    "replace-confirm", "password-error",
  ];

  // PERSIST maps a UI_SPEC §2 field to the config.Settings path it saves under
  // (field names are identical on purpose, AGENTS §6). Fields listed as "-" in
  // the spec stay transient.
  const PERSIST = {
    "ui.lang": ["ui", "lang"],
    "ui.theme": ["ui", "theme"],
    "api.seal.prepare.despill": ["seal", "despill"],
    "api.seal.prepare.alphaTrim": ["seal", "alphaTrim"],
    "api.seal.prepare.resampleDpi": ["seal", "resampleDpi"],
    "api.apply.blend": ["apply", "blend"],
    "api.apply.opacity": ["apply", "opacity"],
    "api.apply.brightness": ["apply", "brightness"],
    "api.apply.saturate": ["apply", "saturate"],
    "api.apply.scale": ["apply", "scale"],
    "api.apply.pos": ["apply", "pos"],
    "api.apply.anchor": ["apply", "anchor"],
    "api.apply.offset": ["apply", "offset"],
    "api.apply.rotation": ["apply", "rotation"],
    "api.apply.pages": ["apply", "pages"],
    "api.apply.crossPage": ["apply", "crossPage"],
    "ui.crosspage.binding": ["apply", "binding"],
    "api.apply.startOffset": ["apply", "startOffset"],
    "api.split.auto": ["split", "auto"],
    "ui.split.mode": ["split", "mode"],
    "api.split.rows": ["split", "rows"],
    "api.split.cols": ["split", "cols"],
    "api.split.cutFractions": ["split", "cutFractions"],
    "api.split.pages": ["split", "pages"],
    "api.export.mode": ["export", "mode"],
    "api.export.dpi": ["export", "dpi"],
    "api.export.customDpi": ["export", "customDpi"],
    "api.export.quality": ["export", "quality"],
    "api.export.pages": ["export", "pages"],
    // P6 batch panel (BM1): the five control fields persist into the settings
    // batch group; the queue/report stay transient.
    "api.batch.presetName": ["batch", "presetName"],
    "api.batch.dpi": ["batch", "dpi"],
    "api.batch.customDpi": ["batch", "customDpi"],
    "api.batch.quality": ["batch", "quality"],
    "api.batch.concurrency": ["batch", "concurrency"],
  };

  const NUMERIC = new Set([
    "resampleDpi", "opacity", "brightness", "saturate", "scale", "rotation",
    "startOffset", "rows", "cols", "customDpi", "quality", "concurrency",
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
    renderInstances();
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
    if (name === "crosspage") q("#panel-crosspage").open = true;
    if (name === "split-preview") q("#panel-split").open = true;
    if (name === "export") q("#panel-export").open = true;
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
    }
    const pairs = [
      ["seal", ["despill", "alphaTrim", "resampleDpi"]],
      ["apply", ["blend", "opacity", "brightness", "saturate", "scale", "pos", "anchor", "offset", "rotation", "pages", "crossPage", "binding", "startOffset"]],
      ["split", ["auto", "mode", "rows", "cols", "cutFractions", "pages"]],
      ["export", ["mode", "dpi", "customDpi", "quality", "pages"]],
      // P6: the batch panel's five controls ride the same round-trip so a
      // restart restores the last-used preset/dpi/quality/concurrency.
      ["batch", ["presetName", "dpi", "customDpi", "quality", "concurrency"]],
    ];
    for (const [group, keys] of pairs) {
      const src = s[group] || {};
      for (const k of keys) {
        const field = fieldForSetting(group, k);
        if (field && src[k] !== undefined) writeField(field, src[k]);
      }
    }
  }

  function fieldForSetting(group, key) {
    for (const [field, path] of Object.entries(PERSIST)) {
      if (path[0] === group && path[1] === key) return field;
    }
    return null;
  }

  // ---------- instances (decision I1) ----------

  function renderInstances() {
    notify("autostamp:instance", {});
    const ul = q("#seal-instances");
    ul.textContent = "";
    for (const inst of state.instances) {
      const li = doc.createElement("li");
      li.dataset.instance = String(inst.id);
      li.setAttribute("aria-current", String(inst.id === state.selected));
      const name = doc.createElement("input");
      name.type = "text";
      name.value = inst.name;
      name.dataset.fieldRole = "name";
      name.placeholder = t("instances.rename.placeholder");
      name.setAttribute("aria-label", t("instances.rename.placeholder"));
      name.addEventListener("input", () => { inst.name = name.value; });
      const mode = doc.createElement("span");
      mode.className = "chip";
      mode.dataset.role = "mode";
      mode.textContent = inst.crossPage ? "cross-page" : "normal";
      const sel = doc.createElement("button");
      sel.type = "button";
      sel.className = "btn ghost";
      sel.dataset.action = "select";
      sel.textContent = inst.id === state.selected ? "●" : "○";
      sel.setAttribute("aria-label", `#${inst.id}`);
      li.append(name, mode, sel);
      li.addEventListener("click", (e) => {
        if (e.target === name) return;
        selectInstance(inst.id);
      });
      ul.append(li);
    }
    // CP1: the strip zoom belongs to the selected instance's parameters, and
    // renderInstances runs on every parameter edit, so this keeps it live.
    renderStripPreviews();
  }

  function addInstance(name, params) {
    const inst = {
      id: state.nextInstance++,
      name: name || `Seal ${state.instances.length + 1}`,
      crossPage: Boolean(readField("api.apply.crossPage")),
      // P2: the panel's apply-group values are this instance's parameters;
      // settings.json only carries the group as the defaults for a new one.
      params: params || defaultParams(),
      sealId: null,
      // U1: which position control this instance answers to. `pos` sends the
      // page point; `anchor` sends corner + offset. The overlay keeps both in
      // sync so one geometry shows in both boxes (UI_SPEC §8 U1).
      geomMode: "anchor",
    };
    state.instances.push(inst);
    state.selected = inst.id;
    renderInstances();
    return inst.id;
  }

  function selectInstance(id) {
    const prev = state.selected;
    state.selected = id;
    renderInstances();
    if (id !== prev) loadParams(instanceById(id));
    setState(id ? "stamp-selected" : "opened");
    return id;
  }

  function deleteSelected() {
    if (state.selected === null) return null;
    if (state.instances.length <= 1) {
      toast("warn", t("instances.err.last"));
      return null;
    }
    const id = state.selected;
    state.instances = state.instances.filter((i) => i.id !== id);
    state.selected = state.instances[0].id;
    renderInstances();
    return id;
  }

  function duplicateSelected() {
    const src = instanceById(state.selected);
    const inst = {
      id: state.nextInstance++,
      name: src ? `${src.name} *` : `Seal ${state.instances.length + 1}`,
      crossPage: src ? src.crossPage : false,
      params: src ? { ...src.params } : defaultParams(),
      sealId: src ? src.sealId : null,
      geomMode: src ? src.geomMode || "anchor" : "anchor",
    };
    state.instances.push(inst);
    state.selected = inst.id;
    renderInstances();
    loadParams(inst);
    return inst.id;
  }


  // ---------- P2: instance parameters and the canvas hand-off ----------
  //
  // The panel's apply-group controls edit the *selected instance*. Every edit
  // both stores the value and asks the overlay to repaint, so the panel, the
  // drag handles and the canvas never disagree (UI_SPEC §3).

  const APPLY_FIELDS = new Set(
    Object.keys(PERSIST).filter((f) => f.startsWith("api.apply.") || f === "ui.crosspage.binding")
  );

  function defaultParams() {
    const p = {};
    for (const f of APPLY_FIELDS) p[f] = readField(f);
    return p;
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
    if (field === "api.apply.crossPage") inst.crossPage = Boolean(value);
    // U1: the page-point box and the corner+offset pair describe one geometry.
    // Typing a point switches this instance to `pos` mode (the offset box then
    // means nothing, so it resets to "0,0" and the point the user typed is
    // where the box starts); every other position edit - corner, offset, drag,
    // corner-handle, wheel, rotation - answers to `anchor`, and the point box
    // is recomputed from the canvas box so both boxes stay truthful.
    if (field === "api.apply.pos") {
      inst.geomMode = "pos";
      inst.params["api.apply.offset"] = "0,0";
      writeField("api.apply.offset", "0,0");
    } else if (field === "api.apply.anchor" || field === "api.apply.offset") {
      inst.geomMode = "anchor";
    }
    if (inst.geomMode === "anchor") syncPosBox(inst);
    renderInstances();
    notify("autostamp:param", { field, value, instance: inst.id });
  }

  // syncPosBox mirrors the canvas box into the page-point box. The overlay owns
  // the geometry (anchor + offset + scale + seal aspect), so the shell asks it
  // for the rect instead of re-deriving the corners here.
  function syncPosBox(inst) {
    const ov = window.__autoStampOverlay;
    if (!ov || !ov.rectFor) return;
    const box = ov.rectFor(inst);
    if (!box) return;
    const v = `${box.x.toFixed(2)},${box.y.toFixed(2)}`;
    inst.params["api.apply.pos"] = v;
    writeField("api.apply.pos", v);
  }

  // setParam is the drag/keyboard route: it writes the control (so the panel
  // shows the truth) and the change events run, which feeds syncInstanceParam
  // and the settings persist timer exactly like a real edit.
  function setParam(field, value) {
    writeField(field, value);
    fieldEls(field).forEach((el) => {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    return readField(field);
  }

  function setSealForSelected(sealId) {
    const inst = selectedInstance();
    if (!inst) return null;
    inst.sealId = sealId;
    renderInstances();
    notify("autostamp:seal", { instance: inst.id, sealId });
    return inst.id;
  }

  // ---------- shortcuts (UI_SPEC §5) ----------

  const SHORTCUTS = [
    ["Ctrl+O / Ctrl+S", "open.hint", "save.hint"],
    ["Ctrl+V / 拖入", "load.paste.hint"],
    ["Ctrl+D / Del", "instances.duplicate.btn", "instances.delete.btn"],
    ["←↑↓→", "nudge.hint"],
    ["+ / −", "scale.hint"],
    ["1..9 / PgUp/PgDn", "page.hint"],
    ["Ctrl+wheel", "scale.hint"],
    ["Space + ←↑↓→ / Space + 左键拖动", "view.pan.hint"],
    ["Ctrl + 鼠标中键", "view.fit.hint"],
    ["Esc / ?", "esc.hint", "shortcuts.hint"],
  ];

  function renderShortcuts() {
    const tbl = q("#shortcuts-table");
    tbl.textContent = "";
    const head = doc.createElement("tr");
    const th1 = doc.createElement("th");
    th1.textContent = t("shortcuts.title");
    const th2 = doc.createElement("th");
    th2.textContent = "→";
    head.append(th1, th2);
    tbl.append(head);
    for (const row of SHORTCUTS) {
      const tr = doc.createElement("tr");
      const td1 = doc.createElement("td");
      td1.textContent = row[0];
      const td2 = doc.createElement("td");
      td2.textContent = row.slice(1).map((k) => t(k)).join(" / ");
      tr.append(td1, td2);
      tbl.append(tr);
    }
  }

  function parsePos(v) {
    const m = String(v || "").split(/[ ,]+/).map(Number);
    return [Number.isFinite(m[0]) ? m[0] : 0, Number.isFinite(m[1]) ? m[1] : 0];
  }

  function nudge(key, shift) {
    const step = shift ? 10 : 1;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[key];
    if (!delta) return false;
    // The keyboard route goes through setParam so the value lands in the
    // selected instance *and* the panel control stays the truth (P2).
    const [x, y] = parsePos(readField("api.apply.pos"));
    return setParam("api.apply.pos", `${x + delta[0]},${y + delta[1]}`);
  }

  function bumpScale(dir) {
    const v = Number(readField("api.apply.scale")) || 0;
    const next = Math.max(0.05, Math.min(0.9, +(v + dir * 0.01).toFixed(2)));
    return setParam("api.apply.scale", next);
  }

  function onKey(e) {
    const inField = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    if (e.key === "Escape") {
      if (state.modal) setModal(null);
      else clearToast();
      return;
    }
    // Ctrl+O is the native picker, not the upload input: the picker is the
    // primary way in on a desktop app (UI_SPEC §5, AGENTS §6 fs.pick).
    if ((e.ctrlKey || e.metaKey) && (e.key === "o" || e.key === "O")) {
      e.preventDefault();
      pickAndOpen();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      setModal("save-modal");
      setState("save-confirm");
      return;
    }
    if (inField) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) {
      e.preventDefault();
      duplicateSelected();
      return;
    }
    if (e.key === "Delete") {
      deleteSelected();
      return;
    }
    if (e.key === "?") {
      renderShortcuts();
      setModal("shortcuts-modal");
      return;
    }
    if (e.key === "+" || e.key === "=") { bumpScale(1); return; }
    if (e.key === "-" || e.key === "_") { bumpScale(-1); return; }

    // UI_SPEC §5: 1..9 jump to a page, PgUp/PgDn step. A bare 0 means page 10.
    if (/^[0-9]$/.test(e.key)) {
      const p = window.__autoStampPreview;
      if (!p) return;
      e.preventDefault();
      const n = e.key === "0" ? 10 : Number(e.key);
      p.goTo(n);
      return;
    }
    if (e.key === "PageUp" || e.key === "PageDown") {
      const p = window.__autoStampPreview;
      if (!p) return;
      e.preventDefault();
      if (e.key === "PageUp") p.prev();
      else p.next();
      return;
    }
    if (e.key.startsWith("Arrow") && state.selected !== null) {
      e.preventDefault();
      nudge(e.key, e.shiftKey);
    }
  }

  // ---------- wiring ----------

  function bindSegment(id, field, fn) {
    const seg = q("#" + id);
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-value]");
      if (!b) return;
      qa("button", seg).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      if (fn) fn(b.dataset.value);
      else writeField(field, b.dataset.value);
    });
  }

  function bindControls() {

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
        el.addEventListener("change", () => {
          if (name === "api.apply.crossPage") {
            state.instances.forEach((i) => { i.crossPage = el.checked; });
            renderInstances();
            setState(el.checked ? "crosspage" : "opened");
          }
          queuePersist(name);
        });
      } else if (el.tagName === "SELECT") {
        el.addEventListener("change", () => queuePersist(name));
      } else if (el.tagName === "INPUT") {
        // Single (unpaired) text/number controls must persist on edit too; the
        // persist timer coalesces the pair handler's duplicate call.
        el.addEventListener("input", () => queuePersist(name));
        el.addEventListener("change", () => queuePersist(name));
      }
    });

    bindSegment("lang-seg", "ui.lang", (v) => applyLang(v));
    bindSegment("theme-seg", "ui.theme", (v) => applyTheme(v));
    bindSegment("apply-anchor", "api.apply.anchor", (v) => persist("apply", { anchor: v }));
    bindSegment("split-mode", "ui.split.mode", (v) => persist("split", { mode: v }));
    bindSegment("export-mode", "api.export.mode", (v) => { persist("export", { mode: v }); refreshEstimate(); });
    bindSegment("export-dpi", "api.export.dpi", (v) => { persist("export", { dpi: v }); refreshEstimate(); });
    bindSegment("crosspage-binding", "ui.crosspage.binding", (v) => {
      if (v === "none") {
        writeField("api.apply.crossPage", false);
        state.instances.forEach((i) => { i.crossPage = false; });
        renderInstances();
        setState("opened");
        toast("warn", t("crosspage.binding.fixed"));
      } else {
        writeField("api.apply.crossPage", true);
        state.instances.forEach((i) => { i.crossPage = true; });
        renderInstances();
        setState("crosspage");
      }
      persist("apply", { binding: v, crossPage: readField("api.apply.crossPage") });
    });

    q("#instance-add").addEventListener("click", () => addInstance());
    q("#instance-duplicate").addEventListener("click", () => duplicateSelected());
    q("#instance-delete").addEventListener("click", () => deleteSelected());
    q("#pos-center").addEventListener("click", () => {
      writeField("api.apply.anchor", "center");
      qa("#apply-anchor button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === "center")));
      persist("apply", { anchor: "center" });
    });

    // modal wiring (decision S1)
    q("#save-open").addEventListener("click", () => { setModal("save-modal"); setState("save-confirm"); });
    q("#btn-save").addEventListener("click", () => { setModal("save-modal"); setState("save-confirm"); });
    q("#save-cancel").addEventListener("click", () => { setModal(null); setState("opened"); });
    q("#save-confirm").addEventListener("click", () => {
      if (readField("api.save.replaceOriginal")) { setModal("confirm-modal"); setState("replace-confirm"); return; }
      submitSave(false);
    });
    q("#confirm-cancel").addEventListener("click", () => {
      writeField("api.save.replaceOriginal", false);
      setModal("save-modal");
      setState("save-confirm");
    });
    q("#confirm-ok").addEventListener("click", () => submitSave(true));
    // --- P1 open channel: picker / path box / drag and drop (AGENTS §6) ---
    // HD6 (2026-11-04): the upload button (#empty-upload -> the hidden
    // #file-input) and the path box's Open button (#empty-open) are gone. The
    // path box opens on Enter; drag/paste still feed submitFiles below, so no
    // hidden <input type=file> is left in the document.
    q("#btn-open").addEventListener("click", () => pickAndOpen());
    q("#empty-pick").addEventListener("click", () => pickAndOpen());
    q("#empty-path").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        openByPath();
      }
    });
    // PD2 (UI_SPEC §8): window-level load gate. Only drags that carry files
    // are intercepted - pure text drags (the one type that never has "Files")
    // pass through untouched. The drop is classified with the SAME gate as
    // paste: single PDF -> open, images -> seal load, everything else warns.
    const stage = q("#preview");
    const setDrag = (on) => { stage.dataset.drag = on ? "on" : "off"; };
    const hasFiles = (e) =>
      Boolean(e.dataTransfer) && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") >= 0;
    let dragDepth = 0;
    doc.addEventListener("dragenter", (e) => { if (hasFiles(e)) dragDepth += 1; });
    doc.addEventListener("dragover", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDrag(true);
    });
    doc.addEventListener("dragleave", () => {
      if (dragDepth && dragDepth - 1 <= 0) setDrag(false);
      dragDepth = Math.max(0, dragDepth - 1);
    });
    doc.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      setDrag(false);
      submitFiles(e.dataTransfer.files);
    });
    // PD1 (UI_SPEC §8): clipboard load. The gate only engages when the
    // clipboard actually carries files; a focused field that also carries
    // text/plain keeps the text-paste semantics (the typed path box wins).
    doc.addEventListener("paste", (e) => {
      const dt = e.clipboardData;
      if (!dt) return;
      const files = Array.from(dt.files || []);
      if (!files.length) return;
      const inField = /^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || "");
      if (inField && Array.prototype.indexOf.call(dt.types || [], "text/plain") >= 0) return;
      e.preventDefault();
      submitFiles(files);
    });
    // P4 write-back. The two split buttons are siblings of the cut-fraction
    // box; 盖到 PDF / 撤销盖章 live in the instance panel (UI_SPEC §7 ids).
    q("#split-apply").addEventListener("click", () => runSplit());
    q("#split-undo").addEventListener("click", () => undoSplit());
    q("#apply-write").addEventListener("click", () => stampIntoPDF());
    q("#apply-undo").addEventListener("click", () => undoStamping());
    // Ctrl+wheel: P2 owns it when the pointer is over the selected instance
    // (UI_SPEC §5 V3: the wheel then means apply.scale), otherwise it zooms
    // the view. passive:false keeps preventDefault legal.
    stage.addEventListener(
      "wheel",
      (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        const overlay = window.__autoStampOverlay;
        if (overlay && overlay.consumeWheel && overlay.consumeWheel(e)) return;
        if (!window.__autoStampPreview) return;
        e.preventDefault();
        window.__autoStampPreview.zoomBy(e.deltaY < 0 ? 0.1 : -0.1);
      },
      { passive: false },
    );
    q("#shortcuts-close").addEventListener("click", () => setModal(null));
    q("#btn-shortcuts").addEventListener("click", () => { renderShortcuts(); setModal("shortcuts-modal"); });
    q("#pw-cancel").addEventListener("click", () => {
      setModal(null);
      state.pending = null;
      setState(state.file ? "opened" : "empty");
    });
    q("#pw-retry").addEventListener("click", () => retryOpen());
    q("#save-pick").addEventListener("click", () => pickSaveTarget());
    q("#modal-layer .scrim").addEventListener("click", () => setModal(null));
    doc.addEventListener("keydown", onKey);
  }

  function queuePersist(name) {
    const path = PERSIST[name];
    if (!path) return; // transient field (filePath, pw, targetPath, ...)
    const key = path[1];
    const value = readField(name);
    persist(path[0], { [key]: NUMERIC.has(key) ? Number(value) : value });
    if (String(name).indexOf("api.export.") === 0) refreshEstimate();

  }

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
    const raw = String(readField("api.export.pages") || "all").trim();
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
    const sel = readField("api.export.dpi");
    return sel === "custom" ? Number(readField("api.export.customDpi")) || 150 : Number(sel) || 150;
  }

  function exportQualityOf() {
    return Math.min(95, Math.max(40, Number(readField("api.export.quality")) || 75));
  }

  function computeEstimate() {
    if (!state.file || !state.file.pages || !state.file.pages.length) return null;
    const pages = state.file.pages;
    const sel = exportPagesSelected();
    const mode = readField("api.export.mode") || "vector";
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
    const box = q("#estimate");
    const total = q("#estimate-total");
    const per = q("#estimate-per-page");
    if (!box || !total || !per) return;
    const e = computeEstimate();
    if (!e) {
      total.textContent = "-";
      per.textContent = "-";
      return;
    }
    total.textContent = `~ ${formatBytes(e.totalBytes)} (${exportPagesSelected()} pages)`;
    per.textContent = e.mode === "vector"
      ? `~ ${formatBytes(e.perPageBytes)}/page (vector: ${formatBytes(state.file.size || 0)} source / ${state.file.pages.length} pages)`
      : `~ ${formatBytes(e.perPageBytes)}/page (raster ${e.dpi} dpi q${e.quality}, page area x${e.areaFactor.toFixed(2)} A4)`;
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

  // lastExportBody records the last raster submission for probe("exportBody"):
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
    const rawPages = String(readField("api.export.pages") || "all").trim() || "all";
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
      toast("error", t("err.apply.noDoc"));
      return null;
    }
    const spec = exportSpecOf();
    const numbers = resolvePages(spec.pages, state.file.pages.length);
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
      toast("error", `export: ${e.message}`);
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
      toast("error", `${e.code}: ${e.message}`);
      return null;
    }
    // The export is a derived swap (like split/apply): adopt re-points the
    // preview at the raster asset, so the following save writes the document
    // the user is looking at. state.assets.export carries the id (asset hooks).
    await adopt(res, "", { from: "export" });
    lastExport = { assetId: res.assetId, key: exportKeyOf(spec) };
    toast("ok", t("ok.exported").replace("%d", String(parts.length)).replace("%d", String(spec.dpi)).replace("%d", String(spec.quality)));
    return res;
  }

  // submitSave posts the real /api/pdf/save route (AGENTS §6). The target has
  // exactly three channels and the server rejects an ambiguous request, so the
  // front-end picks one: replaceOriginal for the confirmation modal, otherwise
  // the native picker's grant while the text box still holds the picked path,
  // otherwise the typed path itself.
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
      toast("error", t("err.apply.noDoc"));
      return;
    }
    // W5: raster save chain. mode=vector never sends /api/pdf/export (源资产
    // 直接写); mode=raster bakes the selected pages first, so the file on disk
    // IS the flattened document. A failed export aborts the save - writing the
    // non-rasterised document behind the user's back would be worse.
    if ((readField("api.export.mode") || "vector") === "raster") {
      // W6: block on the per-page estimate BEFORE anything goes out; the
      // network log must stay empty when this fires.
      const est = computeEstimate();
      if (est && est.perPageBytes > MAX_EXPORT_PAGE_BYTES) {
        toast("warn", t("warn.export.tooBig"));
        return;
      }
      // A second 保存 of an already-flattened document must not re-bake: the
      // extra JPEG generation is visible quality loss. It re-bakes only when
      // the document is not the export asset (undo, a new seal, a new open) or
      // when the user changed dpi/quality/pages — that is a new write intent.
      const spec = exportSpecOf();
      const rebake =
        !lastExport || lastExport.assetId !== state.file.assetId || lastExport.key !== exportKeyOf(spec);
      if (rebake) {
        const exported = await exportRaster();
        if (!exported) return;
      }
    }
    const typed = String(readField("api.save.targetPath") || "");
    const body = { assetId: state.file.assetId, replaceOriginal: Boolean(replaceOriginal) };
    if (!replaceOriginal) {
      if (state.saveGrant && typed === state.saveGrantPath) body.pathGrantId = state.saveGrant;
      else body.targetPath = typed;
    }
    try {
      const res = await api.request("/api/pdf/save", { method: "POST", body });
      state.assets.save = res && res.assetId ? res.assetId : state.file.assetId;
      renderAssetHooks();
      setModal(null);
      setState("opened");
      toast("ok", res && res.message ? res.message : t("ok.saved"));
    } catch (e) {
      toast("error", `${e.code}: ${e.message}`);
    }
  }


  // ---------- open: the local-file channel (P1, AGENTS §6) ----------
  //
  // Two ways in: the native picker (#btn-open / #empty-pick) and the typed path
  // box (#empty-path, Enter -> openByPath). Drag and paste land in the same
  // submitFiles funnel. Every channel ends in adopt(), which is the only place
  // that changes the document state.

  // pickAndOpen asks the server to show the native dialog. A cancel is normal
  // (no toast), an unsupported platform gets a toast plus focus on the path box.
  async function pickAndOpen() {
    const filter = readField("api.fs.pick.filter") || "pdf";
    const multi = Boolean(readField("api.fs.pick.multi"));
    let res;
    try {
      res = await api.pick({ filter, multi });
    } catch (e) {
      toast("error", `${e.code}: ${e.message}`);
      if (e.code === "pick_unsupported") q("#empty-path").focus();
      return;
    }
    state.lastGrant = res && res.picks && res.picks[0] ? res.picks[0].pathGrantId : "";
    renderAssetHooks();
    if (!res || res.cancelled || !res.picks || !res.picks.length) return;
    if (res.picks.length > 1) {
      // The extra grants are real (owner-bound, TTL): P6's batch flow consumes
      // them. P1 opens the first one and keeps the rest in the console.
      console.info("extra picks (batch flow is P6):", res.picks.slice(1).map((p) => p.path));
    }
    await openGrant(res.picks[0], "");
  }

  // openByPath is the typed-path channel: POST /api/fs/pick with filePath
  // grants an existing file without a dialog (UI_SPEC §2 api.fs.pick.filePath).
  async function openByPath() {
    const path = (readField("api.fs.pick.filePath") || "").trim();
    if (!path) {
      q("#empty-path").focus();
      return;
    }
    let res;
    try {
      res = await api.pick({ filePath: path, filter: "pdf" });
    } catch (e) {
      toast("error", `${e.code}: ${e.message}`);
      return;
    }
    if (!res || !res.picks || !res.picks.length) return;
    state.lastGrant = res.picks[0].pathGrantId;
    renderAssetHooks();
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

  function instanceNameFor(f) {
    const base = String((f && f.name) || "seal").replace(/\.[^.]+$/, "");
    return base || "seal";
  }

  // rollbackInstance is the silent counterpart of deleteSelected: a seal upload
  // that failed after we already added the instance leaves an empty row behind,
  // and the last-instance guard would refuse to undo our own rollback.
  function rollbackInstance(id) {
    state.instances = state.instances.filter((i) => i.id !== id);
    if (state.selected === id) state.selected = state.instances.length ? state.instances[0].id : null;
    renderInstances();
  }

  async function loadSeals(files) {
    // seal.upload keeps the exact semantics of the 上传印章 button (type gate,
    // toast, 撤销 source tracking, setSealForSelected). For several images the
    // multi-instance decision I1 takes over: first image -> selected instance,
    // each remaining image -> a fresh instance named after the file. Dropping
    // N photos stamps N seals instead of quietly loading just one.
    noteLoad("seals", "", files);
    const seal = window.__autoStampSeal;
    if (!seal) {
      toast("error", "seal module unavailable");
      return 0;
    }
    const canAssign = Boolean(state.file) && state.instances.length > 0;
    let ok = 0;
    for (let i = 0; i < files.length; i += 1) {
      const f = files[i];
      const instId = canAssign && i > 0 ? addInstance(instanceNameFor(f)) : null;
      const meta = await seal.upload(f);
      if (meta) ok += 1;
      else if (instId !== null) rollbackInstance(instId);
    }
    if (files.length > 1) toast("ok", `${t("load.seals.ok")} ×${ok}/${files.length}`);
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
    toast("warn", t(key));
    return null;
  }

  // openFailed maps the contract codes onto the states the UI can show. A
  // missing password is the documented flow: the modal asks for one string that
  // the server then tries as UserPW *and* OwnerPW (internal/pdfcore/read.go).
  function openFailed(e) {
    if (e.code === "password_required" || e.code === "password_invalid") {
      setModal("password-modal");
      setState("password-error");
      toast(e.code === "password_required" ? "warn" : "error", `${e.code}: ${e.message}`);
      return;
    }
    toast("error", `${e.code}: ${e.message}`);
    setState(state.file ? "opened" : "empty");
  }

  // retryOpen replays the open that failed, now with the typed password. The
  // string goes to the server (structure) and to pdf.js (pages), so both read
  // the same document.
  async function retryOpen() {
    if (!state.pending) {
      setModal(null);
      setState(state.file ? "opened" : "empty");
      return;
    }
    const pw = readField("api.open.pw") || "";
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
    setModal(null);
    await adopt(info, pw);
  }

  // pickSaveTarget fills the save dialog's target path from the native picker.
  // P4 writes through the returned grant; the text box stays editable so a
  // typed path is equally valid.
  async function pickSaveTarget() {
    let res;
    try {
      res = await api.pick({ filter: "all", multi: false });
    } catch (e) {
      toast("error", `${e.code}: ${e.message}`);
      return;
    }
    if (!res || res.cancelled || !res.picks || !res.picks.length) return;
    const pick = res.picks[0];
    state.saveGrant = pick.pathGrantId;
    state.saveGrantPath = pick.path;
    state.lastGrant = pick.pathGrantId;
    writeField("api.save.targetPath", pick.path);
    renderAssetHooks();
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
    const pages = normalisePages(info.pages || []);
    info.pages = pages;
    const name = derived ? (state.file && state.file.name) || info.name : info.name;
    state.file = { assetId: info.assetId, name, size: info.size, pages };
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
    refreshEstimate();
    setDocTitle();
    renderAssetHooks();
    renderVetoChips();
    // The state flips *before* the first paint on purpose: #preview-stage is
    // display:none in the empty state (style.css), so pdf.js would otherwise
    // compute its fit-zoom against a zero-size container and the page would
    // land at the wrong scale. The document is already open at this point (the
    // server answered), so entering "opened" here is truthful; a render failure
    // surfaces as a toast with an empty stage.
    setState("opened");
    const p = window.__autoStampPreview;
    if (p) {
      if (p.setPassword) p.setPassword(pw || "");
      await p.open(info);
    }
    // The rail (app-pager) rebuilds on this event; a derived swap counts too,
    // because the page count is what changed (split adds, stamp does not).
    notify("autostamp:open", info);
    renderStripPreviews();
    if (info.pages && info.pages.length && !info.pages.some((pg) => pg.hasFonts)) {
      // UI_SPEC 4: a document whose pages are only images has nothing to
      // extract; say so instead of letting the search box look broken.
      toast("warn", t("warn.noText.hint"));
    }
    return info;
  }


  // ---------- P4 write-back: split / stamping / save (AGENTS §6) ----------
  //
  // Every write-back route returns a *new* session asset, so undo is plain
  // bookkeeping: the shell keeps the asset each step came from (plus, for
  // stamping, the instance list that produced it) and re-points the preview at
  // it. Nothing is replayed client-side, and tmpstore keeps the old file until
  // its TTL, so 撤销 after a stamp restores exactly what the user saw.


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

  // splitModeOf maps the panel's manual segment (UI_SPEC §2.2 words) onto the
  // server vocabulary. "off" plus an on/auto checkbox means "let the heuristic
  // decide"; "off" with auto off means the user's explicit 不切 answer.
  function splitModeOf() {
    const manual = readField("ui.split.mode") || "off";
    if (manual === "v2") return "rows-cols";
    if (manual === "h2") return "rows-cols";
    if (manual === "grid") return "rows-cols";
    return readField("api.split.auto") ? "auto" : "unsplit";
  }

  // splitGridOf honours the segment: 2-up LR is 1x2, 2-up TB is 2x1, and only
  // "grid" reads the rows/cols boxes (otherwise those boxes would silently
  // override what the segment says).
  function splitGridOf(mode) {
    if (mode === "v2") return { rows: 1, cols: 2 };
    if (mode === "h2") return { rows: 2, cols: 1 };
    return {
      rows: Number(readField("api.split.rows")) || 1,
      cols: Number(readField("api.split.cols")) || 1,
    };
  }

  function cutsOf() {
    return String(readField("api.split.cutFractions") || "")
      .split(/[ ,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // vetoedPagesOf is the D3 chip row: the pages the heuristic flagged (spread
  // ratio) minus the ones the user clicked off. Chip state is keyed by page
  // number; a page that stopped being a spread simply drops out.
  function spreadPages() {
    const out = [];
    (state.file && state.file.pages ? state.file.pages : []).forEach((pg) => {
      const w = Number(pg.width) || 0;
      const h = Number(pg.height) || 0;
      if (w > h && w / h > 0.7) out.push(Number(pg.number) || out.length + 1);
    });
    return out;
  }

  function renderVetoChips() {
    const host = q("#split-veto");
    if (!host) return;
    host.textContent = "";
    spreadPages().forEach((n) => {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "btn ghost";
      const on = state.vetoed.has(n);
      b.dataset.vetoPage = String(n);
      b.setAttribute("aria-pressed", String(on));
      b.textContent = `#${n}${on ? ` ${t("chip.veto")}` : ""}`;
      b.addEventListener("click", () => {
        if (state.vetoed.has(n)) state.vetoed.delete(n);
        else state.vetoed.add(n);
        renderVetoChips();
        notify("autostamp:veto", { page: n, vetoed: state.vetoed.has(n) });
      });
      host.appendChild(b);
    });
  }

  function splitPagesFor(total) {
    const picked = resolvePages(readField("api.split.pages"), total);
    return picked.filter((n) => !state.vetoed.has(n));
  }

  // splitBodyOf is the /api/pdf/split request body (AGENTS §6). It is its own
  // function so the button and probe("chain") can never drift apart.
  function splitBodyOf() {
    const total = ((state.file && state.file.pages) || []).length;
    const grid = splitGridOf(readField("ui.split.mode"));
    return {
      splitMode: splitModeOf(),
      rows: grid.rows,
      cols: grid.cols,
      customCuts: cutsOf(),
      vetoPages: [...state.vetoed].sort((a, b) => a - b),
      splitPages: splitPagesFor(total).join(",") || "none",
    };
  }
  async function runSplit() {
    if (!state.file) {
      toast("error", t("err.apply.noDoc"));
      return null;
    }
    const body = { assetId: state.file.assetId, ...splitBodyOf() };
    let res;
    try {
      res = await api.request("/api/pdf/split", { method: "POST", body });
    } catch (e) {
      toast("error", `${e.code}: ${e.message}`);
      return null;
    }
    // The cut is a new page set, so the pre-cut document is what 撤销切分
    // re-opens. The veto chips reset because the page numbers moved.
    state.splitChain = { info: state.lastInfo, mode: readField("ui.split.mode") };
    await adopt(res, "", { from: "split" });
    toast("ok", t("split.ok"));
    return res;
  }

  async function undoSplit() {
    if (!state.splitChain || !state.splitChain.info) {
      toast("warn", t("err.undo.empty"));
      return false;
    }
    const info = state.splitChain.info;
    state.splitChain = null;
    await adopt(info, "", { from: "open" });
    state.assets.open = info.assetId;
    state.assets.split = "";
    toast("ok", t("ok.undoStep"));
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
          blend: p["api.apply.blend"] !== undefined ? p["api.apply.blend"] : readField("api.apply.blend"),
          opacity: numAt(p, "api.apply.opacity", "api.apply.opacity"),
          scale: numAt(p, "api.apply.scale", "api.apply.scale"),
          rotation: numAt(p, "api.apply.rotation", "api.apply.rotation"),
          pages: p["api.apply.pages"] !== undefined ? p["api.apply.pages"] : readField("api.apply.pages"),
          crossPage: Boolean(p["api.apply.crossPage"]),
          sealId: i.sealId,
        };
        if (Boolean(p["api.apply.crossPage"])) {
          entry.binding = p["ui.crosspage.binding"] !== undefined ? p["ui.crosspage.binding"] : readField("ui.crosspage.binding");
          entry.startOffset = numAt(p, "api.apply.startOffset", "api.apply.startOffset");
        }
        if (i.geomMode === "pos") entry.pos = p["api.apply.pos"] !== undefined ? p["api.apply.pos"] : readField("api.apply.pos");
        else {
          entry.anchor = p["api.apply.anchor"] !== undefined ? p["api.apply.anchor"] : readField("api.apply.anchor");
          entry.offset = p["api.apply.offset"] !== undefined ? p["api.apply.offset"] : readField("api.apply.offset");
        }
        return entry;
      });
  }

  function numAt(params, field, fallbackField) {
    const v = params && params[field] !== undefined ? params[field] : readField(fallbackField);
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // stampIntoPDF bakes the instances into a new asset, then clears them (W2):
  // the document the user is looking at *is* the stamped one now, so leaving
  // the instances on screen would double-draw the seal and every later Save
  // would stamp it a second time.
  async function stampIntoPDF(opts) {
    if (!state.file) {
      if (!(opts && opts.quiet)) toast("error", t("err.apply.noDoc"));
      return null;
    }
    const instances = stampBodyOf();
    if (!instances.length) {
      if (!(opts && opts.quiet)) toast("warn", t("err.apply.noSeal"));
      return null;
    }
    let res;
    try {
      res = await api.request("/api/pdf/apply", { method: "POST", body: { assetId: state.file.assetId, instances } });
    } catch (e) {
      toast("error", `${e.code}: ${e.message}`);
      return null;
    }
    state.applyChain = {
      info: state.lastInfo,
      instances: state.instances.map((i) => ({
        id: i.id, name: i.name, sealId: i.sealId, crossPage: i.crossPage, geomMode: i.geomMode,
        params: { ...(i.params || {}) },
      })),
      selected: state.selected,
    };
    state.instances = [];
    state.selected = null;
    state.nextInstance = 1;
    renderInstances();
    await adopt(res, "", { from: "apply" });
    if (!(opts && opts.quiet)) toast("ok", t("ok.applied"));
    return res;
  }

  async function undoStamping() {
    if (!state.applyChain || !state.applyChain.info) {
      toast("warn", t("err.undo.empty"));
      return false;
    }
    const chain = state.applyChain;
    state.applyChain = null;
    state.instances = chain.instances;
    state.selected = chain.selected;
    state.nextInstance = chain.instances.reduce((m, i) => Math.max(m, Number(i.id) || 0), 0) + 1;
    renderInstances();
    await adopt(chain.info, "", { from: "open" });
    state.assets.open = chain.info.assetId;
    state.assets.apply = "";
    toast("ok", t("ok.undoStep"));
    return true;
  }

  // renderStripPreviews is CP1's per-page zoom: each page shows the strip slice
  // it would print, at the binding edge, so `startOffset` and the alternate
  // sides are visible before anything is written. The source is the seal
  // bitmap (already fetched by app-seal) plus the page's own aspect.
  function renderStripPreviews() {
    const host = q("#strip-previews");
    if (!host) return;
    host.textContent = "";
    const inst = selectedInstance();
    if (!inst || !inst.params || !inst.params["api.apply.crossPage"]) return;
    const img = window.__autoStampSeal && window.__autoStampSeal.bitmapOf
      ? window.__autoStampSeal.bitmapOf(inst.sealId)
      : null;
    if (!img) return;
    const params = inst.params;
    const pages = state.file && state.file.pages ? state.file.pages : [];
    const binding = params["ui.crosspage.binding"] || "right";
    const count = pages.length || 1;
    pages.forEach((pg, k) => {
      const useLeft = binding === "alternate" && Number(pg.number) % 2 === 0;
      const box = doc.createElement("div");
      box.className = "strip";
      const cv = doc.createElement("canvas");
      const dw = displayDims(pg);
      const zoom = 1.6;
      const stripW = Math.max(1, Math.round((Number(params["api.apply.scale"]) || 0.2) * dw.width / count * zoom));
      const stripH = Math.max(1, Math.round(stripW * (img.height / img.width)));
      cv.width = stripW;
      cv.height = stripH;
      const ctx = cv.getContext("2d");
      // The page side of the strip first, then the seal slice on top: same
      // blend semantics as the main canvas, so the zoom shows what will print.
      const src = window.__autoStampPreview && window.__autoStampPreview.sealSnapshot
        ? window.__autoStampPreview.sealSnapshot(pg.number)
        : null;
      if (src) ctx.drawImage(src, 0, 0, stripW, stripH);
      const sx = (img.width * k) / count;
      const sw = img.width / count;
      ctx.globalAlpha = Math.min(1, Math.max(0, Number(params["api.apply.opacity"]) || 1));
      ctx.globalCompositeOperation = "source-over";
      const offY = Math.max(0, Math.min(stripH, Number(params["api.apply.startOffset"]) || 0)) * zoom;
      ctx.drawImage(img, sx, 0, sw, img.height, 0, offY, stripW, stripH);
      box.appendChild(cv);
      const label = doc.createElement("span");
      label.className = "chip";
      label.textContent = `#${pg.number} ${useLeft ? "l" : "r"}`;
      box.appendChild(label);
      host.appendChild(box);
    });
  }

  // displayDims mirrors internal/pdfcore/stamp.go DisplaySize: the page extent
  // the user sees, i.e. MediaBox with /Rotate applied (UI_SPEC §8 C1 frame).
  function displayDims(pg) {
    const w = Number(pg.width) || 0;
    const h = Number(pg.height) || 0;
    const rot = Math.abs(Number(pg.rotation) || 0) % 180;
    return rot === 0 ? { width: w, height: h } : { width: h, height: w };
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
  // produced, plus the last pathGrantId the picker returned. The visible text is
  // the handle itself (ids are not translatable strings); the localized label
  // goes into the title, which is why applyLang() calls this after its own pass.
  function renderAssetHooks() {
    qa("#asset-hooks [data-route]").forEach((el) => {
      const id = state.assets[el.dataset.route] || "";
      el.textContent = id || "-";
      el.title = `${t("asset.hint")} (${el.dataset.route})${id ? ": " + id : ""}`;
    });
    qa("[data-field='api.fs.pick.pathGrantId']").forEach((el) => {
      el.textContent = state.lastGrant || "-";
      el.title = `${t("api.fs.pick.pathGrantId.ctl")}: ${state.lastGrant || "-"}`;
    });
  }

  // ---------- deep link (UI_SPEC 7) ----------
  // #crosspage re-enters the state machine; an unknown hash is ignored so a typo
  // cannot drive the shell into a state the spec does not define. Clearing the
  // hash returns to the underlying document state.
  function applyHash() {
    const name = location.hash.replace(/^#/, "");
    if (name === "crosspage") {
      setState("crosspage");
      q("#panel-crosspage").open = true;
      return;
    }
    if (!name) setState(state.file ? "opened" : "empty");
  }

  function boot() {
    html.dataset.app = "autostamp";
    bindControls();
    renderShortcuts();
    if (!state.instances.length) {
      addInstance("Seal 1");
      setState("empty");
      setModal(null);
    }
    window.addEventListener("hashchange", applyHash);
    applyHash();
    api.health()
      .then((h) => {
        // HD2: the version rides the window title - the native caption for the
        // WebView2 window (main.go builds it) and document.title here for the
        // browser fallback.
        state.version = h.version || "";
        setDocTitle();
        if (h.name !== "autostamp") toast("warn", `foreign app on this port: ${h.name}`);
      })
    api.settings()
      .then((res) => {
        state.settings = res.settings;
        applySettings(res.settings);
        if (res.warning) toast("warn", res.warning);
      })
      .catch((e) => toast("error", `${e.code}: ${e.message}`));
  }

  // ---------- verify hooks (UI_SPEC §7) ----------

  function ids() {
    return qa("[id]").map((el) => el.id).sort();
  }

  function verifyState(name) {
    return { want: name, got: html.dataset.state, ok: html.dataset.state === name };
  }

  function probe(name) {
    switch (name) {
      case "state":
        return html.dataset.state;
      case "overflow":
        return doc.documentElement.scrollWidth > doc.documentElement.clientWidth + 1;
      case "instances":
        return state.instances.map((i) => ({
          id: i.id,
          name: i.name,
          crossPage: i.crossPage,
          sealId: i.sealId || null,
          params: { ...(i.params || {}) },
        }));
      case "instanceCount":
        return state.instances.length;
      case "selected":
        return state.selected;
      case "modal":
        return state.modal || "";
      case "toast": {
        const el = q("#error-toast");
        return { open: el.dataset.open === "true", level: el.dataset.level || "", text: el.textContent };
      }
      case "lang":
        return state.lang;
      case "theme":
        return state.theme;
      case "version":
        return state.version;
      case "docTitle":
        return doc.title;
      case "estimate": {
        const e = computeEstimate();
        if (!e) return { mode: "", pagesSelected: 0, pagesTotal: 0, perPageBytes: null, totalBytes: null, perPageText: "", totalText: "" };
        return {
          mode: e.mode,
          dpi: e.dpi,
          quality: e.quality,
          areaFactor: Number(e.areaFactor.toFixed(3)),
          pagesSelected: exportPagesSelected(),
          pagesTotal: state.file ? state.file.pages.length : 0,
          perPageBytes: Math.round(e.perPageBytes),
          totalBytes: Math.round(e.totalBytes),
          perPageText: q("#estimate-per-page").textContent,
          totalText: q("#estimate-total").textContent,
        };
      }
      case "labels":
        return qa("[data-i18n]").map((el) => ({ key: el.getAttribute("data-i18n"), text: el.textContent.trim() }))
          .filter((x) => x.text);
      case "chain":
        // Write-back bookkeeping the verify scripts read: which asset is live,
        // what each route last produced, and whether an undo step is armed.
        // Nothing is inferred here - it is exactly what the buttons use.
        return {
          current: state.file ? state.file.assetId : "",
          open: state.assets.open,
          split: state.assets.split,
          apply: state.assets.apply,
          export: state.assets.export,
          save: state.assets.save,
          splitUndoArmed: Boolean(state.splitChain && state.splitChain.info),
          applyUndoArmed: Boolean(state.applyChain && state.applyChain.info),
          vetoed: [...state.vetoed].sort((a, b) => a - b),
          spreadPages: spreadPages(),
          instances: state.instances.map((i) => ({
            id: i.id, sealId: i.sealId || null,
            geomMode: i.geomMode || "anchor", crossPage: Boolean(i.crossPage),
          })),
          stampBody: stampBodyOf(),
          splitBody: splitBodyOf(),
        };
      case "strips": {
        const host = q("#strip-previews");
        const kids = host ? [...host.children] : [];
        return {
          count: kids.length,
          strips: kids.map((c) => {
            const cv = c.querySelector ? c.querySelector("canvas") : null;
            return cv ? { w: cv.width, h: cv.height } : null;
          }),
        };
      }
      case "exportBody":
        // The last raster submission (P5): the exact spec JSON plus the page
        // numbers, per-page blob sizes and pixel boxes, so tools/verify can pin
        // the wire shape without a private test hook. null until raster ran.
        return lastExportBody;
      case "pageMeta":
        return (state.file && state.file.pages)
          ? state.file.pages.map((pg) => ({
            number: pg.number, width: pg.width, height: pg.height, rotation: pg.rotation,
          }))
          : [];
      case "load":
        // PD1/PD2 load-gate readout: what the last paste/drop decided.
        return loadLog;
      default:
        throw new Error(`unknown probe: ${name}`);
    }
  }

  // i18nPairs reports every registered key with both languages so the verify
  // script can prove each control carries an en + cn twin (UI_SPEC 4).
  function i18nPairs() {
    const out = [];
    qa("[data-i18n]").forEach((el) => {
      const p = pairFor(el, "text");
      if (p) out.push({ key: p.key, en: p.en, cn: p.cn, kind: "text" });
    });
    qa("[data-i18n-placeholder]").forEach((el) => {
      const p = pairFor(el, "placeholder");
      if (p) out.push({ key: p.key, en: p.en, cn: p.cn, kind: "placeholder" });
    });
    qa("[data-i18n-title]").forEach((el) => {
      const p = pairFor(el, "title");
      if (p) out.push({ key: p.key, en: p.en, cn: p.cn, kind: "title" });
    });
    return out;
  }

  window.__autoStampShell = {
    STATES, state, escapeHtml,
    setState, verifyState, setParams, fields, ids, probe, i18nPairs,
    applyLang, applyTheme,
    setModal, clearToast, t, toast,
    q, qa,
    addInstance, selectInstance, deleteSelected, duplicateSelected,
    // P2: instance parameters + the hand-off the overlay/seal modules use.
    APPLY_FIELDS, defaultParams, instanceById, selectedInstance,
    // `adopt` is the single document funnel: the verify real-chain drives it so
    // the chain exercises exactly what a real open does (state flip, asset
    // bookkeeping, preview.open) instead of poking the preview module directly.
    setParam, setSealForSelected, notify, adopt,
    // P4: the write-back channel + the D3 chip row, so the verify scripts drive
    // the same buttons the user clicks.
    runSplit, undoSplit, stampIntoPDF, undoStamping, stampBodyOf, splitBodyOf,
    vetoPage: (n) => {
      if (state.vetoed.has(n)) state.vetoed.delete(n);
      else state.vetoed.add(n);
      renderVetoChips();
      return [...state.vetoed];
    },
    setGeomMode: (id, mode) => {
      const inst = instanceById(id);
      if (!inst) return null;
      inst.geomMode = mode === "pos" ? "pos" : "anchor";
      if (inst.geomMode === "anchor") syncPosBox(inst);
      return inst.geomMode;
    },
  };

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
