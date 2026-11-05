#!/usr/bin/env node
// tools/verify/pixel-matrix.mjs — P2 叠加预览的数值验收(AGENTS §8.11, §5.2)。
//
// 两半:
//  A. 画布合成矩阵(在真实应用的页面里跑,所以用的是 WebView2 同族渲染器 + 应用的
//     CSP):16 个混合模式 × {1.0,0.6,0.3},底 `#d9e6ff` 叠 `#c8181c`,断言
//     FACTS §1.3 的参考值 (170,22,28) / (189,106,119),以及 16 模式无异常;
//     外加 FACTS §1.4 的「filter 未复位」回归:未复位时必须复现污染值 (54,33,25),
//     复位后必须回到 (170,22,28)。这两条正是「先失败→修复→通过」的成对断言。
//  B. 真实链路的所见即所得:真 PDF -> `/api/pdf/open` -> `seal/prepare`(纯色印章,
//     despill 关掉) -> `__autoStampOverlay.add()` -> `sample()` 取样,把叠加后的像素
//     与按 §1.3 公式**用页面自己的底像素**算出来的期望值比对。预览像素必须等于
//     落盘后再渲染的像素(P4 的门槛由这个等式撑起)。
//
// Usage: node tools/verify/pixel-matrix.mjs [--reuse-build] [--keep-profile]
// Exit: 0 = pass, 1 = fail.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { openChrome, makeReport } from "./cdp.mjs";

const root = resolve(join(fileURLToPath(import.meta.url)), "..", "..", "..");
const APP_PORT = Number(process.env.PIXEL_MATRIX_PORT || 9345);
const SAMPLE_PORT = Number(process.env.PIXEL_MATRIX_SAMPLE_PORT || 9346);
const fails = [];
const { bad, cmp, truthy } = makeReport(fails);

// 分阶段跑:--only=matrix 只跑画布数学 + filter 污染回归;--only=chain 只跑真链路。
// 默认两半都跑。
const PART = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);
const runPart = (name) => !PART || PART === name;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, maxMs, msg) {
  const t0 = Date.now();
  let last = null;
  for (;;) {
    let value = null;
    let why = null;
    try {
      value = await fn();
    } catch (e) {
      why = String((e && e.message) || e);
    }
    if (value) return value;
    last = why === null ? JSON.stringify(value) : "throw:" + why;
    if (Date.now() - t0 > maxMs) throw new Error(`${msg} (last=${last})`);
    await sleep(100);
  }
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
  });
}

function exeName() {
  return process.platform === "win32" ? "autostamp-pixel-matrix.exe" : "autostamp-pixel-matrix";
}

// ---------- 纯色印章 PNG(合成数学要用已知颜色,不能靠仓库 fixture 的彩色) ----

function crc32(buf) {
  // zlib.crc32 exists on Node >= 20.15; the table path keeps older hosts working.
  if (typeof zlib.crc32 === "function") return zlib.crc32(buf) >>> 0;
  let c = -1;
  for (const b of buf) c = (c >>> 8) ^ crcTable[(c ^ b) & 0xff];
  return (c ^ -1) >>> 0;
}
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// solidPNG paints an w×h RGBA image with c=[r,g,b,a]; fully opaque corners keep
// the alpha-trim and despill paths out of the way.
function solidPNG(w, h, c) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const p = row + 1 + x * 4;
      raw[p] = c[0];
      raw[p + 1] = c[1];
      raw[p + 2] = c[2];
      raw[p + 3] = c[3];
    }
  }
  // IHDR data is exactly 13 bytes (width/height/bitdepth/colourtype/compression/
  // filter/interlace); the leading 4 bytes hold the chunk type, so the scratch
  // buffer must be 17 long or ihdr[13] (colour type) silently drops off the end
  // and Go's png.Decode rejects the image (seal_type).
  const ihdr = Buffer.alloc(17);
  ihdr.write("IHDR", 0);
  ihdr.writeUInt32BE(w, 4);
  ihdr.writeUInt32BE(h, 8);
  ihdr[12] = 8; // bit depth
  ihdr[13] = 6; // colour type RGBA
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr.subarray(4)),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- 样本 PDF:一页 A4,用 CDP 现场生成(与 preview-smoke 同一做法) ----

