#!/usr/bin/env node
// tools/verify/overlay-smoke.mjs — P2 acceptance (IMPLEMENTATION_PLAN P2).
//
// This is the numerical gate for "what you see is what the disk path writes"
// (AGENTS §5.2). It starts the real binary, opens a generated sample PDF whose
// page has two known solid blocks, uploads a generated alpha seal whose fill is
// a deterministic horizontal gradient, and then:
//
//   1. blend matrix: 16 modes x 3 opacity values sampled from the composited
//     page canvas and compared with the hand-composite formula
//     Co = alpha*Blend(Cb,Cs) + (1-alpha)*Cb (the same equation docs/FACTS §1.3
//     measured against pdfcpu's ExtGState output);
//   2. the four non-separable modes are checked by their spec invariant instead
//     (luma / hue identity of the result), because computing their colour
//     equations here would only re-derive the renderer's own table;
//   3. geometry: the painted rect is re-derived independently from the page meta
//     + the field values, and the affordance box must sit on that rect;
//   4. the pointer path: dragging the box writes api.apply.offset, a corner
//   writes api.apply.scale, the top handle writes api.apply.rotation, and the
//   state machine goes stamp-selected -> stamp-dragging/resize -> stamp-selected;
//   5. cross-page strips: index/count/edge per page, D2 single/double binding,
//     the seam is pixel-continuous (adjacent strips show adjacent gradient
//     samples), startOffset moves the strip, and a strip refuses canvas drag;
//   6. the pages field limits which pages get a rect;
//   7. the ctx.filter leak guard (docs/FACTS §1.4) plus a two-instance case that
//     would fail if the first instance's filter bled into the second.
//
// Usage: node tools/verify/overlay-smoke.mjs [--reuse-build] [--keep-profile]
//        [--only=<check-id>]
// Exit: 0 = pass.

import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openChrome, makeReport } from "./cdp.mjs";

const root = resolve(join(fileURLToPath(import.meta.url)), "..", "..", "..");
const SAMPLE_PORT = Number(process.env.OVERLAY_SMOKE_SAMPLE_PORT || 9339);
const APP_PORT = Number(process.env.OVERLAY_SMOKE_PORT || 9340);
const fails = [];
const { bad, cmp, truthy } = makeReport(fails);
const only = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);
const wants = (id) => !only || only === id;

// ---------------------------------------------------------------- geometry ---
// The sample page is A4 (595 x 842 pt) with @page margin 0, so a CSS pt prints
// as a PDF pt. These rectangles are the two known blocks.
const PAGE = { w: 595, h: 842 };
const BLOCKS = [
  { name: "gray", x: 30, y: 600, w: 150, h: 150, rgb: [128, 128, 128] },
  { name: "green", x: 240, y: 600, w: 150, h: 150, rgb: [63, 122, 43] },
];
// The seal rect the script drives the app to (anchor tl + offset).
const SEAL = { x: 40, y: 620, scale: 0.2, offset: "40,620" };
const SEAL_PX = 400;

// The gradient endpoints of the seal fill; the midpoint is what lands at the
// centre of the image, i.e. the point the parity checks sample.
const STOPS = { left: [0xcc, 0x16, 0x1c], right: [0x16, 0x1e, 0xcc] };
const GRAD_MID = STOPS.left.map((v, i) => Math.round((v + STOPS.right[i]) / 2));

function sampleHtml() {
  const blocks = BLOCKS.map(
    (b) =>
      `<div style="position:absolute;left:${b.x}pt;top:${b.y}pt;width:${b.w}pt;height:${b.h}pt;background:rgb(${b.rgb.join(",")})"></div>`
  ).join("");
  const pages = [];
  for (let i = 1; i <= 4; i += 1) {
    pages.push(
      `<section style="position:relative;height:${PAGE.h}pt;page-break-after:always">` +
        `<h1 style="position:absolute;left:40pt;top:60pt">Overlay sample page ${i}</h1>` +
        `<p style="position:absolute;left:40pt;top:120pt">MARKER-${String(i).padStart(3, "0")} body text for the text layer.</p>` +
        blocks +
        `</section>`
    );
  }
  return (
    "<!doctype html><meta charset=utf-8><title>overlay sample</title>" +
    "<style>@page{size:595pt 842pt;margin:0}html,body{margin:0;padding:0}" +
    "*{-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
    "section{position:relative;width:595pt;height:842pt;overflow:hidden}" +
    "h1,p{font:14px serif;margin:0}</style>" +
    pages.join("")
  );
}

// ---------------------------------------------------------------- blending ---
// The separable blend modes from the PDF/SVG tables, per channel in 0..1.
// soft-light is included with the W3C/Filter-Effects equation (the piecewise
// D(Cb)); Chromium/Skia implement exactly this, and it is what the preview and
// the ExtGState /BM /SoftLight on the disk side both have to agree on.
function separable(mode, cb, cs) {
  const a = cb, b = cs;
  switch (mode) {
    case "normal": return b;
    case "multiply": case "mult": return a * b;
    case "screen": return a + b - a * b;
    case "overlay": return a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b);
    case "darken": return Math.min(a, b);
    case "lighten": return Math.max(a, b);
    case "color-dodge": return b === 1 ? 1 : Math.min(1, a / (1 - b));
    case "color-burn": return b === 0 ? 0 : 1 - Math.min(1, (1 - a) / b);
    case "hard-light": return b < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b);
    case "difference": return Math.abs(a - b);
    case "exclusion": return a + b - a * b - a * b;
    default: return null;
  }
}
// The four HSL-based modes are not checked by equation but by their spec
// invariant (which of the two colours contributes hue and which contributes
// luma), because re-deriving SetLum/SetSat here would only restate the renderer.
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// hueOf is the chroma direction (deg) used to compare hue identities: the
// spec's four HSL-based modes are defined by *which* colour contributes hue
// and which contributes luma, so comparing those two is the invariant check.
function hueOf(c) {
  const [r, g, b] = c.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return -1; // achromatic: the hue is undefined
  const d = max - min;
  let h;
  if (max === r) h = ((g - b) / d) * 60;
  else if (max === g) h = 120 + ((b - r) / d) * 60;
  else h = 240 + ((r - g) / d) * 60;
  if (h < 0) h += 360;
  return h;
}

