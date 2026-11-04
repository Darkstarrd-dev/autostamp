#!/usr/bin/env node
// tools/verify/preview-smoke.mjs — P1 查看链路的端到端数值验证(AGENTS §8.9)。
//
// 与 shell-smoke.mjs 的分工:那边查壳的契约 / i18n / 状态机,这里查「真 PDF 真打开」
// 那条路径 —— 现场生成四类样本 PDF(CDP Page.printToPDF),用真 exe + 真 UI
// (空态的 #empty-path + 回车 通道打开,HD6:路径框不再配 Open 按钮),再对渲染结果做数值断言:
//   * 画布有真实像素(不是空 canvas)
//   * 文本层 span 计数(图片型必须为 0)与层框宽度 == 画布 CSS 宽(pdf.js OutputScale,FACTS §1.7)
//   * 分页条 chip 数 == 页数,chip 内缩略图各自有像素(V2 形态)
//   * 翻到第 2 页必须重新取字节(Range 请求带 session 头,否则 400 bad_session)
//   * 视口变窄改变 #preview-stage 容器宽 -> fit 重新计算(ResizeObserver)
//   * vendor 资源 0 失败、页面 console 0 error
// 口令、切分、印章落盘的断言属 P3/P4,不在此处。
//
// Usage: node tools/verify/preview-smoke.mjs [--reuse-build] [--keep-profile] [--only=en]
// Exit: 0 = pass.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openChrome, makeReport } from "./cdp.mjs";

const root = resolve(join(fileURLToPath(import.meta.url)), "..", "..", "..");
const SAMPLE_PORT = Number(process.env.PREVIEW_SMOKE_SAMPLE_PORT || 9341);
const APP_PORT = Number(process.env.PREVIEW_SMOKE_PORT || 9342);
const fails = [];
const { bad, cmp, truthy } = makeReport(fails);

function exeName() {
  return process.platform === "win32" ? "autostamp-preview-smoke.exe" : "autostamp-preview-smoke";
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
      ok({ proc: p });
      return;
    }
    p.on("close", (code) => ok({ code, stdout, stderr }));
    if (o.timeout) setTimeout(() => p.kill(), o.timeout);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// NARROW is the second contract viewport used to prove fit re-renders when the
// stage container changes width; the density control is gone, so the resize
// itself is the trigger (Emulation.setDeviceMetricsOverride via cdp.setViewport).
const NARROW = [1100, 760];

// waitFor accepts sync or async predicates (CDP probes hand back promises).
async function waitFor(fn, maxMs, msg) {
  const t0 = Date.now();
  for (;;) {
    let value = null;
    try {
        value = await fn();
    } catch {
        value = null;
    }
    if (value) return value;
    if (Date.now() - t0 > maxMs) throw new Error(msg);
    await sleep(100);
  }
}

// ---------- 样本生成:CDP Page.printToPDF(HTML -> PDF) ---------------------

async function printPdfCurrent(gen, widthPt = 595, heightPt = 842) {
  const out = await gen.send("Page.printToPDF", {
    printBackground: true,
    paperWidth: widthPt / 72,
    paperHeight: heightPt / 72,
    marginTop: 0.4,
    marginBottom: 0.4,
    marginLeft: 0.6,
    marginRight: 0.6,
    preferCSSPageSize: false,
  });
  const b64 = out.data || (out.streamId ? (await gen.send("IO.read", { handle: out.streamId, offset: 0 })).base64 : null);
  if (!b64) throw new Error("printToPDF returned neither data nor a stream: " + JSON.stringify(Object.keys(out)));
  return Buffer.from(b64, "base64");
}

async function printPdf(gen, html, widthPt, heightPt) {
  await gen.send("Page.navigate", { url: "data:text/html;charset=utf-8," + encodeURIComponent(html) });
  await waitFor(async () => (await gen.evaluate("document.readyState")) === "complete", 8000, "sample page never ready");
  return printPdfCurrent(gen, widthPt, heightPt);
}