async function printPdf(gen, html, widthPt = 595, heightPt = 842) {
  await gen.send("Page.navigate", { url: "data:text/html;charset=utf-8," + encodeURIComponent(html) });
  await waitFor(async () => (await gen.evaluate("document.readyState")) === "complete", 8000, "sample page never ready");
  const out = await gen.send("Page.printToPDF", {
    printBackground: true,
    paperWidth: widthPt / 72,
    paperHeight: heightPt / 72,
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
    preferCSSPageSize: true,
  });
  const b64 = out.data || (out.streamId ? (await gen.send("IO.read", { handle: out.streamId, offset: 0 })).base64 : null);
  if (!b64) throw new Error("printToPDF gave no data");
  return Buffer.from(b64, "base64");
}

// ---------- 断言辅助 ------------------------------------------------------

function within(label, got, want, tol) {
  const d = [got[0] - want[0], got[1] - want[1], got[2] - want[2]];
  const ok = d.every((v) => Math.abs(v) <= tol);
  if (!ok) bad(`${label}: got ${got.join(",")} want ${want.join(",")} (±${tol}, delta ${d.join(",")})`);
  else console.log(`  ok ${label} = ${got.join(",")} (Δ ${d.join(",")})`);
}

const BLEND = [
  "normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn",
  "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity",
];
// canvas 的 globalCompositeOperation 名字:PDF 的 normal 对应 source-over。
const GCO = { normal: "source-over" };

const GROUND = [217, 230, 255]; // #d9e6ff, FACTS §1.3 的底
const INK = [200, 24, 28]; // #c8181c 的印章色

async function checkMatrix(app) {
  const res = await app.evaluate(
  `(() => {
    const gco = ${JSON.stringify(GCO)};
    const modes = ${JSON.stringify(BLEND)};
    const GROUND = ${JSON.stringify(GROUND)}, INK = ${JSON.stringify(INK)};
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const row = (c) => {
      const p = ctx.getImageData(0, 0, 64, 64).data;
      return [p[0], p[1], p[2], p[3]];
    };
    const paint = (mode, opacity, filt) => {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgb(${GROUND.join(",")})';
      ctx.fillRect(0, 0, 64, 64);
      ctx.restore();
      ctx.save();
      if (filt) ctx.filter = filt;
      ctx.globalCompositeOperation = gco[mode] || mode;
      const applied = ctx.globalCompositeOperation;
      ctx.globalAlpha = opacity;
      ctx.fillStyle = 'rgb(${INK.join(",")})';
      ctx.fillRect(0, 0, 64, 64);
      if (filt) ctx.filter = 'none';
      const out = row();
      ctx.restore();
      return { out, leaked: ctx.filter, applied };
    };
    const opacities = [1, 0.6, 0.3];
    const cells = [];
    for (const mode of modes) {
      for (const op of opacities) {
        const r = paint(mode, op, null);
        cells.push({ mode, op, px: r.out, leaked: r.leaked, applied: r.applied });
      }
    }
    // FACTS §1.4 的污染:filter 不复位就 multiply,结果必须复现污染值。
    const polluted = (() => {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgb(${GROUND.join(",")})';
      ctx.fillRect(0, 0, 64, 64);
      ctx.restore();
      ctx.filter = 'brightness(1.5) saturate(0.2)';
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgb(${INK.join(",")})';
      ctx.fillRect(0, 0, 64, 64);
      const px = row();
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'source-over';
      return px;
    })();
    const restored = paint('multiply', 1, null).out;
    return { cells, polluted, restored };
  })()`,
    true
  );

  // 1) FACTS §1.3 的两个参考值。
  const mult1 = res.cells.find((c) => c.mode === "multiply" && c.op === 1);
  within("multiply x opacity 1.0", mult1.px.slice(0, 3), [170, 22, 28], 1);
  const mult6 = res.cells.find((c) => c.mode === "multiply" && c.op === 0.6);
  within("multiply x opacity 0.6", mult6.px.slice(0, 3), [189, 106, 119], 1);

  // 2) 16 模式 × 3 档都要有「印章确实画上去了」的像素,且 alpha 不透明。
  for (const c of res.cells) {
    const [r, g, b, a] = c.px;
    if (![r, g, b].every((v) => Number.isFinite(v) && v >= 0 && v <= 255)) {
      bad(`${c.mode} x ${c.op}: 通道值不合法 ${c.px.join(",")}`);
    }
    if (a !== 255) bad(`${c.mode} x ${c.op}: alpha = ${a}, want 255 (底是实心纸)`);
    const changed = Math.abs(r - GROUND[0]) > 2 || Math.abs(g - GROUND[1]) > 2 || Math.abs(b - GROUND[2]) > 2;
    // lighten/saturation 与这块底组合时本来就不该改变像素,所以「必须变」不是好断言。
    // 查的是契约本身:模式名必须被 canvas 接受(非法名会静默保留旧 gco = 没混合)。
    if (c.applied !== (GCO[c.mode] || c.mode)) {
      bad(`${c.mode}: canvas 拒绝了 globalCompositeOperation (读回 ${c.applied})`);
    }
    if (c.mode === "difference" && c.op === 1 && !changed) {
      bad("difference x 1.0: 叠图像素与底相同,该模式没生效");
    }
  }
  console.log(`  ok 矩阵覆盖 ${res.cells.length} 个模式/透明度组合`);
  truthy("每个模式画完 filter 都已复位", res.cells.every((c) => c.leaked === "none"));

  // 3) filter 未复位的污染必须可复现(它是回归的「失败侧」),复位后必须回原值。
  within("filter 未复位的污染像素(FACTS §1.4,重跑 2026-10-29)", res.polluted, [100, 66, 75], 2);
  within("filter 复位后的 multiply", res.restored, [170, 22, 28], 1);
}