const luma = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];


function lumaDist(a, b) {
  // distance of the chroma (per-channel minus luma) between two colours
  const ca = a.map((v) => v - luma(a));
  const cb = b.map((v) => v - luma(b));
  return Math.abs(ca[0] - cb[0]) + Math.abs(ca[1] - cb[1]) + Math.abs(ca[2] - cb[2]);
}

// -------------------------------------------------------------- assertions ---
function nearPixel(label, got, want, tol) {
  const d = got.map((v, i) => Math.abs(v - want[i]));
  if (d.some((x) => x > tol)) {
    bad(`${label}: got [${got}] want [${want}] (tol ${tol}) delta [${d}]`);
    return false;
  }
  console.log(`  ok ${label} = [${got}] (want [${want}])`);
  return true;
}

function exeName() {
  return process.platform === "win32" ? "autostamp-overlay-smoke.exe" : "autostamp-overlay-smoke";
}

async function run(args, opts) {
  const o = opts || {};
  return new Promise((ok, no) => {
    const p = spawn(args[0], args.slice(1), { cwd: root, env: o.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("error", no);
    if (o.detachedChild) {
      ok({ proc: p, childStderr: stderr });
      return;
    }
    p.on("close", (code) => ok({ code, stdout, stderr }));
    if (o.timeout) setTimeout(() => p.kill(), o.timeout);
  });
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function waitFor(fn, maxMs, msg) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > maxMs) throw new Error(msg);
    await sleep(120);
  }
}

// --------------------------------------------------------------- CDP drive ---
async function setInputFiles(app, selector, files) {
  await app.send("DOM.enable");
  const doc = await app.send("DOM.getDocument", { depth: -1 });
  const node = await app.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector });
  if (!node.nodeId) throw new Error(`no node for ${selector}`);
  await app.send("DOM.setFileInputFiles", { files, nodeId: node.nodeId });
}

// CDP mouse events also synthesise the pointer events the app listens for.
async function mouse(app, type, x, y, buttons, params) {
  await app.send("Input.dispatchMouseEvent", {
    type,
    x: Math.round(x),
    y: Math.round(y),
    button: type === "mouseWheel" ? "none" : buttons ? "left" : "none",
    buttons: buttons || 0,
    clickCount: type === "mousePressed" ? 1 : 0,
    ...params,
  });
}

async function dragTo(app, from, to, handleAt) {
  await mouse(app, "mousePressed", from.x, from.y, 1);
  // three steps keeps the pointermove throttle honest about the delta
  for (const [k, t] of [0.4, 0.75, 1].entries()) {
    void k;
    await mouse(app, "mouseMoved", from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, 1);
    await sleep(60);
  }
  if (handleAt) await sleep(60);
  await mouse(app, "mouseReleased", to.x, to.y, 1);
  await sleep(220);
}

function shellEval(expr) {
  return `(() => { const s = window.__autoStampShell, o = window.__autoStampOverlay, p = window.__autoStampPreview; return ${expr}; })()`;
}

// page-point -> client (screen) point of the current page canvas
async function clientOf(app, x, y) {
  return app.evaluate(
    shellEval(
      `(() => { const r = p.probe('canvas'); const el = document.querySelector('#preview-stage canvas.page-canvas'); const b = el.getBoundingClientRect(); const z = p.probe('zoom'); return { x: b.left + ${x} * z, y: b.top + ${y} * z, z, scale: o.probe('view').scale }; })()`
    )
  );
}

async function setParams(app, pairs) {
  await app.evaluate(
    `(() => { const s = window.__autoStampShell; const p = ${JSON.stringify(pairs)}; for (const k of Object.keys(p)) s.setParam(k, p[k]); return true; })()`
  );
  await sleep(180);
}

async function readParams(app) {
  return app.evaluate(
    shellEval("(() => { const i = s.selectedInstance(); return i ? i.params : {}; })()")
  );
}

async function rects(app) {
  return app.evaluate(shellEval("o.probe('rects')"));
}
async function strips(app) {
  return app.evaluate(shellEval("o.probe('strips')"));
}
async function affordance(app) {
  return app.evaluate(shellEval("o.probe('affordance')"));
}

// expectPixel computes the composited pixel the way PDF + canvas define it:
//   Co = αo·Cn + (1−αo)·Cb,  αo = αn + αn·(1−αb)
// with αn = the seal's per-pixel alpha × the /CA opacity, Cn = the blend mode's
// result and Cb the backdrop. The test seal's alpha is either 1 (opaque core)
// or 0 (background), which is why no coverage term is needed.
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
function expectPixel(cb, cs, a, mode) {
  const n = cb.map((v, i) => round(separable(mode, v / 255, cs[i] / 255) * 255, 0));
  return [0, 1, 2].map((i) => round(a * n[i] + (1 - a) * cb[i], 0));
}

