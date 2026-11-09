// Copyright 2026 AutoStamp Authors. SPDX-License-Identifier: Apache-2.0
// app-shell-seals.js — part of the app-shell module group (split from
// app-shell.js on 2026-11-05; docs/IMPLEMENTATION_PLAN.md §10.1). the header seal channel: upload button, recent dropdown, add-seal mode (HD8-HD10).
(() => {
  "use strict";

  const S = window.__autoStampShell;
  const q = (sel, root) => (root || document).querySelector(sel);
  const qa = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const doc = document;
  const html = doc.documentElement;
  const api = window.__autoStampApi;
  const state = S.state;


  // HD14: whatever the current seal is, the drop-down mirrors it - a
  // path-opened seal selects its recentSeals entry; a pathless one (paste /
  // drag) gets a marker option that is a no-op when picked.
  const CURRENT_MARK = "__current__";


  function setCurrentSeal(sealId, name, path) {
    state.currentSeal = sealId ? { sealId, name: name || "", path: path || "" } : null;
    renderRecentSeals();
    const sv = window.__autoStampSeal;
    if (sv && sv.renderPreview) sv.renderPreview();
    S.notify("autostamp:seal", { sealId });
    return state.currentSeal;
  }


  // HD10: the toggle. Stage gets a data hook so style.css can show a copy
  // cursor; the button answers to the usual aria-pressed pair.
  function setAddMode(on) {
    state.addMode = Boolean(on);
    if (state.addMode && state.crosspageAdd) S.setCrosspageAdd(false);
    const btn = S.q("#btn-seal-add");
    if (btn) btn.setAttribute("aria-pressed", String(state.addMode));
    const stage = S.q("#preview-stage");
    if (stage) stage.dataset.add = state.addMode ? "on" : "off";
    return state.addMode;
  }

  // SP4 (2026-11-05): the cross-page placement toggle (topbar button beside
  // the add-seal toggle). Same pattern, but the placement is height-anchored:
  // the click's y becomes the instance's startOffset and the strip sits at the
  // binding edge (see addCrossInstanceAt). Turning one mode on turns the
  // plain-add mode off - the two gestures share the same empty-page click.
  function setCrosspageAdd(on) {
    state.crosspageAdd = Boolean(on);
    if (state.crosspageAdd && state.addMode) S.setAddMode(false);
    const btn = S.q("#btn-crosspage-add");
    if (btn) btn.setAttribute("aria-pressed", String(state.crosspageAdd));
    const stage = S.q("#preview-stage");
    if (stage) stage.dataset.add = state.crosspageAdd || state.addMode ? "on" : "off";
    return state.crosspageAdd;
  }


  // HD10+HD11: clicking the page drops the current seal centered on that
  // point, stamped only on the page it was clicked on.
  function addInstanceAt(pt) {
    if (!state.file || !pt) return null;
    const seal = state.currentSeal;
    if (!seal || !seal.sealId) {
      S.toast("warn", S.t("seal.addMode.noseal"));
      return null;
    }
    const page = Number(S.currentPageWord());
    const dims = (state.file.pages || [])[page - 1] || { width: 0, height: 0 };
    const params = Object.assign(S.defaultParams(), {
      // anchor=center: the offset moves from the page centre, so the click
      // point turns into the offset that centers the box on it.
      "api.apply.offset": `${Math.round(pt.x - dims.width / 2)},${Math.round(pt.y - dims.height / 2)}`,
      "api.apply.pages": String(page),
      // Z2 (2026-11-09): the default stamp width is 42 mm and the scale value
      // is derived from the page geometry (portrait: the width IS the page
      // short edge; landscape: the 42 mm target over the long display width;
      // UI_SPEC §8 Z2).
      "api.apply.scale": S.autoScale(),
    });
    const id = S.addInstance(null, params);
    const inst = S.instanceById(id);
    if (inst) inst.sealId = seal.sealId;
    S.renderInstances();
    S.notify("autostamp:seal", { instance: id, sealId: seal.sealId });
    return id;
  }


  function renderRecentSeals() {
    const sel = S.q("#seal-recent-select");
    if (!sel) return [];
    const list = (state.settings && state.settings.recentSeals) || [];
    const prev = sel.value;
    sel.textContent = "";
    const blank = doc.createElement("option");
    blank.value = "";
    sel.append(blank);
    for (const r of list) {
      const opt = doc.createElement("option");
      opt.value = r.path;
      // HD8: the menu shows the name without the extension; the full path is
      // the entry's meaning and rides the tooltip.
      opt.textContent = S.baseName(r.path);
      opt.title = r.path;
      sel.append(opt);
    }
    // HD14: the current seal becomes the selected option after every render;
    // a pathless current seal appends the marker option as its stand-in.
    let target = "";
    const cur = state.currentSeal;
    if (cur) {
      if (cur.path && list.some((r) => r.path === cur.path)) target = cur.path;
      else if (cur.name && !cur.path) {
        const mark = doc.createElement("option");
        mark.value = CURRENT_MARK;
        mark.textContent = cur.name;
        mark.title = cur.name;
        sel.append(mark);
        target = CURRENT_MARK;
      }
    }
    const values = Array.from(sel.options).map((o) => o.value);
    if (target && values.includes(target)) sel.value = target;
    else if (prev && values.includes(prev)) sel.value = prev;
    return list.map((r) => r.path);
  }


  async function pickSealUpload() {
    let picked;
    try {
      picked = await api.pick({ filter: "image" });
    } catch (e) {
      S.toast("error", `${e.code}: ${e.message}`);
      return null;
    }
    if (!picked || picked.cancelled || !picked.picks || !picked.picks.length) return null;
    const p = picked.picks[0];
    return openSealByGrant(p.pathGrantId, p.path);
  }


  async function openRecentSeal(path) {
    if (!path) return null;
    try {
      // The typed-path grant channel stats the file on the way in (AGENTS
      // §6 fs/pick filePath branch), so a deleted file fails here with
      // path_denied rather than at prepare time.
      const picked = await api.pick({ filePath: path, filter: "image" });
      if (!picked.picks || !picked.picks.length) throw Object.assign(new Error("gone"), { code: "path_denied" });
      const p = picked.picks[0];
      return await openSealByGrant(p.pathGrantId, p.path || path);
    } catch (e) {
      if (e && e.code === "path_denied") {
        // The documented fallback: drop the entry from the menu and the
        // settings record, without asking the user.
        dropRecentSeal(path);
        S.toast("warn", S.t("seal.recent.stale"));
        const sel = S.q("#seal-recent-select");
        if (sel) sel.value = "";
        return null;
      }
      S.toast("error", `${e.code || "seal_open"}: ${e.message || String(e)}`);
      return null;
    }
  }


  async function openSealByGrant(pathGrantId, path) {
    const seal = window.__autoStampSeal;
    if (!seal || !seal.prepareFromGrant) return null;
    try {
      const meta = await seal.prepareFromGrant(pathGrantId, path);
      // HD17 (2026-11-05): the dropdown / header channel only sets the current
      // seal now - instances are only made by add-seal mode / Add instance.
      setCurrentSeal(meta.sealId, S.baseName(path), path);
      S.toast("ok", S.t("seal.ok"));
      await refreshSettings();
      return meta;
    } catch (e) {
      if (e && e.code === "path_denied") {
        dropRecentSeal(path);
        S.toast("warn", S.t("seal.recent.stale"));
        return null;
      }
      S.toast("error", `${e.code || "seal_prepare"}: ${e.message}`);
      return null;
    }
  }


  // The server records recentSeals on its own (seal/prepare grant branch), so
  // after every open the local copy is refetched - no duplicate bookkeeping.
  async function refreshSettings() {
    try {
      const res = await api.settings();
      state.settings = res.settings;
      renderRecentSeals();
    } catch (e) {
      // keep the local list; the next open tries again
    }
  }


  // The only settings channel the removal needs: replace the whole group
  // (AGENTS §6, PERSIST semantics).
  function dropRecentSeal(path) {
    const list = ((state.settings && state.settings.recentSeals) || []).filter((r) => r.path !== path);
    state.settings = state.settings || {};
    state.settings.recentSeals = list;
    renderRecentSeals();
    api.patchSettings({ recentSeals: list }).catch((e) => S.toast("error", `${e.code}: ${e.message}`));
    return list;
  }

  Object.assign(S, {
    setCurrentSeal, setAddMode, setCrosspageAdd, addInstanceAt, renderRecentSeals, pickSealUpload,
    openRecentSeal, openSealByGrant, refreshSettings, dropRecentSeal, CURRENT_MARK,
  });
})();
