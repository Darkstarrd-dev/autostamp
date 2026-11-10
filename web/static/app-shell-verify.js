// Copyright 2026 AutoStamp Authors. SPDX-License-Identifier: Apache-2.0
// app-shell-verify.js — part of the app-shell module group (split from
// app-shell.js on 2026-11-05; docs/IMPLEMENTATION_PLAN.md §10.1). the UI_SPEC §7 verify hooks (ids/probe/i18nPairs) — the mirror of the mock's API.
(() => {
  "use strict";

  const S = window.__autoStampShell;
  const q = (sel, root) => (root || document).querySelector(sel);
  const qa = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const doc = document;
  const html = doc.documentElement;
  const api = window.__autoStampApi;
  const state = S.state;


  // ---------- verify hooks (UI_SPEC §7) ----------

  function ids() {
    return S.qa("[id]").map((el) => el.id).sort();
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
        const el = S.q("#error-toast");
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
        const e = S.computeEstimate();
        if (!e) return { mode: "", pagesSelected: 0, pagesTotal: 0, perPageBytes: null, totalBytes: null, perPageText: "", totalText: "" };
        return {
          mode: e.mode,
          dpi: e.dpi,
          quality: e.quality,
          areaFactor: Number(e.areaFactor.toFixed(3)),
          pagesSelected: S.exportPagesSelected(),
          pagesTotal: state.file ? state.file.pages.length : 0,
          perPageBytes: Math.round(e.perPageBytes),
          totalBytes: Math.round(e.totalBytes),
          perPageText: S.q("#estimate-per-page").textContent,
          totalText: S.q("#estimate-total").textContent,
        };
      }
      case "labels":
        return S.qa("[data-i18n]").map((el) => ({ key: el.getAttribute("data-i18n"), text: el.textContent.trim() }))
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
          spreadPages: S.spreadPages(),
          instances: state.instances.map((i) => ({
            id: i.id, sealId: i.sealId || null,
            crossPage: Boolean(i.crossPage),
          })),
          stampBody: S.stampBodyOf(),
          splitBody: S.splitBodyOf(),
        };
      case "strips": {
        // SP1: the sidebar strip-zoom panel is gone; the strips the user sees
        // are the overlay's per-page boxes. This probe reads *that* - the
        // strip context of every cross-page instance on the current page plus
        // the painted page-space rect, so startOffset/edge/alternation stay
        // assertable without a DOM host.
        const ov = window.__autoStampOverlay;
        const kids = ov && ov.state.strips
          ? Array.from(ov.state.strips.entries()).map(([id, s]) => {
            const rect = ov.state.rects.get(id);
            const out = ov.state.outlines && ov.state.outlines.get ? ov.state.outlines.get(id) : null;
            return {
              id,
              index: s.index,
              count: s.count,
              edge: s.edge,
              frac: s.frac,
              cum: s.cum,
              x: rect ? Math.round(rect.x) : null,
              y: rect ? Math.round(rect.y) : null,
              w: rect ? Math.round(rect.w) : null,
              h: rect ? Math.round(rect.h) : null,
              // UI5-B1: the affordance outline (whole-seal box at the binding
              // edge) - DOM/hit-test frame the selection actually shows.
              ox: out ? Math.round(out.x) : null,
              oy: out ? Math.round(out.y) : null,
              ow: out ? Math.round(out.w) : null,
              oh: out ? Math.round(out.h) : null,
            };
          })
          : [];
        return { count: kids.length, strips: kids };
      }
      case "exportBody":
        // The last raster submission (P5): the exact spec JSON plus the page
        // numbers, per-page blob sizes and pixel boxes, so tools/verify can pin
        // the wire shape without a private test hook. null until raster ran.
        return S.exportBodyOf();
      case "pageMeta":
        return (state.file && state.file.pages)
          ? state.file.pages.map((pg) => ({
            number: pg.number, width: pg.width, height: pg.height, rotation: pg.rotation,
          }))
          : [];
      case "load":
        // PD1/PD2 load-gate readout: what the last paste/drop decided.
        return S.loadLogOf();
      case "page":
        return Number(S.currentPageWord());
      case "addMode":
        return state.addMode;
      case "crosspageAdd":
        // SP4: the placement mode + the floating panel's cross-page group
        // visibility for the selected instance (Z5: even mode shows 3 fields,
        // random mode adds the cover + retry pair).
        return {
          on: Boolean(state.crosspageAdd),
          cpFields: qa("#instance-panel .cp-group").filter((g) => !g.hidden).length,
          binding: S.readField("ui.crosspage.binding") || null,
          startOffset: S.readField("api.apply.startOffset"),
        };
      case "defaults":
        return S.defaultsProbe();
      case "currentSeal":
        return state.currentSeal ? { ...state.currentSeal } : null;
      case "recentSeals": {
        // The menu the user sees + the record they did not (UI_SPEC §8 HD8):
        // option labels carry the name without the extension, while the full
        // path list is what settings.recentSeals keeps.
        const sel = S.q("#seal-recent-select");
        const list = (state.settings && state.settings.recentSeals) || [];
        return {
          paths: list.map((r) => r.path),
          names: list.map((r) => S.baseName(r.path)),
          optionNames: sel ? Array.from(sel.options).filter((o) => o.value).map((o) => o.textContent) : [],
          optionValues: sel ? Array.from(sel.options).filter((o) => o.value).map((o) => o.value) : [],
          // HD14: the option in use (path or the marker).
          selected: sel ? sel.value : "",
        };
      }
      case "sealPreview": {
        const card = S.q("#seal-preview");
        const cv = S.q("#seal-preview-canvas");
        const nm = S.q("#seal-preview-name");
        return {
          visible: Boolean(card && !card.hidden),
          w: cv ? cv.width : 0,
          h: cv ? cv.height : 0,
          name: nm ? nm.textContent : "",
          drawn: cv ? Boolean(cv.width > 0) : false,
        };
      }
      case "instancePanel": {
        // HD18: `visible` = the full panel is up; fabVisible = the square gear
        // button; left/top/w/h report whichever surface is up (panel or fab).
        const panel = S.q("#instance-panel");
        const fab = S.q("#instance-fab");
        const panelUp = Boolean(panel && !panel.hidden);
        const fabUp = Boolean(fab && !fab.hidden);
        const el = panelUp ? panel : fabUp ? fab : null;
        const r = el ? el.getBoundingClientRect() : null;
        return {
          visible: panelUp,
          collapsed: Boolean(state.panelCollapsed),
          fabVisible: fabUp,
          left: r ? Math.round(r.left) : 0,
          top: r ? Math.round(r.top) : 0,
          w: r ? Math.round(r.width) : 0,
          h: r ? Math.round(r.height) : 0,
        };
      }
      case "console":
        return S.probeConsole();
      default:
        throw new Error(`unknown probe: ${name}`);
    }
  }


  // i18nPairs reports every registered key with both languages so the verify
  // script can prove each control carries an en + cn twin (UI_SPEC 4).
  function i18nPairs() {
    const out = [];
    S.qa("[data-i18n]").forEach((el) => {
      const p = S.pairFor(el, "text");
      if (p) out.push({ key: p.key, en: p.en, cn: p.cn, kind: "text" });
    });
    S.qa("[data-i18n-placeholder]").forEach((el) => {
      const p = S.pairFor(el, "placeholder");
      if (p) out.push({ key: p.key, en: p.en, cn: p.cn, kind: "placeholder" });
    });
    S.qa("[data-i18n-title]").forEach((el) => {
      const p = S.pairFor(el, "title");
      if (p) out.push({ key: p.key, en: p.en, cn: p.cn, kind: "title" });
    });
    return out;
  }


  Object.assign(S, {
    ids, verifyState, probe, i18nPairs,
  });
})();