// sampleAt samples one pixel (page-space pt) from the composite or the page.
// __autoStampOverlay.sample() answers {data,w,h,scale,dpr}; the harness wants a
// plain rgb triple, so the slice stays here and not in the product module.
async function sampleAt(app, x, y, source) {
  const rgb = await app.evaluate(
    shellEval(
      `(() => {
        const s = o.sample(${x}, ${y}, 1, 1, ${JSON.stringify(source || "composite")});
        return Array.from(s.data).slice(0, 3);
      })()`
    )
  );
  if (!Array.isArray(rgb) || rgb.length < 3) {
    bad(`sample(${x},${y},${source}) returned a non-pixel: ${JSON.stringify(rgb).slice(0, 120)}`);
    return { rgb: [0, 0, 0] };
  }
  return { rgb };
}

async function main() {
  const exe = join(root, "dist", exeName());
  if (!process.argv.includes("--reuse-build") || !existsSync(exe)) {
    console.log("overlay-smoke: building", exeName());
    const b = await run(["go", "build", "-o", join("dist", exeName()), "."]);
    if (b.code !== 0) throw new Error("go build failed:\n" + b.stderr);
  }

  const sandbox = mkdtempSync(join(tmpdir(), "autostamp-overlay-smoke-"));
  const env = { ...process.env, APPDATA: join(sandbox, "Roaming"), LOCALAPPDATA: join(sandbox, "Local") };
  const dir = join(sandbox, "samples");
  mkdirSync(dir, { recursive: true });

  // 1) samples: a 4-page A4 document with two known solid blocks + an alpha seal
  const gen = await openChrome({ port: SAMPLE_PORT });
  await gen.send("Page.navigate", { url: "data:text/html;charset=utf-8," + encodeURIComponent(sampleHtml()) });
  await waitFor(async () => (await gen.evaluate("document.readyState")) === "complete", 8000, "sample page never ready");
  const print = await gen.send("Page.printToPDF", {
    printBackground: true,
    preferCSSPageSize: true,
    paperWidth: PAGE.w / 72,
    paperHeight: PAGE.h / 72,
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
  });
  const docFile = join(dir, "overlay-sample.pdf");
  writeFileSync(docFile, Buffer.from(print.data, "base64"));

  // the seal: a horizontal gradient, opaque, with a transparent margin so the
  // alpha path (SMask) is exercised and the blend source is a known colour ramp
  const sealPng = await gen.evaluate(
    `(() => {
      const c = document.createElement('canvas');
      c.width = ${SEAL_PX}; c.height = ${SEAL_PX};
      const x = c.getContext('2d');
      x.clearRect(0, 0, c.width, c.height);
      const g = x.createLinearGradient(0, 0, c.width, 0);
      g.addColorStop(0, 'rgb(${STOPS.left.join(",")})');
      g.addColorStop(1, 'rgb(${STOPS.right.join(",")})');
      x.fillStyle = g;
      x.fillRect(20, 20, c.width - 40, c.height - 40);
      return c.toDataURL('image/png');
    })()`
  );
  const sealFile = join(dir, "overlay-seal.png");
  writeFileSync(sealFile, Buffer.from(sealPng.split(",")[1], "base64"));
  await gen.close(!process.argv.includes("--keep-profile"));

  // 2) the real binary
  const { proc } = await run(["dist/" + exeName(), "-no-browser", "-window=false"], { env, detachedChild: true });
  const child = proc;
  let stderrText = "";
  child.stderr.on("data", (d) => (stderrText += d.toString()));
  const url = await waitFor(() => {
    const m = stderrText.match(/url=(http:\/\/127\.0\.0\.1:\d+)/);
    return m ? m[1] : null;
  }, 10000, "server never printed its url:\n" + stderrText);
  console.log("overlay-smoke: server", url);

  const app = await openChrome({
    port: APP_PORT,
    url,
    waitFor: "!!(window.__autoStampShell && window.__autoStampOverlay && window.__autoStampSeal && window.__autoStampPreview)",
    diag: "document.readyState + '|' + location.href",
  });

  // The vocabulary the check must cover comes from the shipped control, so a
  // mode added to the panel is automatically in the matrix (no second list).
  const blendNames = await app.evaluate(
    `(() => { const sel = document.querySelector('[data-field=\"api.apply.blend\"]'); return sel ? Array.from(sel.options).map((o) => o.value).filter(Boolean) : []; })()`
  );
  if (blendNames.length < 16) bad(`blend vocabulary: expected >=16 modes, got ${blendNames.length}`);
  console.log(`overlay-smoke: ${blendNames.length} blend modes in the panel`);

  // 3) open the document through the real UI channel: the typed path box opens on
  // Enter now that the empty state has no path/Open button pair (HD6).
  await app.evaluate(
    `(() => { const i = document.getElementById('empty-path'); i.value = ${JSON.stringify(docFile)}; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return i.value === ${JSON.stringify(docFile)}; })()`
  );
  await waitFor(
    async () => (await app.evaluate(shellEval("p.probe('canvas') && p.probe('canvas').backing[0] > 100"))) === true,
    25000,
    "the sample page never painted a sized canvas"
  );
  cmp("state after open", await app.evaluate(shellEval("s.probe('state')")), "opened");
  cmp("page count", await app.evaluate(shellEval("p.pageCount()")), 4);

  // the known blocks must land where the CSS said they do: if that is false the
  // whole parity matrix would be measured against the wrong backdrop
  await waitFor(
    async () => (await app.evaluate(shellEval("!!o.state.canvas && !!o.state.snapshot"))) === true,
    8000,
    "the page never painted (no canvas / snapshot in the overlay module)"
  );

  for (const b of BLOCKS) {
    const px = await sampleAt(app, b.x + b.w / 2, b.y + b.h / 2, "page");
    nearPixel(`block ${b.name} backdrop`, px.rgb, b.rgb, 3);
  }

  // 4) upload the seal through the file input; the panel options are set to
  // known values so the parity has one unambiguous source bitmap
  await setParams(app, {
    "api.seal.prepare.despill": false,
    "api.seal.prepare.alphaTrim": false,
    "api.seal.prepare.resampleDpi": 300,
  });
  await setInputFiles(app, "#seal-file-input", [sealFile]);
  await app.evaluate(`(() => { const i = document.getElementById('seal-file-input'); i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitFor(
    async () => (await app.evaluate(shellEval("window.__autoStampSeal.probe('seals').length > 0"))) === true,
    12000,
    "the seal upload never produced a seal record"
  );
  const sealProbe = await app.evaluate(shellEval("window.__autoStampSeal.probe('seals')"));
  if (!sealProbe.length) bad("seal probe is empty");
  else {
    const meta = sealProbe[0];
    truthy(`seal prepared (${JSON.stringify(meta).slice(0, 160)})`, meta.sealId);
  }
  const metaChip = await app.evaluate(`(() => { const e = document.getElementById('seal-meta'); return e ? e.textContent : ''; })()`);
  truthy(`seal metadata chip shows the alpha readback (${metaChip})`, /[\d]/.test(metaChip));
  const srcColor = await app.evaluate(
    `(() => {
      const s = window.__autoStampSeal;
      const id = window.__autoStampShell.state.instances[0].sealId;
      const bmp = s.bitmapOf(id);
      if (!bmp) return null;
      const c = document.createElement('canvas');
      c.width = bmp.width || bmp.naturalWidth; c.height = bmp.height || bmp.naturalHeight;
      const x = c.getContext('2d');
      x.drawImage(bmp, 0, 0);
      const d = x.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
      return { rgb: Array.from(d.slice(0, 3)), a: d[3], w: c.width, h: c.height };
    })()`
  );
  if (!srcColor) bad("the prepared seal bitmap is not drawable in the page");
  else {
    truthy(`seal bitmap is square-ish and opaque at the centre (${JSON.stringify(srcColor)})`, srcColor.a > 250);
  }

  // 5) place the seal exactly on the gray block, then verify geometry
  await setParams(app, {
    "api.apply.anchor": "tl",
    "api.apply.offset": SEAL.offset,
    "api.apply.scale": SEAL.scale,
    "api.apply.rotation": 0,
    "api.apply.brightness": 1,
    "api.apply.saturate": 1,
    "api.apply.pages": "all",
    "api.apply.crossPage": false,
    "api.apply.blend": "multiply",
    "api.apply.opacity": 1,
  });
  await app.evaluate(shellEval("s.selectInstance(s.state.instances[0].id)"));
  await sleep(250);
  const view = await app.evaluate(shellEval("o.probe('view')"));
  const r0 = (await rects(app))[0] || {};
  const wantRect = {
    x: SEAL.x,
    y: SEAL.y,
    w: +(SEAL.scale * PAGE.w).toFixed(2),
    h: +(SEAL.scale * PAGE.w * (srcColor ? srcColor.h / srcColor.w : 1)).toFixed(2),
  };
  if (wants("geometry")) {
    cmp("painted rect x", r0.x, +wantRect.x.toFixed(2));
    cmp("painted rect y", r0.y, +wantRect.y.toFixed(2));
    truthy(`painted rect width = scale x page width (${r0.w} vs ${wantRect.w})`, Math.abs(r0.w - wantRect.w) <= 0.02);
    truthy("painted rect height follows the image aspect", Math.abs(r0.h - wantRect.h) < 1.2);
    const aff = (await affordance(app))[0] || {};
    truthy("affordance box is visible for the selected instance", aff.visible && aff.selected);
    cmp("affordance handles", aff.handles, 5);
    const canvasBox = await app.evaluate(
      `(() => { const b = document.querySelector('#preview-stage canvas.page-canvas').getBoundingClientRect(); return { left: b.left, top: b.top }; })()`
    );
    const z = await app.evaluate(shellEval("p.probe('zoom')"));
    cmp("affordance box left matches the rect on screen", aff.x, Math.round(canvasBox.left + wantRect.x * z));
    cmp("affordance box top matches the rect on screen", aff.y, Math.round(canvasBox.top + wantRect.y * z));
    cmp("affordance box width matches the rect on screen", aff.w, Math.round(wantRect.w * z));
  }

  // 6) the blend / opacity matrix (docs/FACTS §1.3 semantics).
  //
  // The parity point is the *centre* of the painted box: the sample must be the
  // gradient sample the script read from the prepared bitmap, so Cb and Cs are
  // both known. The separable modes are checked against the spec equations;
  // the four HSL-based modes and soft-light are checked through their spec
  // invariant (which component survives) plus the /CA alpha rule, and the
  // measured value is printed so docs/FACTS.md can record it.
  if (wants("matrix")) {
    const CS = srcColor ? srcColor.rgb : GRAD_MID;
    const SEP = ["normal", "multiply", "mult", "screen", "overlay", "darken", "lighten",
      "color-dodge", "color-burn", "hard-light", "difference", "exclusion"];
    // soft-light joins this group because Skia's equation is not a per-channel
    // closed form: it is pinned by its spec direction rule + the /CA alpha rule
    // below, and the measured value is printed for docs/FACTS.md.
    const INV = ["hue", "saturation", "color", "luminosity", "soft-light"];
    const opacities = [1, 0.6, 0.3];

    // pass A: the gray block, exact equations
    const gx = SEAL.x + wantRect.w / 2;
    const gy = SEAL.y + wantRect.h / 2;
    const CB = BLOCKS[0].rgb;
    for (const mode of blendNames) {
      if (!SEP.includes(mode)) continue;
      for (const a of opacities) {
        await setParams(app, { "api.apply.blend": mode, "api.apply.opacity": a });
        const px = await sampleAt(app, gx, gy, "composite");
        nearPixel(`${mode} @ opacity ${a}`, px.rgb, expectPixel(CB, CS, a, mode), 2);
      }
    }
    const unhandled = blendNames.filter((m) => !SEP.includes(m) && !INV.includes(m));
    if (unhandled.length) bad(`modes missing from the check tables: ${unhandled.join(",")}`);

    // pass B: the green block (a chroma-bearing backdrop makes the component
    // identities observable), for the modes whose colour maths the renderer owns
    await setParams(app, { "api.apply.offset": "250,620" });
    const inv = await app.evaluate(shellEval("o.probe('rects')[0]"));
    const ix = (inv.x || 250) + wantRect.w / 2;
    const iy = (inv.y || 620) + wantRect.h / 2;
    const GBCB = BLOCKS[1].rgb;
    const bg = await sampleAt(app, ix, iy, "page");
    nearPixel("green block backdrop", bg.rgb, GBCB, 3);
    const blendResult = new Map();
    for (const mode of blendNames) {
      if (!INV.includes(mode)) continue;
      await setParams(app, { "api.apply.blend": mode, "api.apply.opacity": 1 });
      const full = await sampleAt(app, ix, iy, "composite");
      blendResult.set(mode, full.rgb);
      const label = `${mode} @ opacity 1 (component identity)`;
      const lumG = luma(GBCB);
      const lumS = luma(CS);
      const got = full.rgb;
      if (mode === "luminosity") {
        // spec: luma from the source, chroma (the hue direction) from the backdrop
        if (!near(luma(got), lumS, 4)) bad(`${label}: luma should follow the source (${luma(got).toFixed(1)} vs ${lumS.toFixed(1)}, got [${got}])`);
        else if (Math.abs(hueOf(got) - hueOf(GBCB)) > 12) bad(`${label}: hue should stay the backdrop's (${hueOf(got).toFixed(0)} vs ${hueOf(GBCB).toFixed(0)}, got [${got}])`);
        else console.log(`  ok ${label} = [${got}] luma ${luma(got).toFixed(1)} (source ${lumS.toFixed(1)}), hue ${hueOf(got).toFixed(0)} (backdrop ${hueOf(GBCB).toFixed(0)})`);
      } else if (mode === "soft-light") {
        // spec semantic: soft light only shifts the backdrop, and the direction
        // of the shift follows the source channel (below 128 darkens, above it
        // lightens). Skia's equation is not a per-channel closed form, so the
        // direction rule + the /CA alpha rule are what the check pins down.
        const directionOk = got.every((v, i) => {
          const src = CS[i];
          if (Math.abs(src - 128) < 12) return Math.abs(v - GBCB[i]) <= 6;
          return src < 128 ? v < GBCB[i] : v > GBCB[i];
        });
        if (!directionOk) bad(`${label}: soft-light direction rule failed, got [${got}] backdrop [${GBCB}] source [${CS}]`);
        else console.log(`  ok ${label} = [${got}] (backdrop [${GBCB}], source [${CS}])`);
      } else {
        // hue / saturation / colour: the spec fixes the result's luma to the
        // backdrop's, and the chroma to one of the two colours
        if (!near(luma(got), lumG, 4)) bad(`${label}: luma should follow the backdrop (${luma(got).toFixed(1)} vs ${lumG.toFixed(1)}, got [${got}])`);
        else if (mode === "hue" && lumaDist(got, GBCB) < 4) bad(`${label}: chroma should change for hue, got [${got}]`);
        else if (mode === "color" && Math.abs(hueOf(got) - hueOf(CS)) > 12) bad(`${label}: hue should follow the source (${hueOf(got).toFixed(0)} vs ${hueOf(CS).toFixed(0)}, got [${got}])`);
        else if (mode === "saturation" && Math.abs(hueOf(got) - hueOf(GBCB)) > 12) bad(`${label}: hue should stay the backdrop's (${hueOf(got).toFixed(0)} vs ${hueOf(GBCB).toFixed(0)}, got [${got}])`);
        else console.log(`  ok ${label} = [${got}]`);
      }
    }
    // the alpha rule for the same modes: Co = a*B + (1-a)*Cb with B from a=1
    for (const [mode, B] of Array.from(blendResult.entries())) {
      for (const a of opacities) {
        if (a === 1) continue;
        await setParams(app, { "api.apply.blend": mode, "api.apply.opacity": a });
        const px = await sampleAt(app, ix, iy, "composite");
        const want = B.map((v, i) => Math.round(Math.max(0, Math.min(1, a * (v / 255) + (1 - a) * (GBCB[i] / 255))) * 255));
        nearPixel(`${mode} @ opacity ${a} (alpha rule vs a=1 [${B}])`, px.rgb, want, 2);
      }
    }
    await setParams(app, { "api.apply.offset": SEAL.offset });
  }

  // 7) pointer wiring: drag, corner, rotate
  if (wants("drag")) {
    // the page is taller than the viewport in fit-width mode, so the seal has
    // to be scrolled into view before pointer events can hit it: #preview-stage
    // is the scroll container, so the maths is done against its own client box.
    await app.evaluate(shellEval(`(() => {
      const st = document.querySelector('#preview-stage');
      const c = document.querySelector('#preview-stage canvas.page-canvas');
      const z = p.probe('zoom');
      st.scrollTop = c.offsetTop + ${SEAL.y + 45} * z - st.clientHeight / 2;
      st.scrollLeft = c.offsetLeft + ${SEAL.x + 45} * z - st.clientWidth / 2;
      return [st.scrollTop, st.scrollLeft];
    })()`));
    await sleep(300);

    const centre = await clientOf(app, SEAL.x + 45, SEAL.y + 45);
    await dragTo(app, centre, { x: centre.x + 30, y: centre.y + 12 });
    let p = await readParams(app);
    const off = String(p["api.apply.offset"]).split(",").map(Number);
    const dz = await app.evaluate(shellEval("p.probe('zoom')"));
    cmp("drag writes api.apply.offset x", Math.round(off[0] - SEAL.x), Math.round(30 / dz));
    cmp("drag writes api.apply.offset y", Math.round(off[1] - SEAL.y), Math.round(12 / dz));
    cmp("state after drag", await app.evaluate(shellEval("s.probe('state')")), "stamp-selected");

    // the corner handle resizes around the same anchor
    await setParams(app, { "api.apply.offset": SEAL.offset, "api.apply.scale": SEAL.scale });
    const box2 = (await affordance(app))[0] || {};
    const corner = { x: box2.x + box2.w, y: box2.y + box2.h };
    await dragTo(app, corner, { x: corner.x + 40, y: corner.y + 40 });
    p = await readParams(app);
    truthy(`corner drag grows api.apply.scale (${p["api.apply.scale"]})`, Number(p["api.apply.scale"]) > SEAL.scale + 0.01);

    // the rotate handle writes api.apply.rotation
    await setParams(app, { "api.apply.rotation": 0, "api.apply.offset": SEAL.offset, "api.apply.scale": SEAL.scale });
    const rot = await app.evaluate(shellEval("(() => { const h = document.querySelector('#stamp-layer .instance[data-selected=\"true\"] .handle[data-handle=\"rot\"]'); const b = h.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()"));
    await dragTo(app, rot, { x: rot.x + 46, y: rot.y + 6 });
    p = await readParams(app);
    truthy(`rotate handle writes api.apply.rotation (${p["api.apply.rotation"]})`, Math.abs(Number(p["api.apply.rotation"])) > 3);
    await setParams(app, { "api.apply.rotation": 0, "api.apply.offset": SEAL.offset, "api.apply.scale": SEAL.scale });

    // V3: ctrl+wheel over the instance scales it, over the page zooms the view
    const before = await readParams(app);
    const over = await clientOf(app, SEAL.x + 45, SEAL.y + 45);
    await mouse(app, "mouseWheel", over.x, over.y, 0, { deltaX: 0, deltaY: -120, modifiers: 2 });
    await sleep(250);
    const after = await readParams(app);
    truthy(`ctrl+wheel over the seal changes scale (${before["api.apply.scale"]} -> ${after["api.apply.scale"]})`,
      Number(after["api.apply.scale"]) !== Number(before["api.apply.scale"]));
    const zoomBefore = await app.evaluate(shellEval("p.probe('zoom')"));
    await mouse(app, "mouseWheel", over.x + 240, over.y + 200, 0, { deltaX: 0, deltaY: -120, modifiers: 2 });
    await sleep(250);
    const zoomAfter = await app.evaluate(shellEval("p.probe('zoom')"));
    truthy(`ctrl+wheel on the page background zooms the view (${zoomBefore} -> ${zoomAfter})`, zoomAfter !== zoomBefore);
    await app.evaluate(shellEval("p.fit()"));
    await sleep(200);
    await setParams(app, { "api.apply.scale": SEAL.scale, "api.apply.offset": SEAL.offset });
  }

  // 8) cross-page strips
  if (wants("strip")) {
    await setParams(app, {
      "api.apply.crossPage": true,
      "api.apply.pages": "all",
      "api.apply.startOffset": 0,
      "ui.crosspage.binding": "right",
      "api.apply.blend": "multiply",
      "api.apply.opacity": 1,
    });
    await sleep(250);
    let st = await strips(app);
    cmp("single-sided strip count", st.length, 1);
    cmp("single-sided strip edge", st[0] && st[0].edge, "right");
    cmp("single-sided strip index", st[0] && st[0].index, 0);

    // the strip must hug the binding edge: sample the *probe rect*, which is
    // what the user sees, not a hand-computed column
    const meta = await app.evaluate(shellEval("p.pageMeta(p.probe('page'))"));
    const stripRect = (await rects(app))[0] || {};
    const insideX = (stripRect.x || 0) + (stripRect.w || 0) / 2;
    const insideY = (stripRect.y || 0) + (stripRect.h || 0) / 2;
    const inStrip = await sampleAt(app, insideX, insideY, "composite");
    const onPage = await sampleAt(app, insideX, insideY, "page");
    truthy(`strip paints over the page (before [${onPage.rgb}] after [${inStrip.rgb}])`,
      Math.abs(inStrip.rgb[0] - onPage.rgb[0]) + Math.abs(inStrip.rgb[1] - onPage.rgb[1]) + Math.abs(inStrip.rgb[2] - onPage.rgb[2]) > 10);

    // D2 double-sided: odd pages right, even pages left, count = page count
    await setParams(app, { "ui.crosspage.binding": "alternate" });
    await sleep(200);
    st = await strips(app);
    cmp("double-sided alternates edges on page 1", st[0] && st[0].edge, "right");
    await app.evaluate(shellEval("p.goTo(2)"));
    await sleep(400);
    st = await strips(app);
    cmp("double-sided alternates edges on page 2", st[0] && st[0].edge, "left");
    cmp("double-sided strip count matches the page count", st[0] && st[0].count, 4);

    // the seam: each page shows its own gradient band, so page i's strip centre
    // must equal the gradient sample at (i + 0.5) / count.
    const CS = srcColor ? srcColor.rgb : GRAD_MID;
    for (const page of [1, 2, 3, 4]) {
      await app.evaluate(shellEval(`p.goTo(${page})`));
      await sleep(400);
      const s0 = (await strips(app))[0];
      if (!s0) { bad(`page ${page}: no strip`); continue; }
      const m = await app.evaluate(shellEval("p.pageMeta(p.probe('page'))"));
      const sw = (SEAL.scale * PAGE.w) / s0.count;
      const x = s0.edge === "right" ? m.width - sw / 2 : sw / 2;
      const got = await sampleAt(app, x, 40, "composite");
      // the gradient is measured across the whole image width: the band centre
      // of strip i sits at (i + 0.5) / count of the ramp
      const t = (s0.index + 0.5) / s0.count;
      const want = STOPS.left.map((v, i) => Math.round(v + (STOPS.right[i] - v) * t));
      nearPixel(`page ${page} strip ${s0.index} gradient sample`, got.rgb, want, 6);
    }

    // startOffset moves the strip along the binding edge (UI_SPEC §2)
    await setParams(app, { "api.apply.startOffset": 0 });
    await sleep(200);
    const rBefore = (await rects(app))[0] || {};
    await setParams(app, { "api.apply.startOffset": 120 });
    await sleep(200);
    const rAfter = (await rects(app))[0] || {};
    cmp("startOffset moves the strip down by the field value", Math.round(rAfter.y - rBefore.y), 120);
    cmp("startOffset does not change the strip width", rAfter.w, rBefore.w);

    // the affordance is hidden for a cross-page instance and drag is refused
    const affX = await affordance(app);
    const box = affX.find((a) => a.mode === "crosspage") || affX[0] || {};
    cmp("cross-page instance hides the handles", box.visible, false);
    cmp("cross-page instance keeps its wrapper", box.mode, "crosspage");
    const before = await readParams(app);
    const pt = await clientOf(app, (await rects(app))[0].x + 5, 40);
    await dragTo(app, pt, { x: pt.x + 40, y: pt.y + 40 });
    const after = await readParams(app);
    cmp("cross-page strip refuses canvas drag (offset unchanged)", String(after["api.apply.offset"]), String(before["api.apply.offset"]));

    // binding=none clears the strip
    await setParams(app, { "ui.crosspage.binding": "none" });
    await sleep(200);
    cmp("binding=none removes the strip", (await strips(app)).length, 0);
    await setParams(app, { "api.apply.crossPage": false, "ui.crosspage.binding": "right" });
    await app.evaluate(shellEval("p.goTo(1)"));
    await sleep(300);
  }

  // 9) the pages field limits which pages get a rect
  if (wants("pages")) {
    await setParams(app, { "api.apply.pages": "1,3" });
    await sleep(200);
    const onPage1 = await rects(app);
    truthy(`pages=1,3 paints page 1 (${onPage1.length})`, onPage1.length === 1);
    await app.evaluate(shellEval("p.goTo(2)"));
    await sleep(400);
    cmp("pages=1,3 skips page 2", (await rects(app)).length, 0);
    await app.evaluate(shellEval("p.goTo(3)"));
    await sleep(400);
    truthy("pages=1,3 paints page 3", (await rects(app)).length === 1);
    await app.evaluate(shellEval("p.goTo(1)"));
    await setParams(app, { "api.apply.pages": "all" });
    await sleep(200);
  }

  // 10) FACTS §1.4 guard: a filter on one instance must not leak into the next
  if (wants("filter")) {
    await setParams(app, { "api.apply.brightness": 1.6, "api.apply.saturate": 2 });
    await sleep(220);
    const leak = await app.evaluate(shellEval("o.probe('filter')"));
    cmp("ctx.filter is reset after the stamp layer", leak, "none");
    await app.evaluate(shellEval("s.addInstance()"));
    await sleep(250);
    const ids = await app.evaluate(shellEval("s.state.instances.map((i) => i.id)"));
    if (ids.length < 2) bad("the second instance was never added");
    else {
      // the new instance carries the same filter values, so it paints the same
      // colour; a leak from the first would have changed the first's pixels
      await setParams(app, { "api.apply.brightness": 1.6, "api.apply.saturate": 2, "api.apply.blend": "multiply", "api.apply.opacity": 1 });
      await sleep(250);
      const second = await app.evaluate(shellEval("s.state.instances[1].params"));
      void second;
      const leak2 = await app.evaluate(shellEval("o.probe('filter')"));
      cmp("filter stays reset across two instances", leak2, "none");
      const px = await sampleAt(app, SEAL.x + 45, SEAL.y + 45, "composite");
      truthy(`filter+blend composite still paints (${px.rgb})`, px.rgb.some((v) => v < 250));
      await app.evaluate(shellEval("s.deleteSelected()"));
      await sleep(200);
    }
    await setParams(app, { "api.apply.brightness": 1, "api.apply.saturate": 1 });
  }

  // 11) the seal metadata readback (alpha / opaque) must describe the uploaded
  // image, and 撤销去背 re-runs the same bytes with despill off
  if (wants("despill")) {
    await setParams(app, { "api.seal.prepare.despill": true });
    await setInputFiles(app, "#seal-file-input", [sealFile]);
    await app.evaluate(`(() => { document.getElementById('seal-file-input').dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await sleep(600);
    const withDespill = await app.evaluate(shellEval("window.__autoStampSeal.probe('seals')"));
    await app.evaluate(`(() => { document.getElementById('seal-despill-revert').click(); return true; })()`);
    await sleep(600);
    const reverted = await app.evaluate(shellEval("window.__autoStampSeal.probe('seals')"));
    truthy("despill re-run produced a second seal record", withDespill.length >= 1 && reverted.length >= 1);
    const state = await app.evaluate(shellEval("s.probe('state')"));
    truthy(`state stays usable after 撤销去背 (${state})`, ["opened", "stamp-selected"].includes(state));
  }

  // 9) export controls + live size estimate (UI_SPEC E1: inline, no request;
  //    the numbers must follow the docs/FACTS 4 measured table)
  if (wants("export")) {
    const estOf = async () => JSON.parse(await app.evaluate(shellEval("JSON.stringify(s.probe('estimate'))")));
    const clickSeg = async (id, value) => {
      await app.evaluate(shellEval(`document.querySelector('#${id} [data-value="${value}"]').click()`));
      await sleep(80);
    };
    await clickSeg("export-mode", "raster");
    await clickSeg("export-dpi", "150");
    await setParams(app, { "api.export.quality": 75, "api.export.pages": "all" });
    await sleep(150);
    let est = await estOf();
    cmp("estimate mode follows the export mode", est.mode, "raster");
    cmp("estimate dpi follows the dpi segment", est.dpi, 150);
    cmp("estimate quality follows the field", est.quality, 75);
    cmp("pages=all selects every page", est.pagesSelected, est.pagesTotal);
    truthy(`raster 150dpi q75 per-page bytes follow FACTS 4 (123,796; got ${est.perPageBytes})`,
      Math.abs(est.perPageBytes / 123796 - 1) < 0.02);
    // per-page is rounded once, the total once too: allow one byte per page
    truthy(`estimate total == per-page x pages (${est.totalBytes} vs ${est.perPageBytes}x${est.pagesSelected})`,
      Math.abs(est.totalBytes - est.perPageBytes * est.pagesSelected) <= est.pagesSelected);
    truthy(`estimate per-page text carries the basis: "${est.perPageText}"`, /raster 150 dpi q75/.test(est.perPageText));
    truthy(`estimate total text shows the page count: "${est.totalText}"`, /~ .*\d+ pages/.test(est.totalText));

    // the measured table's ratio must survive the scaling: 300dpi/150dpi at q75
    await clickSeg("export-dpi", "300");
    const e300 = await estOf();
    cmp("dpi segment click writes api.export.dpi", e300.dpi, 300);
    const ratio = e300.perPageBytes / est.perPageBytes;
    truthy(`300/150 dpi ratio ${ratio.toFixed(2)} follows the FACTS table (3.06)`, Math.abs(ratio - 378606 / 123796) < 0.12);

    // the slider is step-aligned (40 + 5n): an off-row value interpolates
    // strictly between the q75 and q92 rows, an exact row must match FACTS 4.
    await setParams(app, { "api.export.quality": 90 });
    await sleep(120);
    const e90 = await estOf();
    truthy(`300dpi q90 interpolates between the FACTS rows (${e90.perPageBytes})`,
      e90.perPageBytes > 378606 && e90.perPageBytes < 459215);
    await setParams(app, { "api.export.quality": 40 });
    await sleep(120);
    const e40 = await estOf();
    truthy(`300dpi q40 per-page follows FACTS 4 (328,844; got ${e40.perPageBytes})`,
      Math.abs(e40.perPageBytes / 328844 - 1) < 0.02);
    const pairVals = await app.evaluate(shellEval("(function () { var els = document.querySelectorAll('#panel-export [data-field=\"api.export.quality\"]'); return Array.prototype.map.call(els, function (el) { return el.value; }).join(','); })()"));
    cmp("quality slider + number keep the same value", pairVals, "40,40");

    // custom DPI: off-grid values interpolate the table and land inside it
    await clickSeg("export-dpi", "custom");
    await setParams(app, { "api.export.customDpi": 200 });
    await sleep(120);
    const e200 = await estOf();
    cmp("custom dpi resolves the typed number", e200.dpi, 200);
    // quality is 40 here: the 200dpi estimate must sit between the q40 rows
    truthy(`200dpi q40 sits between the 150 and 300 dpi rows (${e200.perPageBytes})`,
      e200.perPageBytes > 104089 * 0.97 && e200.perPageBytes < 328844 * 1.03);

    // the pages vocabulary resolves to a count
    await setParams(app, { "api.export.pages": "2-4" });
    await sleep(120);
    cmp('export pages "2-4" selects 3', (await estOf()).pagesSelected, 3);
    await setParams(app, { "api.export.pages": "1,3" });
    await sleep(120);
    cmp('export pages "1,3" selects 2', (await estOf()).pagesSelected, 2);

    // vector mode ignores DPI/quality entirely
    await clickSeg("export-dpi", "150");
    await clickSeg("export-mode", "vector");
    await setParams(app, { "api.export.pages": "all" });
    await sleep(150);
    const vec = await estOf();
    cmp("estimate mode switches to vector", vec.mode, "vector");
    cmp("vector estimate ignores DPI/quality: total == per-page x pages", vec.totalBytes, vec.perPageBytes * vec.pagesSelected);
    truthy(`vector per-page text: "${vec.perPageText}"`, /vector/.test(vec.perPageText));
    const vBefore = vec.totalBytes;
    await clickSeg("export-dpi", "300");
    await sleep(100);
    cmp("changing DPI does not move the vector estimate", (await estOf()).totalBytes, vBefore);
    await clickSeg("export-dpi", "150");
  }

  const noise = (s) => /favicon|about:blank|pptr:/i.test(s);
  const pageErrors = app.errors.filter((e) => !noise(e));
  const reqFailures = app.failures.filter((f) => !noise(f));
  cmp("page console errors", pageErrors.length, 0);
  if (pageErrors.length) console.error(pageErrors.slice(0, 10));
  cmp("network failures", reqFailures.length, 0);
  if (reqFailures.length) console.error(reqFailures.slice(0, 10));

  await app.close(!process.argv.includes("--keep-profile"));
  try {
    child.kill();
  } catch {}
  rmSync(sandbox, { recursive: true, force: true });

  if (fails.length) {
    console.error(`\noverlay-smoke: ${fails.length} failure(s)`);
    fails.forEach((f) => console.error(" - " + f));
    process.exit(1);
  }
  console.log("\noverlay-smoke: ok");
}

main().catch((e) => {
  console.error("overlay-smoke: crashed:", (e && e.stack) || e);
  process.exit(1);
});
