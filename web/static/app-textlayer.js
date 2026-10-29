// Copyright 2026 AutoStamp Authors. SPDX-License-Identifier: Apache-2.0
// app-textlayer.js — P1: searchable/selectable text over the rendered page.
//
// AGENTS §5.4: text extraction happens in the front-end only; this module is the
// one that *shows* it (an invisible, selectable layer), never the one that hides
// a fallback. pdf.js' TextLayer class is exported by build/pdf.min.mjs (FACTS
// §1.1); the official viewer's TextLayerBuilder (web/pdf_viewer.mjs) is not
// vendored, so the layer is driven directly here.
//
// The CSS the spans need lives in vendor/pdfjs/web/pdf_viewer.css (the
// .textLayer block) and reads --total-scale-factor, which pdf.js multiplies into
// every length: setLayerDimensions() writes
// `round(down, var(--total-scale-factor) * <raw page unit>px, ...)`, where the
// raw unit is the *unscaled* PDF page extent. So the factor is the same
// scale × device-pixel-ratio pair the canvas backing store uses, and the layer
// box is scaled back down by 1/dpr so it occupies exactly the canvas CSS box.
// Measured in tools/verify/preview-smoke.mjs (FACTS §1.7).
(() => {
  "use strict";

  const doc = document;

  async function attach({ pdfjs, pageObj, viewport, frame, dpr }) {
    const div = doc.createElement("div");
    div.className = "textLayer";
    const factor = viewport.scale * dpr;
    div.style.setProperty("--total-scale-factor", String(factor));
    div.style.setProperty("--scale-round-x", "1px");
    div.style.setProperty("--scale-round-y", "1px");
    // /UserUnit scales the whole page; PDFs we open never set it above 1, but
    // the viewer CSS multiplies it in, so it has to exist for the calc() chain.
    div.style.setProperty("--user-unit", "1");
    if (dpr !== 1) {
      div.style.transform = `scale(${1 / dpr})`;
      div.style.transformOrigin = "0 0";
    }
    frame.appendChild(div);

    // streamTextContent() is the streaming form; the object form is accepted too
    // (the class wraps it in a ReadableStream).
    const source = pageObj.streamTextContent
      ? pageObj.streamTextContent()
      : await pageObj.getTextContent();
    const layer = new pdfjs.TextLayer({
      textContentSource: source,
      container: div,
      viewport,
    });
    await layer.render();
    return { div, layer };
  }

  // count reports how many text items the page yielded, for the verify script's
  // "getTextContent 文本条数断言" (IMPLEMENTATION_PLAN §P1 acceptance).
  async function count(pageObj) {
    const tc = await pageObj.getTextContent();
    return tc.items.length;
  }

  window.__autoStampTextLayer = { attach, count };
})();
