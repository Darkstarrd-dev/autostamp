// Copyright 2026 AutoStamp Authors. SPDX-License-Identifier: Apache-2.0
// app-shell-chrome.js — part of the app-shell module group (split from
// app-shell.js on 2026-11-05; docs/IMPLEMENTATION_PLAN.md §10.1). shortcuts, the control wiring, the backend terminal and boot().
(() => {
  "use strict";

  const S = window.__autoStampShell;
  const q = (sel, root) => (root || document).querySelector(sel);
  const qa = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const doc = document;
  const html = doc.documentElement;
  const api = window.__autoStampApi;
  const state = S.state;


  // HD16: the backend-terminal show/hide toggle. Visibility persists through
  // settings.ui.consoleVisible (default false = hidden); /api/logs (ring-
  // backed) is polled only while the panel is open.
  let logSeq = 0;

  let logTimer = null;


  function setConsoleVisible(on, persist) {
    state.consoleVisible = Boolean(on);
    const btn = S.q("#btn-console");
    if (btn) btn.setAttribute("aria-pressed", String(state.consoleVisible));
    const panel = S.q("#log-console");
    if (panel) panel.hidden = !state.consoleVisible;
    if (state.consoleVisible) {
      if (!logTimer) logTimer = setInterval(pollLogs, 1500);
      pollLogs();
    } else if (logTimer) {
      clearInterval(logTimer);
      logTimer = null;
    }
    if (!persist) return state.consoleVisible;
    api.patchSettings({ ui: { consoleVisible: state.consoleVisible } })
      .then(S.refreshSettings)
      .catch((e) => S.toast("error", `${e.code}: ${e.message}`));
    return state.consoleVisible;
  }


  // pollLogs pulls the delta since the last fetched sequence; the ring keeps a
  // tail, so opening the panel at seq 0 shows the whole current run.
  async function pollLogs() {
    if (!state.consoleVisible) return;
    try {
      const res = await api.logs(logSeq);
      logSeq = res.next || logSeq;
      const lines = res.lines || [];
      if (!lines.length) return;
      const pre = S.q("#log-console-body");
      if (!pre) return;
      for (const l of lines) {
        const span = doc.createElement("span");
        span.textContent = `${l.time} ${l.level} ${l.message}${l.attrs ? ` ${l.attrs}` : ""}`;
        pre.append(span, doc.createTextNode("\n"));
      }
      // keep the DOM window the same size as the ring's
      while (pre.childElementCount > 400) {
        pre.removeChild(pre.firstChild);
        pre.removeChild(pre.firstChild);
      }
      const box = pre.parentElement;
      if (box) box.scrollTop = box.scrollHeight;
    } catch (e) {
      // poll silently: the panel is best-effort
    }
  }


  // ---------- shortcuts (UI_SPEC §5) ----------

  const SHORTCUTS = [
    ["Ctrl+O / Ctrl+S", "open.hint", "save.hint"],
    ["Ctrl+V / 拖入", "load.paste.hint"],
    ["Ctrl+D / Del", "instances.duplicate.btn", "instances.delete.btn"],
    ["加章模式: 左键页面点击", "app.sealAddMode.btn"],
    ["骑缝章模式: 左键页面点击", "app.sealCrossAddMode.btn"],
    ["Ctrl+Enter / Ctrl+Z", "apply.write.btn", "apply.undo.btn"],
    ["←↑↓→", "nudge.hint"],
    ["+ / −", "scale.hint"],
    ["1..9 / PgUp/PgDn", "page.hint"],
    ["Ctrl+wheel", "view.zoom.hint"],
    ["Space + ←↑↓→ / Space + 左键拖动", "view.pan.hint"],
    ["Ctrl + 鼠标中键", "view.fit.hint"],
    ["顶栏 后端终端 开关", "app.console.btn"],
    ["Esc / ?", "esc.hint", "shortcuts.hint"],
  ];


  function renderShortcuts() {
    const tbl = S.q("#shortcuts-table");
    tbl.textContent = "";
    const head = doc.createElement("tr");
    const th1 = doc.createElement("th");
    th1.textContent = S.t("shortcuts.title");
    const th2 = doc.createElement("th");
    th2.textContent = "→";
    head.append(th1, th2);
    tbl.append(head);
    for (const row of SHORTCUTS) {
      const tr = doc.createElement("tr");
      const td1 = doc.createElement("td");
      td1.textContent = row[0];
      const td2 = doc.createElement("td");
      td2.textContent = row.slice(1).map((k) => S.t(k)).join(" / ");
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
    // HD12: the pos box is gone; the keyboard moves the instance through its
    // offset channel (offset = page point under the center anchor).
    const inst = S.selectedInstance();
    if (!inst) return false;
    const [x, y] = parsePos((inst.params || {})["api.apply.offset"]);
    return S.setParam("api.apply.offset", `${Math.round(x + delta[0])},${Math.round(y + delta[1])}`);
  }


  function bumpScale(dir) {
    // The keyboard route reads the *instance's* current value (the panel
    // controls mirror it), and HD12 raised the ceiling from 0.9 to 5 for the
    // same reason the corner drag keeps working past 200%.
    const inst = S.selectedInstance();
    const cur = inst ? Number(inst.params && inst.params["api.apply.scale"]) : NaN;
    const v = Number.isFinite(cur) && cur ? cur : Number(S.readField("api.apply.scale")) || 0.202;
    const next = Math.max(0.05, Math.min(5, +(v + dir * 0.01).toFixed(4)));
    return S.setParam("api.apply.scale", next);
  }


  function onKey(e) {
    const inField = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    if (e.key === "Escape") {
      if (state.modal) S.setModal(null);
      else S.clearToast();
      return;
    }
    // Ctrl+O is the native picker, not the upload input: the picker is the
    // primary way in on a desktop app (UI_SPEC §5, AGENTS §6 fs.pick).
    if ((e.ctrlKey || e.metaKey) && (e.key === "o" || e.key === "O")) {
      e.preventDefault();
      S.pickAndOpen();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      S.setModal("save-modal");
      S.setState("save-confirm");
      return;
    }
    if (inField) return;
    // SP1 (2026-11-05): the 盖到 PDF / 撤销盖章 buttons died with the sidebar
    // sections; the keyboard is now the entry (UI_SPEC §5, SHORTCUTS modal).
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      S.stampIntoPDF();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      S.undoStamping();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) {
      e.preventDefault();
      S.duplicateSelected();
      return;
    }
    if (e.key === "Delete") {
      S.deleteSelected();
      return;
    }
    if (e.key === "?") {
      renderShortcuts();
      S.setModal("shortcuts-modal");
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
    const seg = S.q("#" + id);
    if (!seg) return; // SP1: segments that lived in the removed sidebar sections are gone
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-value]");
      if (!b) return;
      S.qa("button", seg).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      if (fn) fn(b.dataset.value);
      else S.writeField(field, b.dataset.value);
    });
  }


  // ---------- deep link (UI_SPEC 7) ----------
  // #crosspage re-enters the state machine; an unknown hash is ignored so a typo
  // cannot drive the shell into a state the spec does not define. Clearing the
  // hash returns to the underlying document state.
  function applyHash() {
    const name = location.hash.replace(/^#/, "");
    if (name === "crosspage") {
      // SP4: the sidebar section is gone; the deep link just re-enters the
      // state — the cross-page fields live on the selected instance's panel.
      S.setState("crosspage");
      return;
    }
    if (!name) S.setState(state.file ? "opened" : "empty");
  }


  // UI6 (2026-11-10, user dialogue directive): the styled tooltip engine. The
  // native title tooltip gets no theme/typography control, so a [data-i18n-
  // title] hover/focus shows a `.app-tooltip` popover instead (styled in
  // style.css: inverted surface, 8 px radius, 12.5 px/1.45, cn-aware leading).
  // The title attribute is the N2 i18n channel (title + aria-label, asserted
  // by shell-sm) — aria-label never moves; title is only detached while the
  // custom tip owns the hover (native tooltip suppressed for that moment) and
  // the derived pair text is re-put on leave, so a language switch mid-hover
  // cannot restore stale text. Screen-reader naming stays on aria-label.
  function bindTooltips() {
    let tip = null;
    let host = null;
    let stashed = "";
    const tipText = (el) => {
      const p = S.pairFor(el, "title");
      if (!p) return "";
      return state.lang === "cn" ? p.cn : p.en;
    };
    const ensureTip = () => {
      if (!tip) {
        tip = doc.createElement("div");
        tip.className = "app-tooltip";
        tip.dataset.side = "bottom";
        tip.setAttribute("aria-hidden", "true");
        doc.body.appendChild(tip);
      }
      return tip;
    };
    const place = (anchor, t) => {
      const r = anchor.getBoundingClientRect();
      const tr = t.getBoundingClientRect();
      let side = r.top - tr.height - 8 >= 0 ? "top" : "bottom";
      if (side === "bottom" && r.bottom + tr.height + 8 > window.innerHeight) side = "top";
      const top = side === "top"
        ? Math.max(8, r.top - tr.height - 8)
        : Math.min(window.innerHeight - tr.height - 8, r.bottom + 8);
      let left = r.left + r.width / 2 - tr.width / 2;
      left = Math.min(Math.max(8, left), window.innerWidth - tr.width - 8);
      t.dataset.side = side;
      t.style.left = left + "px";
      t.style.top = top + "px";
    };
    const hide = () => {
      if (!host) return;
      if (stashed) host.setAttribute("title", stashed);
      stashed = "";
      host = null;
      if (tip) tip.dataset.show = "false";
    };
    const show = (el) => {
      const text = tipText(el);
      if (!text) return;
      if (el !== host) hide();
      host = el;
      stashed = text;
      // Native tooltip suppression: drop the title attribute while the custom
      // tip owns the hover (aria-label keeps the accessible name intact).
      el.removeAttribute("title");
      const t = ensureTip();
      t.textContent = text;
      place(el, t);
      t.dataset.show = "true";
    };
    doc.addEventListener("pointerover", (e) => {
      const el = e.target.closest && e.target.closest("[data-i18n-title]");
      if (el) show(el);
    });
    doc.addEventListener("pointerout", (e) => {
      const el = e.target.closest && e.target.closest("[data-i18n-title]");
      if (el && el === host && !(el.contains && e.relatedTarget && el.contains(e.relatedTarget))) hide();
    });
    doc.addEventListener("focusin", (e) => {
      const el = e.target.closest && e.target.closest("[data-i18n-title]");
      if (el) show(el);
    });
    doc.addEventListener("focusout", () => hide());
    // The stage pans/zooms without DOM scroll — a stale tip would float over
    // the wrong anchor, so any wheel/drag gesture retires it immediately.
    window.addEventListener("wheel", () => hide(), { passive: true, capture: true });
    window.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  }

  function boot() {
    html.dataset.app = "autostamp";
    bindControls();
    bindTooltips();
    renderShortcuts();
    // HD17 (2026-11-05): no boot-time default instance - instances exist only
    // when the user creates them (add-seal mode click / "Add instance").
    S.setState("empty");
    S.setModal(null);
    window.addEventListener("hashchange", applyHash);
    applyHash();
    api.health()
      .then((h) => {
        // HD2: the version rides the window title - the native caption for the
        // WebView2 window (main.go builds it) and document.title here for the
        // browser fallback.
        state.version = h.version || "";
        S.setDocTitle();
        if (h.name !== "autostamp") S.toast("warn", `foreign app on this port: ${h.name}`);
      })
    api.settings()
      .then((res) => {
        state.settings = res.settings;
        S.applySettings(res.settings);
        // HD8: the recent-seal menu comes straight from the settings record.
        S.renderRecentSeals();
        S.setAddMode(false); // HD10: every load starts with the mode off
        S.setCrosspageAdd(false); // SP4: same for the cross-page placement mode
        if (res.warning) S.toast("warn", res.warning);
      })
      .catch((e) => S.toast("error", `${e.code}: ${e.message}`));
  }

  function bindControls() {
    bindSegment("lang-seg", "ui.lang", (v) => S.applyLang(v));
    bindSegment("theme-seg", "ui.theme", (v) => S.applyTheme(v));

    bindSegment("export-mode", "api.export.mode", (v) => { S.persist("export", { mode: v }); S.refreshEstimate(); });
    bindSegment("export-dpi", "api.export.dpi", (v) => { S.persist("export", { dpi: v }); S.refreshEstimate(); });
    // SP4 (2026-11-05): the binding segment moved into the floating panel and
    // answers to the *selected instance*, not to every instance in bulk (the
    // sidebar cross-page section's group edit is retired): "none" drops that
    // instance back to a plain page stamp, the other values make it span.
    bindSegment("crosspage-binding", "ui.crosspage.binding", (v) => {
      const inst = S.selectedInstance();
      if (!inst) {
        S.toast("warn", S.t("crosspage.binding.fixed"));
        return;
      }
      inst.params = inst.params || S.defaultParams();
      inst.params["ui.crosspage.binding"] = v;
      if (v === "none") {
        inst.crossPage = false;
        inst.params["api.apply.crossPage"] = false;
        inst.params["api.apply.pages"] = S.currentPageWord(); // HD11
        S.renderInstances();
        if (html.dataset.state === "crosspage") S.setState("stamp-selected");
      } else {
        inst.crossPage = true;
        inst.params["api.apply.crossPage"] = true;
        inst.params["api.apply.pages"] = "all"; // HD11/CP1
        S.renderInstances();
      }
      S.persist("apply", { binding: v });
    });
    // N3 (2026-11-09): the 平均|随机切档 is gone - the random draw (Z5) is
    // the only mode, so there is no per-instance seg any more. The cover
    // slider re-rolls on commit (the generic input wiring already synced the
    // instance param + queued the persist).
    qa('#instance-panel [data-field="ui.crosspage.cover"]').forEach((el) => {
      el.addEventListener("change", () => {
        const inst = S.selectedInstance();
        if (!inst || !inst.crossPage) return;
        S.drawCrossSlices(inst);
      });
    });
    // 重试: re-run the random draw for the selected cross-page instance.
    const retry = S.q("#crosspage-retry");
    if (retry) {
      retry.addEventListener("click", () => {
        if (!S.retryCrossSlices()) S.toast("warn", S.t("crosspage.retry.noRandom"));
      });
    }
    // HD12: the floating panel's own actions (复位 = defaults + current page,
    // 删除 = this instance only).
    S.q("#instance-reset").addEventListener("click", () => S.resetInstanceParams());
    S.q("#instance-remove").addEventListener("click", () => S.deleteSelected());
    // HD18: the panel's minimize button and the gear fab are two ends of one
    // switch; the state is per-session (default = collapsed), not persisted.
    S.q("#instance-collapse").addEventListener("click", () => {
      state.panelCollapsed = true;
      S.posInstancePanel();
    });
    S.q("#instance-fab").addEventListener("click", () => {
      state.panelCollapsed = false;
      S.posInstancePanel();
    });
    // HD8/HD10: the header seal channel + the add-seal-mode toggle.
    S.q("#btn-seal-upload").addEventListener("click", () => S.pickSealUpload());
    S.q("#seal-recent-select").addEventListener("change", (e) => S.openRecentSeal(e.target.value === S.CURRENT_MARK ? "" : e.target.value));
    S.q("#btn-seal-add").addEventListener("click", () => S.setAddMode(!state.addMode));
    // SP4 (2026-11-05): the cross-page placement toggle follows HD10's pattern
    // (session-only state, stage cursor hook, aria-pressed pair).
    S.q("#btn-crosspage-add").addEventListener("click", () => S.setCrosspageAdd(!state.crosspageAdd));
    // HD16: the backend-terminal toggle; the initial state rides applySettings.
    S.q("#btn-console").addEventListener("click", () => setConsoleVisible(!state.consoleVisible, true));

    // modal wiring (decision S1); SP5 (2026-11-06): the sidebar's duplicate
    // #save-open entry point is gone - the topbar 保存 button (and Ctrl+S)
    // is the one save-dialog opener.
    S.q("#btn-save").addEventListener("click", () => { S.setModal("save-modal"); S.setState("save-confirm"); });
    S.q("#save-cancel").addEventListener("click", () => { S.setModal(null); S.setState("opened"); });
    S.q("#save-confirm").addEventListener("click", () => {
      if (S.readField("api.save.replaceOriginal")) { S.setModal("confirm-modal"); S.setState("replace-confirm"); return; }
      S.submitSave(false);
    });
    S.q("#confirm-cancel").addEventListener("click", () => {
      S.writeField("api.save.replaceOriginal", false);
      S.setModal("save-modal");
      S.setState("save-confirm");
    });
    S.q("#confirm-ok").addEventListener("click", () => S.submitSave(true));
    // --- P1 open channel: picker / drag and drop (AGENTS §6) ---
    // HD19 (2026-11-06): the empty state is the one centered #empty-pick
    // button (+ the paste/drag hint). The typed path box (#empty-path) is gone;
    // openByPath(path) stays only as a §7 drive channel. Drag/paste still feed
    // submitFiles below, so no hidden <input type=file> is left in the document.
    S.q("#btn-open").addEventListener("click", () => S.pickAndOpen());
    S.q("#empty-pick").addEventListener("click", () => S.pickAndOpen());
    // PD2 (UI_SPEC §8): window-level load gate. Only drags that carry files
    // are intercepted - pure text drags (the one type that never has "Files")
    // pass through untouched. The drop is classified with the SAME gate as
    // paste: single PDF -> open, images -> seal load, everything else warns.
    const stage = S.q("#preview");
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
      S.submitFiles(e.dataTransfer.files);
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
      S.submitFiles(files);
    });
    // P4 write-back (SP1: the buttons are gone — the keyboard route in onKey
    // and the §7 shell API (S.stampIntoPDF/S.undoStamping/S.runSplit) are the
    // entry points now).
    // V7 (2026-11-05, replaces V3): Ctrl+wheel ALWAYS zooms the whole page.
    // The seal box is page-relative, so the seal scales with the view and the
    // seal/page ratio never changes. Instance scaling stays on the corner
    // handles, the slider and the +/- keys. passive:false keeps preventDefault
    // legal (and kills the browser's native pinch-zoom).
    stage.addEventListener(
      "wheel",
      (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        if (!window.__autoStampPreview) return;
        e.preventDefault();
        window.__autoStampPreview.zoomBy(e.deltaY < 0 ? 0.1 : -0.1);
      },
      { passive: false },
    );
    S.q("#shortcuts-close").addEventListener("click", () => S.setModal(null));
    S.q("#btn-shortcuts").addEventListener("click", () => { renderShortcuts(); S.setModal("shortcuts-modal"); });
    S.q("#pw-cancel").addEventListener("click", () => {
      S.setModal(null);
      state.pending = null;
      S.setState(state.file ? "opened" : "empty");
    });
    S.q("#pw-retry").addEventListener("click", () => S.retryOpen());
    S.q("#save-pick").addEventListener("click", () => S.pickSaveTarget());
    S.q("#modal-layer .scrim").addEventListener("click", () => S.setModal(null));
    doc.addEventListener("keydown", onKey);
    // HD12/IP1 (2026-11-09): the panel is docked at the preview's right edge
    // by CSS, so stage scroll/resize no longer reposition anything (the old
    // follow listeners are gone); these events now only refresh show/hide for
    // selection/document changes.
    ["autostamp:param", "autostamp:seal", "autostamp:instance", "autostamp:page", "autostamp:lang"].forEach(
      (name) => doc.addEventListener(name, () => S.posInstancePanel()),
    );
  }

  function probeConsole() {
    const panel = q("#log-console");
    const pre = q("#log-console-body");
    const txt = pre ? pre.textContent.trim() : "";
    return {
      visible: Boolean(panel && !panel.hidden),
      pressed: (q("#btn-console") || { getAttribute: () => null }).getAttribute("aria-pressed"),
      lines: txt ? txt.split("\n").filter(Boolean).length : 0,
      seq: logSeq,
    };
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", boot);
  else boot();
  Object.assign(S, {
    setConsoleVisible, pollLogs, probeConsole, bindControls, renderShortcuts, applyHash,
  });
})();