function textHtml(pages, lang) {
  const cn = lang === "cn";
  const body = [];
  for (let i = 1; i <= pages; i++) {
    body.push(
      cn
        ? `<section style="page-break-after:always"><h1>技术服务合同书 第 ${i} 页</h1><p>甲方：北京某某科技有限公司　乙方：上海某某信息技术服务中心</p><p>依据《中华人民共和国民法典》，双方就技术服务事项达成如下条款，并共同遵守。</p><p>MARKER-${String(i).padStart(3, "0")} 中文文本层样本</p></section>`
        : `<section style="page-break-after:always"><h1>Contract body page ${i}</h1><p>Alpha Corp and Beta Ltd agree to the terms below, which shall be kept by both parties.</p><p>MARKER-${String(i).padStart(3, "0")} preview smoke sample</p></section>`
    );
  }
  return `<!doctype html><meta charset="utf-8"><title>samples</title><style>body{font:12px serif}section{height:660pt}</style>${body.join("")}`;
}

// imageOnlyPdf draws a PNG in-page (canvas -> data URL) and embeds it, so the
// PDF it produces has a raster image and not one text object.
async function imageOnlyPdf(gen, pages) {
  await gen.send("Page.navigate", { url: "about:blank" });
  await gen.evaluate(
    `(() => {
      const out = [];
      for (let i = 1; i <= ${pages}; i++) {
        const c = document.createElement('canvas');
        c.width = 900; c.height = 1200;
        const x = c.getContext('2d');
        x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
        x.fillStyle = '#111'; x.font = '64px sans-serif';
        x.fillText('page ' + i + ' scanned', 60, 120);
        for (let k = 0; k < 40; k++) { x.fillStyle = k % 2 ? '#333' : '#888'; x.fillRect(60, 200 + k * 20, 700, 12); }
        out.push('<img src="' + c.toDataURL('image/png') + '" style="width:520pt">');
        if (i < ${pages}) out.push('<div style="page-break-after:always"></div>');
      }
      document.body.innerHTML = out.join('');
      document.body.style.margin = '0';
      return true;
    })()`
  );
  await sleep(600);
  return printPdfCurrent(gen, 595, 842);
}

async function mixedPdf(gen) {
  // text + one raster image: the 混合型 case
  const png = await gen.evaluate(
    `(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 300; const x = c.getContext('2d'); x.fillStyle = '#c00'; x.fillRect(0,0,300,300); x.fillStyle = '#fff'; x.font='40px sans-serif'; x.fillText('stamp', 40, 150); return c.toDataURL('image/png'); })()`
  );
  const html = `<!doctype html><meta charset="utf-8"><p>Mixed body text MARKER-007 with an image below.</p><img src="${png}" style="width:200pt">`;
  return printPdf(gen, html, 595, 842);
}

// ---------- 每个文档的断言 -------------------------------------------------

  const PROBE_CANVAS_READY =
    "!!(window.__autoStampPreview && window.__autoStampPreview.probe('canvas') && window.__autoStampPreview.probe('canvas').backing[0] > 100)";
  // THUMB_PROBE / SECOND_PAGE_PROBE are the page-side expressions the predicate
  // waits reuse; a fixed sleep cannot tell a lazy rail apart from a blank one.
  const THUMB_PROBE =
    "Array.from(document.querySelectorAll('#page-pager canvas.pg-thumb')).map((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let ink = 0, filled = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] < 200 || d[i+1] < 200 || d[i+2] < 200) ink++; if (d[i+3] > 0) filled++; } return { page: c.dataset.page, w: c.width, h: c.height, ink, filled, pixels: d.length / 4 }; })";
  const SECOND_PAGE_PROBE =
    "(() => { const p = window.__autoStampPreview; const s = p.sample(60, 40, 480, 700); let ink = 0; for (let i = 0; i < s.data.length; i += 4) { if (s.data[i] < 200 || s.data[i+1] < 200 || s.data[i+2] < 200) ink++; } return { page: p.probe('page'), canvas: p.probe('canvas'), layer: p.probe('textLayer'), ink, frame: document.querySelector('#preview-stage .page-frame').dataset.page }; })()";

