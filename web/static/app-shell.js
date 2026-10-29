// Copyright 2026 AutoStamp Authors. SPDX-License-Identifier: Apache-2.0
// app-shell.js — the P0/P1 shell: state machine, i18n, density/theme, panel
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
    "ui.density": ["ui", "density"],
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
  };

  const NUMERIC = new Set([
    "resampleDpi", "opacity", "brightness", "saturate", "scale", "rotation",
    "startOffset", "rows", "cols", "customDpi", "quality",
  ]);

  const api = window.__autoStampApi;
  const i18n = window.__autoStampI18n;

  const state = {
    lang: "en",
    theme: "light",
    density: "two-col",
    settings: null,
    warning: "",
    instances: [],
    nextInstance: 1,
    selected: null,
    modal: null,
    file: null, // {path, assetId} once P1 opens a PDF
  };

  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- i18n ----------

  // labelFor resolves a key: CATALOG wins, otherwise the element's own text is
  // the en value and data-i18n-cn the cn value (UI_SPEC §4 rule).
  function pairFor(el, kind) {
    const key = el.getAttribute(kind === "placeholder" ? "data-i18n-placeholder" : "data-i18n");
    if (!key) return null;
    const entry = i18n && i18n.CATALOG[key];
    if (entry) return { key, en: entry.en, cn: entry.cn };
    const attr = kind === "placeholder" ? "data-i18n-cn-placeholder" : "data-i18n-cn";
    const cn = el.getAttribute(attr);
    if (!cn) return null;
    const en = kind === "placeholder" ? el.getAttribute("placeholder") : el.textContent.trim();
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
    qa("#lang-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === state.lang)));
    renderInstances();
    persist("ui", { lang: state.lang });
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

  function setDensity(d) {
    if (!["two-col", "single-col", "collapsed"].includes(d)) throw new Error(`unknown density: ${d}`);
    state.density = d;
    q("#app-main").dataset.density = d;
    qa("#density-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === d)));
    persist("ui", { density: d });
    return d;
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
      if (name === "ui.density") return setDensity(value);
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
      if (s.ui.density) setDensity(s.ui.density);
      if (s.ui.lang) applyLang(s.ui.lang);
    }
    const pairs = [
      ["seal", ["despill", "alphaTrim", "resampleDpi"]],
      ["apply", ["blend", "opacity", "brightness", "saturate", "scale", "pos", "anchor", "offset", "rotation", "pages", "crossPage", "binding", "startOffset"]],
      ["split", ["auto", "mode", "rows", "cols", "cutFractions", "pages"]],
      ["export", ["mode", "dpi", "customDpi", "quality", "pages"]],
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
      mode.textContent = inst.crossPage ? t("binding.right") && "cross-page" : "normal";
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
  }

  function addInstance(name) {
    const inst = {
      id: state.nextInstance++,
      name: name || `Seal ${state.instances.length + 1}`,
      crossPage: Boolean(readField("api.apply.crossPage")),
    };
    state.instances.push(inst);
    state.selected = inst.id;
    renderInstances();
    return inst.id;
  }

  function selectInstance(id) {
    state.selected = id;
    renderInstances();
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
    const src = state.instances.find((i) => i.id === state.selected);
    const inst = {
      id: state.nextInstance++,
      name: src ? `${src.name} *` : `Seal ${state.instances.length + 1}`,
      crossPage: src ? src.crossPage : false,
    };
    state.instances.push(inst);
    state.selected = inst.id;
    renderInstances();
    return inst.id;
  }

  // ---------- shortcuts (UI_SPEC §5) ----------

  const SHORTCUTS = [
    ["Ctrl+O / Ctrl+S", "open.hint", "save.hint"],
    ["Ctrl+D / Del", "instances.duplicate.btn", "instances.delete.btn"],
    ["←↑↓→", "nudge.hint"],
    ["+ / −", "scale.hint"],
    ["1..9 / PgUp/PgDn", "page.hint"],
    ["Ctrl+wheel", "scale.hint"],
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
    const [x, y] = parsePos(readField("api.apply.pos"));
    writeField("api.apply.pos", `${x + delta[0]},${y + delta[1]}`);
    persist("apply", { pos: readField("api.apply.pos") });
    return true;
  }

  function bumpScale(dir) {
    const v = Number(readField("api.apply.scale")) || 0;
    const next = Math.max(0.05, Math.min(0.9, +(v + dir * 0.01).toFixed(2)));
    writeField("api.apply.scale", next);
    persist("apply", { scale: next });
    return next;
  }

  function onKey(e) {
    const inField = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    if (e.key === "Escape") {
      if (state.modal) setModal(null);
      else clearToast();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "o" || e.key === "O")) {
      e.preventDefault();
      q("#file-input").click();
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
    bindSegment("density-seg", "ui.density", (v) => setDensity(v));
    bindSegment("apply-anchor", "api.apply.anchor", (v) => persist("apply", { anchor: v }));
    bindSegment("split-mode", "ui.split.mode", (v) => persist("split", { mode: v }));
    bindSegment("export-mode", "api.export.mode", (v) => persist("export", { mode: v }));
    bindSegment("export-dpi", "api.export.dpi", (v) => persist("export", { dpi: v }));
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
    q("#btn-open").addEventListener("click", () => q("#file-input").click());
    q("#empty-pick").addEventListener("click", () => q("#file-input").click());
    q("#shortcuts-close").addEventListener("click", () => setModal(null));
    q("#btn-shortcuts").addEventListener("click", () => { renderShortcuts(); setModal("shortcuts-modal"); });
    q("#pw-cancel").addEventListener("click", () => { setModal(null); setState("opened"); });
    q("#modal-layer .scrim").addEventListener("click", () => setModal(null));
    doc.addEventListener("keydown", onKey);
  }

  function queuePersist(name) {
    const path = PERSIST[name];
    if (!path) return; // transient field (filePath, pw, targetPath, ...)
    const key = path[1];
    const value = readField(name);
    persist(path[0], { [key]: NUMERIC.has(key) ? Number(value) : value });
  }

  // submitSave posts the real /api/pdf/save route. Until P4 registers it the
  // server answers 404, and the toast shows that verbatim — no faked success.
  async function submitSave(replaceOriginal) {
    const body = {
      assetId: state.file ? state.file.assetId || "" : "",
      targetPath: readField("api.save.targetPath") || "",
      replaceOriginal: Boolean(replaceOriginal),
    };
    try {
      const res = await api.request("/api/pdf/save", { method: "POST", body });
      setModal(null);
      setState("opened");
      toast("ok", res && res.message ? res.message : t("ok.saved"));
    } catch (e) {
      toast("error", `${e.code}: ${e.message}`);
    }
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
        q("#app-version").textContent = `${h.name} ${h.version}`;
        if (h.name !== "autostamp") toast("warn", `foreign app on this port: ${h.name}`);
      })
      .catch((e) => toast("error", `${e.code}: ${e.message}`));
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
      case "density":
        return q("#app-main").dataset.density;
      case "instances":
        return state.instances.map((i) => ({ id: i.id, name: i.name, crossPage: i.crossPage }));
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
        return q("#app-version").textContent;
      case "labels":
        return qa("[data-i18n]").map((el) => ({ key: el.getAttribute("data-i18n"), text: el.textContent.trim() }))
          .filter((x) => x.text);
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
    return out;
  }

  window.__autoStampShell = {
    STATES, state, escapeHtml,
    setState, verifyState, setParams, fields, ids, probe, i18nPairs,
    applyLang, applyTheme, setDensity,
    setModal, clearToast, t,
    q, qa,
    addInstance, selectInstance, deleteSelected, duplicateSelected,
  };

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
