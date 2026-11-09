// Copyright 2026 AutoStamp Authors. SPDX-License-Identifier: Apache-2.0
// app-pager.js — P1: the #page-pager rail (page counter + one chip per page).
//
// SP2 (2026-11-05): the rail is a bare thumbnail strip — no number span, no
// pill background behind the thumbnail, 2 px gaps (style.css), and the "All"
// pages chip was removed. The thumb height follows the rail (the rail's fixed
// CSS height is the source of truth; the backing store is measured from the
// laid-out canvas, width follows the page aspect).
//
// Keys 1..9 / PgUp / PgDn jump (UI_SPEC §5); the rail's title
// carries the page.hint key.
//
// Thumbnails are rendered lazily through IntersectionObserver, because a 60-page
// document would otherwise queue 60 full page parses on open.
//
// The chips carry no visible text: the counter and the page buttons are
// rewritten on every page turn, so an i18n twin would fight with applyLang()
// (which reads an element's own text as the en value). What is localised is the
// accessible name — t("pager.count") / t("page.hint") — where a translated label
// actually helps a screen reader.
(() => {
  "use strict";

  const doc = document;
  const q = (sel) => doc.querySelector(sel);
  const shell = () => window.__autoStampShell;
  const preview = () => window.__autoStampPreview;
  const t = (key) => (shell() && shell().t(key)) || key;

  // SP2: no fixed thumb height — CSS pins `.pg-thumb` to 100% of the rail;
  // renderThumb measures the laid-out canvas for the backing store.
  const FALLBACK_H = 64; // only used when the rail is not laid out yet

  // state of one rail generation: every build() bumps the generation, and the
  // observer + render tasks of an old rail are dropped instead of leaking.
  let gen = 0;
  let observer = null;
  const tasks = [];

  function teardown() {
    gen++;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    for (const task of tasks) {
      try {
        task.cancel();
      } catch (e) { /* already finished */ }
    }
    tasks.length = 0;
  }

  // build redraws the whole rail: the page count changes whenever an asset is
  // opened (P1 open, later split/export), so rebuilding is cheaper than syncing.
  function build() {
    teardown();
    const nav = q("#page-pager");
    if (!nav) return;
    const p = preview();
    const count = p ? p.pageCount() : 0;
    nav.textContent = "";
    if (!count) return;

    const counter = doc.createElement("span");
    counter.className = "chip";
    counter.dataset.role = "pager-count";
    label(counter, t("pager.count"));
    counter.textContent = `${p.state.page} / ${count}`;
    nav.appendChild(counter);

    for (let n = 1; n <= count; n++) {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.dataset.page = String(n);
      const canvas = doc.createElement("canvas");
      canvas.className = "pg-thumb";
      // The observer callback reads el.dataset.page (the observed target is the
      // canvas, not the button), so the canvas itself has to carry the page
      // number or the lazy render would skip every chip.
      canvas.dataset.page = String(n);
      b.appendChild(canvas);
      b.setAttribute("aria-pressed", String(n === p.state.page));
      label(b, `${t("page.hint")} ${n}`);
      b.addEventListener("click", () => p.goTo(n));
      nav.appendChild(b);
      if ("IntersectionObserver" in window) {
        observeThumb(canvas, n);
      } else {
        renderThumb(canvas, n); // no IO support: render everything
      }
    }

    label(nav, t("page.hint"));
  }

  // label writes both the title and the accessible name; a chip has no visible
  // text space for a translated sentence.
  function label(el, text) {
    el.setAttribute("title", text);
    el.setAttribute("aria-label", text);
  }

  function observeThumb(canvas, page) {
    if (!observer) {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const el = entry.target;
            observer.unobserve(el);
            if (!el.dataset.page) continue;
            queueThumb(el, Number(el.dataset.page));
          }
        },
        { root: q("#page-pager"), threshold: 0.1 },
      );
    }
    observer.observe(canvas);
  }

  // pdf.js keeps one render per PageProxy and cancels the previous one when the
  // same page is rendered again — and a rail thumbnail shares its PageProxy with
  // the main canvas. Without this queue the thumb either stole the main paint or
  // was cancelled itself, which is what left the chips blank.
  let thumbChain = Promise.resolve();

  function queueThumb(canvas, page) {
    thumbChain = thumbChain
      .then(() => renderThumb(canvas, page))
      .catch(() => {
        /* a cancelled/failed thumb paints nothing; the rail stays readable */
      });
  }

  // renderThumb paints one page into one canvas; the CSS pins the canvas
  // height to the rail (style.css), so the backing store is measured from the
  // laid-out box, and the width follows the page's own viewport aspect so
  // portrait and landscape pages both fit the rail without guessing.
  async function renderThumb(canvas, page) {
    const p = preview();
    const myGen = gen;
    if (!p || !p.getPage) return;
    if (p.state.renderTask) {
      // the main canvas may be painting this very page; a thumb may not race it
      try {
        await p.state.renderTask.promise;
      } catch (e) {
        /* cancelled or failed: the main paint is over either way */
      }
    }
    let pageObj;
    try {
      pageObj = await p.getPage(page);
    } catch (e) {
      return; // rail rebuilt (document closed / page changed)
    }
    if (myGen !== gen || !canvas.isConnected) return;
    const cssH = Math.round(canvas.getBoundingClientRect().height) || FALLBACK_H;
    const vp1 = pageObj.getViewport({ scale: 1 });
    const scale = cssH / (vp1.height || 1);
    const vp = pageObj.getViewport({ scale });
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(vp.width * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext("2d");
    const task = pageObj.render({
      canvasContext: ctx,
      viewport: vp,
      transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0],
      background: "#ffffff",
    });
    tasks.push(task);
    try {
      await task.promise;
    } catch (e) {
      // RenderingCancelledException: the rail was rebuilt, which is normal.
    }
  }

  // refresh repaints the pressed state + counter only, so a page turn does not
  // rebuild the whole rail.
  function refresh() {
    const p = preview();
    const nav = q("#page-pager");
    if (!nav || !p) return;
    const count = p.pageCount();
    if (!count) return;
    nav.querySelectorAll("button.chip[data-page]").forEach((b) => {
      b.setAttribute("aria-pressed", String(Number(b.dataset.page) === p.state.page));
    });
    const counter = nav.querySelector("span.chip[data-role='pager-count']");
    if (counter) counter.textContent = `${p.state.page} / ${count}`;
  }

  doc.addEventListener("autostamp:open", build);
  doc.addEventListener("autostamp:page", refresh);
  doc.addEventListener("autostamp:lang", build);

  window.__autoStampPager = { build, refresh };
})();