async function checkDocument(app, file, kind) {
  console.log(`\n[${kind}] ${file}`);
  const filled = await app.evaluate(
    `(() => { const i = document.getElementById('empty-path'); i.value = ${JSON.stringify(file)}; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return i.value; })()`
  );
  if (!filled) bad(`${kind}: the typed-path channel did not receive the path`);
  await waitFor(async () => (await app.evaluate(PROBE_CANVAS_READY)) === true, 25000, `${kind}: the page frame never painted a sized canvas`);
  // the text layer attaches after the paint: for a text document an empty layer
  // is a real failure, so this is a predicate rather than a fixed sleep
  if (kind !== "img") {
    try {
      await waitFor(async () => (await app.evaluate("window.__autoStampPreview.probe('textLayer').spans")) > 0, 12000, "no text layer attached to the painted page");
    } catch (e) {
      bad(`${kind}: ${e.message}`);
    }
  } else {
    await sleep(900);
  }

  const probe = await app.evaluate(
    `(() => { const p = window.__autoStampPreview, s = window.__autoStampShell; return { state: s.probe('state'), pageCount: p.pageCount(), zoom: p.probe('zoom'), fit: p.probe('fitZoom'), canvas: p.probe('canvas'), layer: p.probe('textLayer'), asset: p.probe('asset'), ruler: document.getElementById('preview-ruler').textContent, readout: document.getElementById('pixel-readout').textContent, meta: p.pageMeta(1) }; })()`
  );
  cmp(`${kind}: state`, probe.state, "opened");
  truthy(`${kind}: pageCount`, probe.pageCount >= 1);
  truthy(`${kind}: canvas css width follows the container`, probe.canvas.css[0] > 300);
  truthy(`${kind}: backing store uses the device ratio`, probe.canvas.backing[0] >= probe.canvas.css[0]);
  truthy(`${kind}: effective zoom is reported (fit mode)`, probe.zoom > 0.05);
  truthy(`${kind}: fit-zoom matches the effective zoom`, probe.fit > 0.5 && Math.abs(probe.fit - probe.zoom) < 0.01);
  truthy(`${kind}: ruler shows the pt page size`, /\d{3}\.\d . 8\d\d\.\d pt/.test(probe.ruler));
  truthy(`${kind}: readout shows px + scale`, /\d+ . \d+ px . scale \d\.\d+/.test(probe.readout));
  truthy(`${kind}: server page meta size`, probe.meta && probe.meta.width > 400 && probe.meta.height > 700);
  const frame = await app.evaluate(
    `(() => { const s = getComputedStyle(document.querySelector(".page-frame")), st = getComputedStyle(document.getElementById("preview-stage")); return { radius: s.borderTopLeftRadius, padding: st.paddingLeft }; })()`
  );
  truthy(`${kind}: page frames keep square corners (HD7)`, frame.radius === "0px");
  truthy(`${kind}: the stage has no padding (HD7)`, frame.padding === "0px");
  console.log(`  ok ${kind}: page frame ${frame.radius} / stage padding ${frame.padding} (HD7)`);

  const pagePixels = await app.evaluate(
    `(() => { const p = window.__autoStampPreview; const s = p.sample(60, 40, 480, 700); let white = 0, ink = 0; for (let i = 0; i < s.data.length; i += 4) { if (s.data[i] > 235 && s.data[i+1] > 235 && s.data[i+2] > 235) white++; else ink++; } return { ink, white }; })()`
  );
  truthy(`${kind}: the page painted real pixels`, pagePixels.ink > 200);
  console.log(`  ok ${kind}: page pixels ink=${pagePixels.ink} white=${pagePixels.white}`);

  // getTextContent on the live page object proves the text layer came from the
  // same bytes the canvas painted, and that the marker text survived extraction.
  const extracted = await app.evaluate(
    "window.__autoStampPreview.getPage(1).then((d) => d.getTextContent()).then((c) => c.items.map((i) => i.str).join(' '))",
    true
  );
  if (kind === "img") {
    cmp(`${kind}: no text layer for an image-only page`, probe.layer.spans, 0);
    cmp(`${kind}: no extracted text at all`, String(extracted).trim(), "");
  } else {
    truthy(`${kind}: text layer spans`, probe.layer.spans >= 1);
    if (!/MARKER-00\d/.test(String(extracted))) bad(`${kind}: getTextContent lost the marker: ${JSON.stringify(String(extracted).slice(0, 120))}`);
    else console.log(`  ok ${kind}: getTextContent keeps the marker (${String(extracted).replace(/\s+/g, " ").slice(0, 66)})`);
    // the layer must line up with the canvas it overlays (OutputScale, FACTS §1.7)
    const drift = Math.abs(probe.layer.box[0] - probe.canvas.css[0]);
    if (drift > 3) bad(`${kind}: text layer width ${probe.layer.box[0]} vs canvas css ${probe.canvas.css[0]} (drift ${drift})`);
    else console.log(`  ok ${kind}: text layer aligns with the canvas (${probe.layer.box[0]}px, drift ${drift}, spans ${probe.layer.spans})`);
  }

  // the rail: one chip per page + a thumbnail that carries its own pixels
  const chipPages = await app.evaluate(
    `(() => { document.getElementById('page-pager').scrollIntoView({ block: 'center' }); return [...document.querySelectorAll('#page-pager button.chip[data-page]')].map((b) => b.dataset.page); })()`
  );
  cmp(`${kind}: pager chip count`, chipPages.length, probe.pageCount);
  // thumbnails are lazy and serial, so the check is a predicate, not a sleep.
  // "painted" means alpha over the whole canvas (renderThumb fills white): at
  // 40x56 a text page's glyphs are sub-pixel, so ink is printed, not asserted
  // (FACTS §1.7).
  let lastSnap = [];
  try {
    await waitFor(async () => {
      lastSnap = await app.evaluate(THUMB_PROBE);
      return lastSnap.length === probe.pageCount && lastSnap.every((x) => x.page && x.filled === x.pixels);
    }, 15000, "thumbnails never finished painting");
  } catch (e) {
    bad(`${kind}: ${e.message}: ${JSON.stringify(lastSnap.slice(0, 3))}`);
  }
  const thumbs = lastSnap;
  cmp(`${kind}: thumbnail canvas count`, thumbs.length, probe.pageCount);
  if (thumbs.length !== probe.pageCount) bad(`${kind}: no thumbnails in the rail`);
  else if (thumbs.some((x) => !x.page || x.filled !== x.pixels)) bad(`${kind}: thumbnails that never painted: ${JSON.stringify(thumbs.slice(0, 3))}`);
  else console.log(`  ok ${kind}: thumbnails painted ${thumbs.map((x) => `${x.page}:ink${x.ink}/alpha${x.filled}`).join(" ")}`);

  // page 2: the Range request has to carry the owner token
  if (probe.pageCount >= 2) {
    await app.evaluate("window.__autoStampPreview.goTo(2)");
    let second = {};
    try {
      await waitFor(async () => {
        second = await app.evaluate(SECOND_PAGE_PROBE);
        return second.page === 2 && second.ink > 100;
      }, 12000, "page 2 never painted");
    } catch (e) {
      bad(`${kind}: ${e.message}: ${JSON.stringify(second).slice(0, 160)}`);
    }
    cmp(`${kind}: page after goTo(2)`, second.page, 2);
    cmp(`${kind}: frame dataset follows the page`, second.frame, "2");
    truthy(`${kind}: page 2 has pixels`, second.ink > 100);
    truthy(`${kind}: page 2 canvas painted`, second.canvas.backing[0] > 100);
    if (kind === "img") cmp(`${kind}: page 2 stays text-free`, second.layer.spans, 0);
  }

  // the stage container is what fit mode fits into: a narrower viewport has to
  // re-fit and repaint the page (ResizeObserver), not just restate a stale scale.
  const beforeFit = await app.evaluate(
    `(() => ({ zoom: window.__autoStampPreview.probe('zoom'), stage: Math.round(document.querySelector('#preview-stage').getBoundingClientRect().width) }))()`
  );
  await app.setViewport(NARROW[0], NARROW[1]);
  let after = {};
  try {
    after = await waitFor(async () => {
      const s = await app.evaluate(
        `(() => ({ zoom: window.__autoStampPreview.probe('zoom'), stage: Math.round(document.querySelector('#preview-stage').getBoundingClientRect().width), canvas: window.__autoStampPreview.probe('canvas') }))()`
      );
      return s.stage !== beforeFit.stage && Math.abs(s.zoom - beforeFit.zoom) > 0.02 ? s : null;
    }, 8000, `fit never re-rendered after a ${NARROW[0]}x${NARROW[1]} viewport`);
  } catch (e) {
    bad(`${kind}: ${e.message} (stage ${beforeFit.stage} -> ${JSON.stringify(after).slice(0, 120)})`);
  }
  if (after && after.canvas) {
    console.log(`  ok ${kind}: fit ${Number(beforeFit.zoom).toFixed(3)} -> ${Number(after.zoom).toFixed(3)} after the ${NARROW[0]}x${NARROW[1]} viewport (stage ${beforeFit.stage}px -> ${after.stage}px)`);
    truthy(`${kind}: re-rendered canvas`, after.canvas.backing[0] > 100);
  }
  await app.send("Emulation.clearDeviceMetricsOverride");
  await sleep(1200);
}

