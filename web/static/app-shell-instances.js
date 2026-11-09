// Copyright 2026 AutoStamp Authors. SPDX-License-Identifier: Apache-2.0
// app-shell-instances.js — part of the app-shell module group (split from
// app-shell.js on 2026-11-05; docs/IMPLEMENTATION_PLAN.md §10.1). the instance
// model and the floating parameter panel (SP1 cut the sidebar list + the strip
// zoom panel: instances only exist through the placement modes and the panel).
(() => {
  "use strict";

  const S = window.__autoStampShell;
  const q = (sel, root) => (root || document).querySelector(sel);
  const qa = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const doc = document;
  const html = doc.documentElement;
  const api = window.__autoStampApi;
  const state = S.state;


  // ---------- instances (decision I1) ----------

  // SP1 (2026-11-05): the sidebar list (#seal-instances) is gone. The name of
  // this function stays part of the §7 contract - it means "the instance view
  // changed: repaint + reposition the panel", which is what every caller and
  // the verify scripts already drive through it.
  function renderInstances() {
    S.notify("autostamp:instance", {});
    syncCpGroup(S.selectedInstance());
    posInstancePanel();
  }

  // SP4: the cross-page fields ride the floating panel only when the selected
  // instance *is* cross-page (the mode button places those). The binding seg
  // and startOffset pair bind the same vocabulary as the retired sidebar
  // section (ui.crosspage.binding / api.apply.startOffset).
  // Z5: the sliceMode seg always rides the cross-page group; the cover slider
  // and the retry button answer to the *random* draw only, so they hide unless
  // that instance is on 随机.
  function syncCpGroup(inst) {
    const on = Boolean(inst && inst.crossPage);
    qa("#instance-panel .cp-group").forEach((g) => {
      g.hidden = !on;
    });
    const declared = inst && inst.params && inst.params["ui.crosspage.sliceMode"] !== undefined
      ? inst.params["ui.crosspage.sliceMode"]
      : S.readField("ui.crosspage.sliceMode");
    const rand = on && declared === "random";
    qa("#instance-panel .cp-rand").forEach((g) => {
      g.hidden = !rand;
    });
    return on;
  }


  // Z5 (2026-11-09, user spec): the 随机 draw. A real cross-page seal stamped
  // over opened folds lands unevenly — different pages hold different shares
  // of the mark, and some pages get nothing. The user's own constraints:
  //   - first page:  25..50% of the seal width (drawd),
  //   - last page:   20..30%,
  //   - cover slider (覆盖率): the share of *middle* pages that get a strip at
  //     all, rounded half-up (60% of 10 middle pages = 6 pages stamped, 4 gaps),
  //   - the printed middle shares drift **smoothly** along page order — one
  //     slow trend (pages 1..11 rise, 11..20 fall; or a single climb over the
  //     whole document), never a page-to-page zigzag.
  // The fractions are shares of the whole-seal width; their cumulative sum
  // drives which bitmap columns each slot shows (content continuity), so a
  // gap fraction of 0 still shifts the *next* covered page's content by the
  // unprinted region's neighbours — exactly what a stamp gap looks like.
  // Σ = 1 by construction; the disk side (api.apply.slices) reuses the same
  // array verbatim. N=2: the mark must span both pages, so the first page's
  // drawn range wins and the last page is the remainder.
  function randomCrossFractions(count, cover, rng) {
    if (count <= 1) return [1];
    const f1 = +(0.25 + 0.25 * rng()).toFixed(4);
    const fN = +(0.2 + 0.1 * rng()).toFixed(4);
    if (count === 2) return [f1, +(1 - f1).toFixed(4)];
    const m = count - 2;
    const covered = Math.max(0, Math.min(m, Math.round((cover / 100) * m))); // 四舍五入
    const idx = Array.from({ length: m }, (_, i) => i);
    for (let i = idx.length - 1; 0 < i; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
    }
    const cov = new Set(idx.slice(0, covered));
    // One slow wave across the page order: at most a half-period (climb-then-
    // fall or fall-then-climb), amplitude 0.25..0.5 of the even share.
    const amp = 0.25 + 0.25 * rng();
    const T = count * (2 + 2 * rng()); // half-period = one or two documents
    const phase = rng() * Math.PI * 2;
    const w = [];
    for (let i = 0; i < m; i += 1) {
      w.push(Math.max(0.12, 1 + amp * Math.cos((2 * Math.PI * i) / T + phase)));
    }
    const budget = 1 - f1 - fN;
    let sumW = 0;
    cov.forEach((i) => { sumW += w[i]; });
    const fr = new Array(count).fill(0);
    fr[0] = f1;
    fr[count - 1] = fN;
    let placed = 0;
    let lastCov = -1;
    for (let i = 0; i < m; i += 1) {
      if (!cov.has(i)) continue;
      const v = +((budget * w[i] / sumW).toFixed(4));
      fr[i + 1] = v;
      placed += v;
      lastCov = i + 1;
    }
    if (lastCov >= 0) fr[lastCov] = +(fr[lastCov] + (budget - placed)).toFixed(4);
    return fr;
  }

  // crossSlotCount mirrors app-overlay's parsePages for the instance's page
  // word: how many slots the strip band runs through.
  function crossSlotCount(inst, pageCount) {
    const word = (inst.params && inst.params["api.apply.pages"]) || "all";
    if (!word || word === "all") return Math.max(1, pageCount);
    let n = 0;
    for (const part of String(word).split(/[,;\s]+/).filter(Boolean)) {
      const m = /^(\d+)(?:-(\d+))?$/.exec(part);
      if (!m) continue;
      const a = +m[1];
      const b = m[2] ? +m[2] : a;
      for (let p = Math.min(a, b); p <= Math.max(a, b); p += 1) {
        if (p >= 1 && p <= pageCount) n += 1;
      }
    }
    return Math.max(1, n);
  }

  // drawCrossSlices rolls the instance's slice list (new Math.random draw).
  // Called on placement (随机 mode), on the panel's retry button, and every
  // time the cover slider or the sliceMode seg moves.
  function drawCrossSlices(inst) {
    if (!inst || !inst.crossPage || !state.file) return null;
    const pageCount = (state.file.pageCount || (state.file.pages && state.file.pages.length) || 1);
    const count = crossSlotCount(inst, pageCount);
    const declared = inst.params && inst.params["ui.crosspage.sliceMode"] !== undefined
      ? inst.params["ui.crosspage.sliceMode"]
      : S.readField("ui.crosspage.sliceMode");
    if (declared !== "random") {
      if (inst.params) delete inst.params["api.apply.slices"];
      S.renderInstances();
      return null;
    }
    const coverRaw = Number(inst.params && inst.params["ui.crosspage.cover"] !== undefined
      ? inst.params["ui.crosspage.cover"] : S.readField("ui.crosspage.cover"));
    const cover = Math.max(0, Math.min(100, Number.isFinite(coverRaw) ? coverRaw : 75));
    const fr = randomCrossFractions(count, cover, Math.random);
    inst.params = inst.params || S.defaultParams();
    inst.params["api.apply.slices"] = fr;
    S.renderInstances();
    return fr;
  }

  // retryCrossSlices is the panel's 重试 button: re-roll the random values for
  // the selected cross-page instance.
  function retryCrossSlices() {
    const inst = S.selectedInstance();
    if (!inst || !inst.crossPage) return null;
    return drawCrossSlices(inst);
  }

  function addInstance(name, params) {
    const p = params || S.defaultParams();
    const inst = {
      id: state.nextInstance++,
      name: name || `Seal ${state.instances.length + 1}`,
      // SP4: a cross-page instance is one the placement mode created (the
      // panel has no crossPage checkbox - the mode is the entry point).
      crossPage: Boolean(p["api.apply.crossPage"]),
      // P2: the instance's own parameter group; settings.json only carries
      // the group as the defaults for a new one.
      params: p,
      // HD17 (2026-11-05): a fresh instance snapshots the current seal (the
      // upload / dropdown / drop channels all keep it in state.currentSeal).
      sealId: state.currentSeal ? state.currentSeal.sealId : null,
    };
    // HD11: the page the instance answers to. A cross-page instance owns every
    // page it was stamped across; a plain one starts out bound to the page it
    // was created on (the click of add-seal mode, the click of the cross-page
    // add mode, the boot default before any document is loaded).
    if (inst.params["api.apply.pages"] === undefined) {
      inst.params["api.apply.pages"] =
        inst.crossPage || !state.file ? "all" : S.currentPageWord();
    }
    state.instances.push(inst);
    state.selected = inst.id;
    // SP4: a new cross-page instance carries a non-default startOffset (the
    // click height); the panel's cp pair must show that instance value, not
    // the group defaults. loadParams writes every instance channel to control.
    S.loadParams(inst);
    renderInstances();
    return inst.id;
  }


  function selectInstance(id) {
    const prev = state.selected;
    state.selected = id;
    renderInstances();
    if (id !== prev) S.loadParams(S.instanceById(id));
    S.setState(id ? "stamp-selected" : "opened");
    return id;
  }


  function deleteSelected() {
    if (state.selected === null) return null;
    // HD17 (2026-11-05): instances delete down to zero - nothing is ever
    // auto-placed any more, so an empty list is a legitimate state.
    const id = state.selected;
    state.instances = state.instances.filter((i) => i.id !== id);
    state.selected = state.instances.length ? state.instances[0].id : null;
    renderInstances();
    S.setState(state.selected === null ? "opened" : "stamp-selected");
    return id;
  }


  function duplicateSelected() {
    const src = S.instanceById(state.selected);
    const inst = {
      id: state.nextInstance++,
      name: src ? `${src.name} *` : `Seal ${state.instances.length + 1}`,
      crossPage: src ? src.crossPage : false,
      params: src ? { ...src.params } : S.defaultParams(),
      sealId: src ? src.sealId : null,
    };
    // HD11: the copy is placed on the page the user is looking at now; a
    // cross-page copy keeps the full page list.
    if (!inst.crossPage && inst.params) inst.params["api.apply.pages"] = S.currentPageWord();
    state.instances.push(inst);
    state.selected = inst.id;
    renderInstances();
    S.loadParams(inst);
    return inst.id;
  }


  function setSealForSelected(sealId) {
    const inst = S.selectedInstance();
    if (!inst) return null;
    inst.sealId = sealId;
    renderInstances();
    S.notify("autostamp:seal", { instance: inst.id, sealId });
    return inst.id;
  }


  // SP4 (2026-11-05): the cross-page add mode's placement. The click only
  // answers to *height*: the strip sits at the binding edge (edge anchored,
  // UI_SPEC D2), and the clicked page-point's y becomes the instance's
  // startOffset (the same channel the vertical drag and the panel write).
  function addCrossInstanceAt(pt) {
    if (!state.file || !pt) return null;
    const seal = state.currentSeal;
    if (!seal || !seal.sealId) {
      S.toast("warn", S.t("seal.addMode.noseal"));
      return null;
    }
    const params = Object.assign(S.defaultParams(), {
      "api.apply.crossPage": true,
      "api.apply.pages": "all",
      "api.apply.startOffset": +Number(pt.y).toFixed(1),
      // Z2: the same 42 mm default scale a plain placement gets.
      "api.apply.scale": S.autoScale(),
    });
    const id = S.addInstance(null, params);
    const inst = S.instanceById(id);
    if (inst) inst.sealId = seal.sealId;
    // Z5: a placement on 随机 mode rolls the simulated binding distribution
    // the moment the instance is placed (the retry button re-rolls later).
    if (inst) drawCrossSlices(inst);
    S.renderInstances();
    S.notify("autostamp:seal", { instance: id, sealId: seal.sealId });
    return id;
  }


  // IP1 (2026-11-09, supersedes HD12's anchor chain): the panel is DOCKED at
  // the right edge of the preview area (fixed by CSS, never beside the
  // instance box). What's left here is only the show/hide semantics: no
  // selection / no document -> everything hidden; collapsed mode shows the
  // gear fab at the same dock position (HD18 unchanged).
  function posInstancePanel() {
    const panel = S.q("#instance-panel");
    const fab = S.q("#instance-fab");
    if (!panel) return null;
    const inst = S.selectedInstance();
    const live = Boolean(inst && state.file);
    const collapsed = state.panelCollapsed;
    panel.hidden = collapsed || !live;
    if (fab) fab.hidden = !collapsed || !live;
    return { collapsed };
  }


  // The panel's reset button: defaults from the panel group + HD11's current
  // page, exactly like a freshly placed instance. A cross-page instance keeps
  // its cross-page fields (the mode is why it exists; "No cross-page seal" is
  // the binding segment's honest answer to dropping it).
  function resetInstanceParams() {
    const inst = S.selectedInstance();
    if (!inst) return null;
    const crossPage = inst.crossPage;
    const binding = inst.params && inst.params["ui.crosspage.binding"];
    const startOffset = inst.params && inst.params["api.apply.startOffset"];
    inst.params = S.defaultParams();
    // Z2: "Reset" means "back to what a fresh placement would start at", and a
    // fresh placement computes the scale from the page's short edge (42 mm).
    inst.params["api.apply.scale"] = S.autoScale();
    if (crossPage) {
      inst.params["api.apply.crossPage"] = true;
      inst.params["api.apply.pages"] = "all";
      inst.params["ui.crosspage.binding"] = binding || "right";
      inst.params["api.apply.startOffset"] =
        startOffset !== undefined && startOffset !== null ? startOffset : 0;
      // Z5: a reset on 随机 re-rolls the simulated distribution just like a
      // fresh placement would (the slice list is part of what reset undoes).
      drawCrossSlices(inst);
    } else {
      inst.params["api.apply.pages"] = S.currentPageWord();
    }
    S.loadParams(inst);
    renderInstances();
    return inst.id;
  }

  Object.assign(S, {
    renderInstances, addInstance, selectInstance, deleteSelected, duplicateSelected,
    setSealForSelected, posInstancePanel, resetInstanceParams, syncCpGroup,
    addCrossInstanceAt, drawCrossSlices, retryCrossSlices, randomCrossFractions,
  });
})();