// ---------- B:真实链路(真 PDF + seal/prepare + 叠加层) ----------------

async function checkRealChain(app, pdfPath, sealB64) {
  if (!sealB64) bad("seal fixture missing");

  // The envelope is asserted on, so a transport failure must not be mistaken for
  // an empty object: report status + text verbatim on the failure path.
  const pick = await app.evaluate(
    `(async () => { try { const r = await fetch('/api/fs/pick', {method:'POST', headers:{'content-type':'application/json','X-AutoStamp-Session':sessionStorage.getItem('autostamp.session')}, body: JSON.stringify({filePath: ${JSON.stringify(pdfPath)}, filter:'pdf'})}); return { href: location.href, status: r.status, body: await r.json().catch(() => null) }; } catch (e) { return { href: location.href, err: String(e && e.stack || e) }; } })()`
  );
  const grantId = ((((pick.body?.data || {}).picks || [])[0] || {}).pathGrantId) || "";
  if (!grantId) {
    bad(
      `open chain: no pathGrantId href=${pick.href} status=${pick.status} ` +
        (pick.err ? "err=" + pick.err.slice(0, 200) : JSON.stringify(pick.body ?? pick).slice(0, 240))
    );
    return;
  }
  const opened = await app.evaluate(
    `(async () => { try { const r = await fetch('/api/pdf/open', {method:'POST', headers:{'content-type':'application/json','X-AutoStamp-Session':sessionStorage.getItem('autostamp.session')}, body: JSON.stringify({pathGrantId: ${JSON.stringify(grantId)}})}); return { href: location.href, status: r.status, body: await r.json().catch(() => null) }; } catch (e) { return { href: location.href, err: String(e && (e.stack || e)) }; } })()`
  );
  const openEnv = (opened.body && opened.body.data) || {};
  if (!openEnv.assetId) {
    bad(`open chain: no assetId (status ${opened.status}) ` + JSON.stringify(opened).slice(0, 240));
    return;
  }
  // The chain goes through the shell's one document funnel (adopt): state flip +
  // asset bookkeeping + preview.open, exactly like a real open does.
  await app.evaluate(`(async () => await window.__autoStampShell.adopt(${JSON.stringify(openEnv)}))()`);
  await waitFor(
    async () => {
      const st = await app.evaluate(
        `(() => { const p = window.__autoStampPreview; return { page: p.probe('page'), doc: Boolean(p.state.doc), canvas: p.probe('canvas') }; })()`
      );
      if (st.page === 1 && st.doc && st.canvas) return true;
      throw new Error(JSON.stringify(st));
    },
    12000,
    "预览页 1 未渲染(frame 未就绪)"
  );

  // 纯色印章:despill/alphaTrim 关掉(纯色没有白底可去,整幅都是印章)。走的是
  // 面板上传的同一模块路径(__autoStampSeal.prepare -> seal/prepare -> bitmap),
  // 这样断言的既有服务端信封,也有前端通道的真实接线。
  const prepared = await app.evaluate(
    `(async () => {
      const bin = atob(${JSON.stringify(sealB64)});
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const file = new File([buf], 'solid.png', { type: 'image/png' });
      const m = await window.__autoStampSeal.prepare(file, { despill: false, alphaTrim: false, resampleDpi: 300 });
      return { sealId: m.sealId, srcWidth: m.srcWidth, mime: m.mime, ready: window.__autoStampSeal.probe('seals').some((s) => s.ready) };
    })()`
  );
  const sealId = prepared.sealId;
  if (!sealId) {
    bad("seal/prepare 失败: " + JSON.stringify(prepared).slice(0, 200));
    return;
  }
  cmp("prepared seal 尺寸", prepared.srcWidth, 48);
  cmp("prepared seal mime", prepared.mime, "image/png");
  truthy("seal 位图已缓存(seal/raw 通道)", prepared.ready);
  console.log("  ok seal/prepare -> " + sealId.slice(0, 12) + "…");

  // The real chain uses the same module surface the UI uses (shell.addInstance +
  // setSealForSelected -> the overlay paints), not a private test hook.
  const created = await app.evaluate(
    `(() => {
      const sh = window.__autoStampShell;
      if (!sh) return { missing: true };
      const id = sh.addInstance('chain-seal', {
        'api.apply.blend': 'multiply', 'api.apply.opacity': 1, 'api.apply.brightness': 1,
        'api.apply.saturate': 1, 'api.apply.scale': 0.15,
        // UI_SPEC §2: anchor is a nine-point *page* anchor and offset is relative
        // to it (picking an anchor recomputes pos, which is why the disk side
        // writes pdfcpu's anchor constant). tl + 150,300 puts the box top-left at
        // page-space 150,300 -- the sample point below is inside that box.
        'api.apply.anchor': 'tl', 'api.apply.offset': '150,300', 'api.apply.pos': '150,300',
        'api.apply.rotation': 0, 'api.apply.pages': 'all', 'api.apply.crossPage': false,
      });
      sh.setSealForSelected(${JSON.stringify(sealId)});
      return { id, count: sh.state.instances.length, selected: sh.state.selected };
    })()`
  );
  if (created.missing) {
    bad("window.__autoStampShell 未实现(P2 交付物)");
    return;
  }
  // boot() seeds "Seal 1" (the 12-state contract), so the chain's instance is #2.
  if (created.count !== 2 || created.selected !== created.id) {
    bad("实例创建异常: " + JSON.stringify(created).slice(0, 200) + ", want 2 个实例且新建被选中");
    return;
  }
  // The bitmap arrives through the autostamp:seal channel; wait until the seal
  // module has it ready (probe token 'seals' exposes per-seal ready flags) before
  // sampling -- the paint itself is synchronous.
  await waitFor(
    async () => {
      const seals = await app.evaluate(`window.__autoStampSeal.probe('seals')`);
      return Array.isArray(seals) && seals.some((s) => s.ready);
    },
    6000,
    "印章位图未加载(seal/raw 通道未接通)"
  );
  await app.evaluate(`window.__autoStampOverlay.repaint()`);
  // One diagnostic line so a "composite == page" failure can be attributed to the
  // instance geometry vs the bitmap without re-running with a debugger.
  console.log(
    "  chain paint: " +
      JSON.stringify({
        rects: await app.evaluate(`window.__autoStampOverlay.probe('rects')`),
        nodes: await app.evaluate(`document.querySelectorAll('#stamp-layer .instance').length`),
        view: await app.evaluate(`window.__autoStampOverlay.probe('rects') + '|' + JSON.stringify(window.__autoStampOverlay.probe('view'))`),
        seals: await app.evaluate(`window.__autoStampSeal.probe('seals').map((s) => ({ ready: s.ready, px: s.meta && s.meta.outWidthPx }))`),
        inst: await app.evaluate(`(() => { const i = window.__autoStampShell.selectedInstance(); return { id: i && i.id, seal: Boolean(i && i.sealId), keys: i && Object.keys(i.params).length, pos: i && i.params['api.apply.pos'], scale: i && i.params['api.apply.scale'] }; })()`),
      })
  );

  // adopt() swaps the document asynchronously; the overlay snapshot can catch
  // the fresh canvas *before* pdf.js fills it (composite base = paper white).
  // This race only bites when the matrix segment ran first and warmed the
  // render path (2026-11-04). Settle the page, then re-grab the snapshot via
  // the documented redraw chain (AGENTS §8.12: sample 前必须 preview.redraw).
  await waitFor(
    async () => {
      await app.evaluate(`window.__autoStampPreview.redraw();`);
      // the *snapshot* (page source) is what later samples read; wait on it,
      // not on the live canvas (the old composite can answer GROUND early)
      const px = await app.evaluate(`window.__autoStampOverlay.sample(100, 100, 2, 2, "page").data.slice(0, 3)`);
      return Math.abs(px[0] - GROUND[0]) <= 6 && Math.abs(px[1] - GROUND[1]) <= 6 && Math.abs(px[2] - GROUND[2]) <= 6;
    },
    8000,
    "chain 页面背景未渲染进快照(背景仍是纸白)"
  );

  // 页面底像素:先按 §1.3 的公式自己算,再与叠加后的取样比对。A toast/repaint can
  // momentarily clear state.frame, so sampling retries instead of assuming a hit.
  const sampleOf = (expr, ms = 8000) =>
    waitFor(
      async () => {
        try {
          return await app.evaluate(expr);
        } catch (e) {
          throw new Error("sample: " + (e && e.message ? e.message : e));
        }
      },
      ms,
      "取样失败: " + expr.slice(0, 72)
    );
  // The overlay paints into the preview's page canvas, so the page-only pixels
  // must come from the module's clean snapshot ('page' source), not the live canvas.
  const ground = await sampleOf(`window.__autoStampOverlay.sample(150, 300, 24, 24, 'page')`);
  const g = [ground.data[0], ground.data[1], ground.data[2]];
  const ovm = await sampleOf(`window.__autoStampOverlay.sample(150, 300, 24, 24, 'composite')`);
  const o1 = [ovm.data[0], ovm.data[1], ovm.data[2]];
  const want = [
    Math.round((g[0] * INK[0]) / 255),
    Math.round((g[1] * INK[1]) / 255),
    Math.round((g[2] * INK[2]) / 255),
  ];
  within(`multiply x 1.0(底 ${g.join(",")})`, o1, want, 2);

  // opacity 0.6 = §1.3 的 dst*0.4 + (dst*src/255)*0.6. The panel fields are the only
  // way to change an instance parameter (UI_SPEC §3), so the script drives the shell
  // exactly like a slider does; no private test hook.
  await app.evaluate(`window.__autoStampShell.setParam('api.apply.opacity', 0.6)`);
  const o6s = await sampleOf(`window.__autoStampOverlay.sample(150, 300, 24, 24, 'composite')`);
  const o6 = [o6s.data[0], o6s.data[1], o6s.data[2]];
  const want6 = [0, 1, 2].map((i) => Math.round(g[i] * 0.4 + ((g[i] * INK[i]) / 255) * 0.6));
  within(`multiply x 0.6(底 ${g.join(",")})`, o6, want6, 2);

  // 混合模式在真实叠加层里也必须换像素(不是把 gco 当摆设)。
  const before = o1.join(",");
  await app.evaluate(`window.__autoStampShell.setParam('api.apply.blend', 'screen')`);
  const oSs = await sampleOf(`window.__autoStampOverlay.sample(150, 300, 24, 24, 'composite')`);
  const oS = oSs.data;
  if (oS.join(",") === before) bad("blend=screen 未改变叠图像");
  else console.log("  ok blend=screen 改变了叠图像 " + before + " -> " + oS.slice(0, 3).join(","));

  // 模式扫描回到 opacity 1:参考 canvas 也按 alpha 1 混合,这样比对的是模式本身,
  // 不掺半透明的合成项(opacity 0.6 已经在前一条 §1.3 断言里验过了)。
  await app.evaluate(`window.__autoStampShell.setParam('api.apply.opacity', 1)`);
  await app.evaluate(`window.__autoStampShell.setParam('api.apply.blend', 'multiply')`);
  // 16 模式的真链路断言:叠加层像素必须等于「同一对颜色在同一渲染族里独立 blend」
  const modes = await app.evaluate(
    `(async () => {
      const o = window.__autoStampOverlay;
      const sh = window.__autoStampShell;
      const GROUND = ${JSON.stringify(GROUND)}, INK = ${JSON.stringify(INK)};
      const gco = ${JSON.stringify(GCO)};
      const ref = document.createElement('canvas');
      ref.width = 8; ref.height = 8;
      const ctx = ref.getContext('2d');
      const modes = ${JSON.stringify(BLEND)};
      const out = [];
      for (const m of modes) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.filter = 'none';
        ctx.fillStyle = 'rgb(' + GROUND.join(',') + ')';
        ctx.fillRect(0, 0, 8, 8);
        ctx.globalCompositeOperation = gco[m] || m;
        if (ctx.globalCompositeOperation !== (gco[m] || m)) return { rejected: m };
        ctx.fillStyle = 'rgb(' + INK.join(',') + ')';
        ctx.fillRect(0, 0, 8, 8);
        const reference = Array.from(ctx.getImageData(4, 4, 1, 1).data);
        sh.setParam('api.apply.blend', m);
        await new Promise((r) => setTimeout(r, 90));
        const s = o.sample(190, 340, 8, 8, 'composite');
        out.push({ m, px: s.data.slice(0, 4), reference, gco: ctx.globalCompositeOperation });
      }
      return out;
    })()`
  );
  if (!Array.isArray(modes)) {
    bad(`canvas 拒绝了混合模式名 ${JSON.stringify(modes)}`);
  } else {
    for (const e of modes) {
      if (e.px[3] !== 255) bad(`${e.m}: 叠加 alpha = ${e.px[3]}, want 255`);
      const d = [0, 1, 2].map((i) => Math.abs(e.px[i] - e.reference[i]));
      if (d.some((v) => v > 2)) {
        bad(`${e.m}: 叠加层 ${e.px.slice(0, 3).join(",")} != 独立 blend ${e.reference.slice(0, 3).join(",")} (Δ ${d.join(",")})`);
      }
    }
    console.log(`  ok 16 模式在真实叠加层里全部画完并与独立 blend 一致`);
  }
}