// ---------- 主流程 --------------------------------------------------------

async function main() {
  const exe = join(root, "dist", exeName());
  if (!process.argv.includes("--reuse-build") || !existsSync(exe)) {
    console.log("preview-smoke: building", exeName());
    const b = await run(["go", "build", "-o", join("dist", exeName()), "."]);
    if (b.code !== 0) throw new Error("go build failed:\n" + b.stderr);
  }

  const sandbox = mkdtempSync(join(tmpdir(), "autostamp-preview-smoke-"));
  const env = { ...process.env, APPDATA: join(sandbox, "Roaming"), LOCALAPPDATA: join(sandbox, "Local") };
  const sampleDir = join(sandbox, "samples");
  mkdirSync(sampleDir, { recursive: true });

  // 1) samples: four document kinds, produced on the fly (nothing committed)
  const gen = await openChrome({ port: SAMPLE_PORT });
  const files = {};
  files.en = join(sampleDir, "text-en.pdf");
  writeFileSync(files.en, await printPdf(gen, textHtml(5, "en"), 595, 842));
  files.cn = join(sampleDir, "text-cn.pdf");
  writeFileSync(files.cn, await printPdf(gen, textHtml(4, "cn"), 595, 842));
  files.mix = join(sampleDir, "mixed.pdf");
  writeFileSync(files.mix, await mixedPdf(gen));
  files.img = join(sampleDir, "image-only.pdf");
  writeFileSync(files.img, await imageOnlyPdf(gen, 3));
  await gen.close(!process.argv.includes("--keep-profile"));
  for (const [k, f] of Object.entries(files)) {
    const size = existsSync(f) ? statSync(f).size : 0;
    if (size < 900) bad(`sample ${k} is too small: ${size}`);
    else console.log(`sample ${k}: ${size} bytes`);
  }

  // 2) the real binary, sandboxed settings/session directories
  const { proc } = await run(["dist/" + exeName(), "-no-browser", "-window=false"], { env, detachedChild: true });
  const child = proc;
  let stderrText = "";
  child.stderr.on("data", (d) => (stderrText += d.toString()));
  const url = await waitFor(() => {
    const m = stderrText.match(/url=(http:\/\/127\.0\.0\.1:\d+)/);
    return m ? m[1] : null;
  }, 10000, "server never printed its url:\n" + stderrText);
  console.log("preview-smoke: server", url);

  const app = await openChrome({
    port: APP_PORT,
    url,
    waitFor: "!!(window.__autoStampShell && window.__autoStampShell.STATES && window.__autoStampPreview)",
    diag: "document.readyState + '|' + location.href",
  });

  const only = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);
  const docs = [
    ["en", files.en],
    ["cn", files.cn],
    ["mix", files.mix],
    ["img", files.img],
  ].filter(([k]) => !only || k === only);

  for (const [kind, file] of docs) {
    await checkDocument(app, file, kind);
    await app.evaluate("window.__autoStampPreview.close()");
    await sleep(400);
  }

  // 3) the session boundary the pdf.js transport depends on: a bare fetch is
  // refused, the owner token gets bytes, and Range still works (FACTS §1.1).
  // The token is the page's own; the requests run from Node so that the
  // deliberately-refused fetch does not register as a page console/network
  // failure (the counters below would then blame the app for our own probe).
  const tok = await app.evaluate("sessionStorage.getItem('autostamp.session')");
  const jsonHdr = { "content-type": "application/json", "X-AutoStamp-Session": tok };
  const pickRes = await fetch(url + "/api/fs/pick", { method: "POST", headers: jsonHdr, body: JSON.stringify({ filePath: files.en }) }).then((r) => r.json());
  const grant = (((pickRes.data || {}).picks || [])[0] || {}).pathGrantId;
  const openRes = await fetch(url + "/api/pdf/open", { method: "POST", headers: jsonHdr, body: JSON.stringify({ pathGrantId: grant }) }).then((r) => r.json());
  const assetId = (openRes.data || {}).assetId;
  let auth;
  if (!assetId) {
    auth = { pick: pickRes, open: openRes };
  } else {
    const bare = await fetch(url + "/api/pdf/raw?id=" + assetId).then((r) => r.status);
    const withHeader = await fetch(url + "/api/pdf/raw?id=" + assetId, { headers: { "X-AutoStamp-Session": tok } })
      .then((r) => r.arrayBuffer().then((b) => ({ status: r.status, bytes: b.byteLength, type: r.headers.get("content-type") })));
    const ranged = await fetch(url + "/api/pdf/raw?id=" + assetId, { headers: { "X-AutoStamp-Session": tok, Range: "bytes=0-63" } })
      .then((r) => r.arrayBuffer().then((b) => ({ status: r.status, bytes: b.byteLength })));
    auth = { bare, withHeader, ranged };
  }
  if (!auth || auth.bare === undefined) {
    bad("session boundary probe never opened a document: " + JSON.stringify(auth).slice(0, 300));
  } else {
    cmp("raw without the session header is refused", auth.bare, 400);
    cmp("raw with the session header answers 200", auth.withHeader.status, 200);
    cmp("raw content type", auth.withHeader.type, "application/pdf");
    truthy("raw body non-empty", auth.withHeader.bytes > 900);
    cmp("Range request is honoured", auth.ranged.status, 206);
    cmp("Range body length", auth.ranged.bytes, 64);
  }

  const errNoise = (s) => /about:blank|pptr:|favicon/.test(s);
  const reqNoise = (s) => /favicon/.test(s);
  const pageErrors = app.errors.filter((e) => !errNoise(e));
  const reqFailures = app.failures.filter((f) => !reqNoise(f));
  cmp("page console errors", pageErrors.length, 0);
  if (pageErrors.length) console.error(pageErrors.slice(0, 8));
  cmp("network failures / 4xx-5xx", reqFailures.length, 0);
  if (reqFailures.length) console.error(reqFailures.slice(0, 8));

  await app.close(!process.argv.includes("--keep-profile"));
  try {
    child.kill();
  } catch {}
  rmSync(sandbox, { recursive: true, force: true });

  if (fails.length) {
    console.error(`\npreview-smoke: ${fails.length} failure(s)`);
    fails.forEach((f) => console.error(" - " + f));
    process.exit(1);
  }
  console.log("\npreview-smoke: ok");
}

main().catch((e) => {
  console.error("preview-smoke: crashed:", (e && e.stack) || e);
  process.exit(1);
});