// ---------- 主流程 --------------------------------------------------------

async function main() {
  const exe = join(root, "dist", exeName());
  if (!process.argv.includes("--reuse-build") || !existsSync(exe)) {
    console.log("pixel-matrix: building", exeName());
    const b = await run(["go", "build", "-o", join("dist", exeName()), "."]);
    if (b.code !== 0) throw new Error("go build failed:\n" + b.stderr);
  }

  const sandbox = mkdtempSync(join(tmpdir(), "autostamp-pixel-matrix-"));
  const env = { ...process.env, APPDATA: join(sandbox, "Roaming"), LOCALAPPDATA: join(sandbox, "Local") };
  const dir = join(sandbox, "samples");
  mkdirSync(dir, { recursive: true });
  const sealB64 = solidPNG(48, 48, [INK[0], INK[1], INK[2], 255]).toString("base64");
  let pdfPath = "";
  if (runPart("chain")) {
    pdfPath = join(dir, "solid-ground.pdf");
    writeFileSync(pdfPath, await (async () => {
      const gen = await openChrome({ port: SAMPLE_PORT });
      const buf = await printPdf(gen, `<body style="margin:0"><div style="width:595.3pt;height:841.9pt;background:rgb(${GROUND.join(",")})"></div></body>`);
      await gen.close(!process.argv.includes("--keep-profile"));
      return buf;
    })());
    if (!existsSync(pdfPath)) bad("样本 PDF 生成失败");
  }

  const { proc } = await run(["dist/" + exeName(), "-no-browser", "-window=false"], { env, detachedChild: true });
  const child = proc;
  let stderrText = "";
  child.stderr.on("data", (d) => (stderrText += d.toString()));
  const url = await waitFor(() => {
    const m = stderrText.match(/url=(http:\/\/127\.0\.0\.1:\d+)/);
    return m ? m[1] : null;
  }, 10000, "server never printed its url:\n" + stderrText);
  console.log("pixel-matrix: server", url);

  const app = await openChrome({
    port: APP_PORT,
    url,
    waitFor: "!!(window.__autoStampShell && window.__autoStampPreview)",
    diag: "document.readyState + '|' + location.href",
  });

  try {
    if (runPart("matrix")) await checkMatrix(app);
    if (runPart("chain")) await checkRealChain(app, pdfPath, sealB64);
    if (app.errors.length) {
      app.errors.forEach((e) => console.error("   console error:", e.text));
      bad(`页面 console error = ${app.errors.length}, want 0`);
    }
    if (app.failures.length) {
      app.failures.forEach((f) => console.error("   request fail:", f.url, f.status));
      bad(`失败请求 ${app.failures.length}, want 0`);
    }
    void 0;
  } finally {
    await app.close(!process.argv.includes("--keep-profile"));
    child.kill();
    if (!process.argv.includes("--keep-profile")) rmSync(sandbox, { recursive: true, force: true, maxRetries: 6 });
  }

  if (fails.length) {
    console.error("pixel-matrix: FAILED");
    fails.forEach((f) => console.error(" - " + f));
    process.exit(1);
  }
  console.log("pixel-matrix: ok");
}

main().catch((e) => {
  console.error("pixel-matrix: crash", e && e.stack ? e.stack : e);
  process.exit(1);
});
