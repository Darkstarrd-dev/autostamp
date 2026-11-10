#!/usr/bin/env node
// tools/verify/export-smoke.mjs — P5 光栅导出链路的端到端数值验收(UI_SPEC §8 W5/W6)。
//
// 与 apply-smoke.mjs 的分工:那边钉「盖章 -> 落盘 -> 保存」的矢量链,这里钉保存
// 流程里的**光栅化通道** —— submitSave 在 mode=raster 时先渲染选中页(scale =
// dpi/72,pdf.js 显示方向,不做旋转补偿)、canvas.toBlob('image/jpeg', q)、按
// Contract 发 multipart(`spec` + `page-<n>`)到 POST /api/pdf/export、adopt 新
// asset,再写盘;mode=vector 不发该请求(源资产直接写,W5)。
//
// 四段(缺省全跑,`--only=<name>` 单跑):
//   raster 保存链:双页样本 + 印章实例 -> §7 驱动 saveToPath(目标路径;SV1 后
//   按钮会开原生对话框,无头跑不可点),链上参数/幂等/请求数照常钉死,
//          断言 ok.exported toast(页数/dpi/质量)、probe('chain') 的
//          apply/export/save 记账、磁盘文件再 fs/pick+open 页数一致、每页
//          pt 尺寸 == px*72/dpi(±1 pt)、导出页渲染像素含印章色(与导出前
//          预览同点,Δ <= 6,取框中部避开 AA)、导出文件字节落在 FACTS §4
//          150dpi q75 行(123,796 B/页)±40% 内(实测值打印,不假装 ±5%)。
//   vector mode=vector 保存:网络日志(delta)断言**没有** /api/pdf/export 请求,
//          回读 getTextContent 仍有文字(矢量没被砸掉)。
//   guard  W6 提交前拦截:100x100 英寸大页 + custom 600 dpi,体积预估 >
//          90 MiB -> warn toast(warn.export.tooBig)且零 /api/pdf/* 请求。
//   chain  probe 钉子:pages="2" 的子集导出 -> exportBody 的 spec 字段集合
//          恰好等于 Contract 的五项、页号升序、bytesPerPage/px 形状;记账链
//          apply -> export -> save。后端没注册路由时 exportBody 仍然被钉住
//          (它在发请求前就记录了),raster 侧依赖后端的断言**显式失败**,
//          不改断言假绿。
//          二次保存必须复用已光栅化的 asset(增量网络日志里 /api/pdf/export 记到
//          0 次),改 dpi/quality/pages 后必须重光栅化恰好一次并换来新 asset --
//          见 checkChain 末尾的 chain-2 / chain-3。
//
// Usage: node tools/verify/export-smoke.mjs [--reuse-build] [--keep-profile] [--only=<name>]
// Exit: 0 = pass, 1 = fail.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { openChrome, makeReport } from "./cdp.mjs";

const root = resolve(join(fileURLToPath(import.meta.url)), "..", "..", "..");
const APP_PORT = Number(process.env.EXPORT_SMOKE_PORT || 9381);
const SAMPLE_PORT = Number(process.env.EXPORT_SMOKE_SAMPLE_PORT || 9382);
const fails = [];
const { bad, cmp, truthy } = makeReport(fails);

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
    await sleep(120);
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
  return process.platform === "win32" ? "autostamp-export-smoke.exe" : "autostamp-export-smoke";
}

// ---------- PNG 生成(颜色必须已知,不能靠仓库 fixture;同 apply-smoke) ------

function crc32(buf) {
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

function pngRGBA(w, h, paint) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const c = paint(x, y);
      const p = row + 1 + x * 4;
      raw[p] = c[0];
      raw[p + 1] = c[1];
      raw[p + 2] = c[2];
      raw[p + 3] = c[3];
    }
  }
  const ihdr = Buffer.alloc(17);
  ihdr.write("IHDR", 0);
  ihdr.writeUInt32BE(w, 4);
  ihdr.writeUInt32BE(h, 8);
  ihdr[12] = 8;
  ihdr[13] = 6;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr.subarray(4)),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- 样本 PDF:CDP Page.printToPDF(与 preview/apply-smoke 同一做法) --

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

// busyRows 是导出样本的正文:文字行(高熵,给 vector 段留可抽取文本)+ 实色条
// + 一块渐变。行数是校准出来的:46 行时 JPEG q75 到 ~296 KB/页,FACTS §4 的
// 150dpi q75 行是 123,796 B —— 熵降到 ~20 行落在 ±40% 带内。全部取值写死,
// 字节断言只允许依赖确定性内容。
function busyRows(label) {
  const bars = ["#1f6feb", "#d29a22", "#2da44e", "#bf3989"];
  let rows = "";
  for (let i = 0; i < 20; i++) {
    rows +=
      `<p style="margin:0 0 1.5pt 0;font:8.5pt sans-serif;color:#24292f;white-space:nowrap">` +
      `${label} line ${String(i + 1).padStart(2, "0")} the quick brown fox jumps over the lazy dog 0123456789</p>`;
    if (i % 6 === 5) rows += `<div style="height:6pt;background:${bars[(i / 6) % bars.length]}"></div>`;
    if (i === 11) {
      rows += `<div style="height:90pt;background:radial-gradient(circle at 30% 30%, #ffffff 0%, #7aa2e3 55%, #24344d 100%)"></div>`;
    }
  }
  return rows;
}

const PAGE_INNER = (label, brk) =>
  `<div style="width:595.3pt;height:841.9pt;background:rgb(217,230,255);overflow:hidden;${brk ? "page-break-after:always" : ""}">` +
  busyRows(label) +
  `</div>`;

// ---------- 断言辅助 ------------------------------------------------------

function within(label, got, want, tol) {
  const d = [got[0] - want[0], got[1] - want[1], got[2] - want[2]];
  if (!d.every((v) => Math.abs(v) <= tol)) {
    bad(`${label}: got ${got.join(",")} want ${want.join(",")} (±${tol}, delta ${d.join(",")})`);
  } else {
    console.log(`  ok ${label} = ${got.join(",")} (Δ ${d.join(",")})`);
  }
}

const isClose = (px, c, tol) => [0, 1, 2].every((i) => Math.abs(px[i] - c[i]) <= tol);

const GROUND = [217, 230, 255];
const INK = [200, 24, 28]; // #c8181c 的印章色

// FACTS §4 的 150dpi q75 行:单页 A4 1240x1754 px -> 123,796 B。我们的样本
// 内容与那枚探针的合成图不同,所以只能钉量级(±40%),实测值必须打印出来。
const FACTS_150_Q75 = 123796;
const BYTE_BAND = 0.4;

// 实例几何(与 apply-smoke 同一组):scale 0.15 -> 框宽 89.3 pt,tl 锚点
// offset 150,300 -> 框 (150,300)-(239.3,389.3);取样点在框中部,避开边界 AA。
const SAMPLE_X = 190;
const SAMPLE_Y = 340;

function instanceParams(o) {
  return {
    "api.apply.blend": o.blend,
    "api.apply.opacity": o.opacity,
    "api.apply.brightness": 1,
    "api.apply.saturate": 1,
    "api.apply.scale": o.scale,
    "api.apply.anchor": o.anchor || "tl",
    "api.apply.offset": o.offset || "150,300",
    "api.apply.pos": o.offset || "150,300",
    "api.apply.rotation": 0,
    "api.apply.pages": "all",
    "api.apply.crossPage": Boolean(o.crossPage),
    "api.apply.startOffset": o.startOffset || 0,
    "ui.crosspage.binding": o.binding || "right",
  };
}

// ---------- 打开链 ------------------------------------------------------

async function grantOf(app, filePath) {
  const pick = await app.evaluate(
    `(async () => {
      const h = { 'content-type': 'application/json', 'X-AutoStamp-Session': sessionStorage.getItem('autostamp.session') };
      const r = await fetch('/api/fs/pick', { method: 'POST', headers: h, body: JSON.stringify({ filePath: ${JSON.stringify(filePath)}, filter: 'pdf' }) });
      return { status: r.status, body: await r.json().catch(() => null) };
    })()`
  );
  const id = ((((pick.body || {}).data || {}).picks || [])[0] || {}).pathGrantId || "";
  if (!id) bad(`fs/pick 没有授权: status=${pick.status} ${JSON.stringify(pick.body ?? pick).slice(0, 200)}`);
  return id;
}

async function openByGrant(app, grantId) {
  const info = await app.evaluate(
    `(async () => { try { return await window.__autoStampApi.request('/api/pdf/open', { method: 'POST', body: { pathGrantId: ${JSON.stringify(grantId)} } }); } catch (e) { return { code: e.code, message: e.message }; } })()`
  );
  if (!info || !info.assetId) {
    bad("pdf/open 没有回 assetId: " + JSON.stringify(info).slice(0, 200));
    return null;
  }
  return info;
}

async function openDoc(app, filePath) {
  const grant = await grantOf(app, filePath);
  if (!grant) return null;
  const info = await openByGrant(app, grant);
  if (!info) return null;
  await app.evaluate(
    `(async () => {
      const sh = window.__autoStampShell;
      await sh.adopt(${JSON.stringify(info)});
      // 新文档不清实例(只清资产链);脱钩上一段的印章,本轮才只有「一个」实例。
      sh.state.instances.forEach((i) => { i.sealId = null; });
    })()`
  );
  return info;
}

async function prepareSeal(app, pngB64, name) {
  const prepared = await app.evaluate(
    `(async () => {
      const bin = atob(${JSON.stringify(pngB64)});
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const file = new File([buf], ${JSON.stringify(name)}, { type: 'image/png' });
      const m = await window.__autoStampSeal.prepare(file, { despill: false, alphaTrim: false, resampleDpi: 300 });
      return { sealId: m.sealId, srcWidth: m.srcWidth, srcHeight: m.srcHeight };
    })()`
  );
  if (!prepared || !prepared.sealId) {
    bad(`seal/prepare(${name}) 失败: ` + JSON.stringify(prepared).slice(0, 200));
    return null;
  }
  return prepared;
}

async function waitSealReady(app, sealId) {
  await waitFor(
    async () => {
      const seals = await app.evaluate(`window.__autoStampSeal.probe('seals')`);
      return Array.isArray(seals) && seals.some((s) => s.sealId === sealId && s.ready);
    },
    8000,
    `印章位图未就绪(${sealId})`
  );
}

async function addSealInstance(app, sealId, label) {
  await app.evaluate(
    `(async () => {
      const sh = window.__autoStampShell;
      sh.addInstance(${JSON.stringify(label)}, ${JSON.stringify(instanceParams({ blend: "normal", opacity: 1, scale: 0.15 }))});
      sh.setSealForSelected(${JSON.stringify(sealId)});
    })()`
  );
  await sleep(200);
}

// ---------- 网络日志 / toast 记录(全部页面侧,不碰 cdp.mjs) ---------------

// performance resource entries 就是网络日志:pdf.js 的 Range fetch、/api/* 往
// 返都记在里面。每段先 snapshot+clear,断言只看**增量**,所以探针自己发过的
// 请求不会污染结论。
async function netBaseline(app) {
  await app.evaluate("performance.clearResourceTimings()");
}

async function netNames(app) {
  return app.evaluate("performance.getEntriesByType('resource').map((e) => e.name)");
}

// armToastLog 用 MutationObserver 记录 #error-toast 的每一次变化 —— ok.exported
// 会在保存完成前被 ok.saved 覆盖,轮询会漏掉瞬间的 toast,观察者不会。
async function armToastLog(app) {
  await app.evaluate(
    `(() => {
      const el = document.querySelector('#error-toast');
      window.__toastLog = [];
      if (!window.__toastArm) {
        window.__toastArm = true;
        new MutationObserver(() => {
          window.__toastLog.push({ level: el.dataset.level || '', open: el.dataset.open, text: el.textContent });
        }).observe(el, { attributes: true, attributeFilter: ['data-level', 'data-open'], childList: true, characterData: true, subtree: true });
      }
    })()`
  );
}

async function toastLog(app) {
  return app.evaluate("window.__toastLog || []");
}

// driveSave 走 §7 驱动通道 saveToPath(target):SV1 起 #save-confirm 的 click
// 会弹出**真实**原生另存为对话框,无头跑根本答不了它,所以 verify 不再点按钮,
// 直接喂目标路径(链上其余环节与用户按钮完全同一条 submitSave)。
async function driveSave(app, target) {
  await armToastLog(app);
  await netBaseline(app);
  await app.evaluate(
    `(async () => { await window.__autoStampShell.saveToPath(${JSON.stringify(target)}); })()`
  );
}

let serverTail = [];

// waitSaveDone 等保存链走完(链上出现 save asset)。失败时把页面上最后一次
// error toast 带回来 —— 405(后端路由未就绪)是「显式失败」而非脚本 bug,置
// exportRouteMissing 让调用方把能钉的钉住、依赖后端的显式 bad(),绝不静默跳过。
let exportRouteMissing = false;

async function waitSaveDone(app, maxMs, label) {
  try {
    await waitFor(async () => {
      const ch = await app.evaluate(`window.__autoStampShell.probe('chain')`);
      return ch && ch.save ? ch : null;
    }, maxMs, `${label}: 保存链没有走完`);
    return { ok: true };
  } catch (e) {
    const log = await toastLog(app);
    const errs = log.filter((t) => t.level === "error");
    const last = errs[errs.length - 1];
    if (last && last.text.indexOf("http_405") >= 0 && last.text.indexOf("/api/pdf/export") >= 0) {
      exportRouteMissing = true;
      console.log(`  !! ${label}: 后端还没注册 POST /api/pdf/export(405)—— exportBody 仍然钉住,依赖后端的断言会显式失败`);
      return { ok: false, missing: true };
    }
    return { ok: false, why: last ? last.text : String((e && e.message) || e) };
  }
}
// waitReq 等网络日志里出现某条请求(resource timing 只在响应回来后才登记),并把
// 完整名字列表交回去。连续保存两次的场景里,「probe 里的 asset id 变了」不是完成
// 信号:save 路由回显同一个 assetId,光栅化失败时 export id 也不会换 —— 请求本身
// 才是信号,否则会在请求发完之前就把日志读走,「0 次 export」就成了假绿。
async function waitReq(app, sub, maxMs, label) {
  try {
    return await waitFor(async () => {
      const names = await netNames(app);
      return names.some((n) => n.includes(sub)) ? names : null;
    }, maxMs, label);
  } catch (e) {
    bad(`${label}: 没等到 ${sub} 请求(${e.message})`);
    return await netNames(app);
  }
}


function ptAssert(label, got, want, tol) {
  const d = Math.abs(got - want);
  if (d > tol) bad(`${label}: pt ${got} != px*72/dpi ${want} (±${tol}, Δ ${d.toFixed(3)})`);
  else console.log(`  ok ${label} = ${got} pt (px*72/dpi = ${want.toFixed(2)}, Δ ${d.toFixed(3)})`);
}

// ---------- 段 1:raster 保存链 ------------------------------------------

async function checkRaster(app, grantPath, sealId, sandbox) {
  const target = join(sandbox, "out-raster.pdf").replace(/\\/g, "/");
  const info = await openDoc(app, grantPath);
  if (!info) return;
  await addSealInstance(app, sealId, "export-me");
  await app.evaluate(
    `(async () => {
      const sh = window.__autoStampShell;
      sh.setParam('api.export.mode', 'raster');
      sh.setParam('api.export.dpi', '150');
      sh.setParam('api.export.quality', 75);
      sh.setParam('api.export.pages', 'all');
    })()`
  );

  // 导出前的预览像素:同一点、同一渲染族 —— 印章色必须已经在画布上。
  const pre = await app.evaluate(
    `Array.from(window.__autoStampOverlay.sample(${SAMPLE_X}, ${SAMPLE_Y}, 4, 4, 'composite').data).slice(0, 3)`
  );
  within("导出前预览 (190,340) 是印章色", pre, INK, 6);

  await driveSave(app, target);
  const done = await waitSaveDone(app, 90000, "raster");
  const chain = await app.evaluate(`window.__autoStampShell.probe('chain')`);
  const body = await app.evaluate(`window.__autoStampShell.probe('exportBody')`);
  const log = await toastLog(app);

  // toast:ok.exported(页数/dpi/质量)在链中途出现过,最终 toast 是保存的。
  const exported = log.find((t) => t.level === "ok" && /rasterised 2 page\(s\) at 150 dpi q75/.test(t.text));
  if (!exported) bad(`toast 里没有 ok.exported(2 页/150dpi/q75): ${JSON.stringify(log.slice(-6))}`);
  else console.log(`  ok toast ok.exported 出现过: "${exported.text}"`);
  const lastOk = [...log].reverse().find((t) => t.level === "ok");
  truthy("最终 toast 是 ok 级", lastOk && lastOk.text);

  if (!done.ok) {
    // 405 = 后端未就绪:能钉的只有「请求前」的 exportBody;其余依赖后端的
    // 断言显式失败,不假绿。其它失败把 toast 原文打出来。
    if (!body) bad("raster: 连 exportBody 都没有记录(渲染通道没跑)");
    else console.log(`  ok exportBody(失败前)已钉住: ${JSON.stringify(body).slice(0, 240)}`);
    bad(`raster: 保存链没有完成: ${done.missing ? "POST /api/pdf/export 未注册(405)" : done.why} | server: ${serverTail.join(" // ")}`);
    return;
  }

  // probe('chain') 记账:apply -> export -> save,当前文档 = 导出的 asset,
  // 落盘后实例清空(W2)。
  truthy("链上 apply asset", Boolean(chain.apply));
  truthy("链上 export asset", Boolean(chain.export));
  truthy("链上 save asset", Boolean(chain.save));
  cmp("当前文档是导出的 asset", chain.current, chain.export);
  if (chain.export === chain.apply) bad("export asset 与 apply asset 相同(没有产生新文档)");
  cmp("落盘后实例清空(W2)", chain.instances.length, 0);

  // exportBody:spec 恰好是 Contract 的五个字段(DisallowUnknownFields 会拒
  // 多余字段,前端必须一个都不多发),assetId 是盖章后的 apply asset。
  if (!body) {
    bad("raster: probe('exportBody') 为空");
    return;
  }
  const specKeys = Object.keys(body.spec || {}).sort();
  cmp("spec 字段集合 == Contract 五项", JSON.stringify(specKeys), JSON.stringify(["assetId", "dpi", "mode", "pages", "quality"]));
  cmp("spec.assetId 是盖章后的 asset", body.spec.assetId, chain.apply);
  cmp("spec.mode", body.spec.mode, "raster");
  cmp("spec.dpi", body.spec.dpi, 150);
  cmp("spec.quality", body.spec.quality, 75);
  cmp("spec.pages", body.spec.pages, "all");
  cmp("页号升序", JSON.stringify(body.pages), JSON.stringify([1, 2]));
  if (!Array.isArray(body.bytesPerPage) || body.bytesPerPage.length !== 2 || body.bytesPerPage.some((b) => !(b > 0))) {
    bad(`bytesPerPage 形状不对: ${JSON.stringify(body.bytesPerPage)}`);
  } else {
    console.log(`  ok bytesPerPage = ${body.bytesPerPage.join(", ")} B(canvas.toBlob q75)`);
  }
  const pxWant = [
    [1240, 1754], // 595.3pt x 150/72 = 1240.2 -> 1240
    [1240, 1754],
  ];
  body.px.forEach((pair, i) => {
    if (Math.abs(pair[0] - pxWant[i][0]) > 2 || Math.abs(pair[1] - pxWant[i][1]) > 2) {
      bad(`页 ${i + 1} 位图 px ${pair} 偏离 150dpi 的 ${pxWant[i]}`);
    }
  });
  if (body.bytesPerPage && body.bytesPerPage.every((b) => b > 0) && body.px) {
    console.log(`  ok px = ${JSON.stringify(body.px)}(pdf.js 显示方向,不做旋转补偿)`);
  }

  // 磁盘文件:存在、字节量级 == FACTS §4 150dpi q75 行 x 2 页 ±40%。
  if (!existsSync(target)) {
    bad("磁盘上没有写出光栅文件: " + target);
    return;
  }
  const size = statSync(target).size;
  const want = 2 * FACTS_150_Q75;
  const lo = Math.round(want * (1 - BYTE_BAND));
  const hi = Math.round(want * (1 + BYTE_BAND));
  console.log(`  measured export file = ${size} B(FACTS §4 150dpi q75 行 123,796 B/页 x 2 = ${want} B,±40% = [${lo}, ${hi}])`);
  if (size < lo || size > hi) {
    bad(`导出文件字节 ${size} B 落在 FACTS §4 带宽外 [${lo}, ${hi}](样本熵需要重校)`);
  }

  // 磁盘文件再 fs/pick + open:页数一致,每页 pt == px*72/dpi(±1 pt)。
  const grant = await grantOf(app, target);
  const reopened = grant ? await openByGrant(app, grant) : null;
  if (!reopened) {
    bad("保存的光栅文件不能再 open");
    return;
  }
  cmp("磁盘文件回读页数", reopened.pageCount, 2);
  reopened.pages.forEach((pg, i) => {
    ptAssert(`页 ${pg.number} 宽`, pg.width, (body.px[i][0] * 72) / 150, 1);
    ptAssert(`页 ${pg.number} 高`, pg.height, (body.px[i][1] * 72) / 150, 1);
  });

  // 导出页渲染像素:同一 pt 点仍是印章色(位图经过了 q75 JPEG + 回读渲染)。
  await app.evaluate(
    `(async () => { await window.__autoStampShell.adopt(${JSON.stringify(reopened)}); })()`
  );
  await sleep(250);
  const post = await app.evaluate(
    `Array.from(window.__autoStampOverlay.sample(${SAMPLE_X}, ${SAMPLE_Y}, 4, 4, 'composite').data).slice(0, 3)`
  );
  within("导出文件回读 (190,340) 仍是印章色", post, INK, 6);
  console.log("  ok raster 保存链:apply -> 光栅化 -> adopt -> 写盘全部落位");
}

// ---------- 段 2:vector 模式不发导出请求 --------------------------------

async function checkVector(app, grantPath, sealId, sandbox) {
  const target = join(sandbox, "out-vector.pdf").replace(/\\/g, "/");
  const info = await openDoc(app, grantPath);
  if (!info) return;
  await addSealInstance(app, sealId, "vector-me");
  await app.evaluate(
    `(async () => {
      const sh = window.__autoStampShell;
      sh.setParam('api.export.mode', 'vector');
      sh.setParam('api.export.pages', 'all');
    })()`
  );
  await driveSave(app, target);
  const done = await waitSaveDone(app, 30000, "vector");
  truthy("vector: 保存链完成", done.ok);
  const names = await netNames(app);
  const exportHits = names.filter((n) => n.indexOf("/api/pdf/export") >= 0);
  cmp("vector 模式的 /api/pdf/export 请求次数", exportHits.length, 0);
  const chain = await app.evaluate(`window.__autoStampShell.probe('chain')`);
  truthy("vector: 链上 apply asset(盖章照常发生)", Boolean(chain.apply));
  cmp("vector: 链上 export asset 为空", chain.export, "");
  if (!done.ok) return;
  if (!existsSync(target)) {
    bad("磁盘上没有写出 vector 文件: " + target);
    return;
  }
  const grant = await grantOf(app, target);
  const reopened = grant ? await openByGrant(app, grant) : null;
  if (!reopened) {
    bad("vector: 保存的文件不能再 open");
    return;
  }
  await app.evaluate(
    `(async () => { await window.__autoStampShell.adopt(${JSON.stringify(reopened)}); })()`
  );
  await sleep(250);
  const text = await app.evaluate(
    `(async () => {
      const po = await window.__autoStampPreview.getPage(1);
      const tc = await po.getTextContent();
      return tc.items.map((i) => i.str).join("");
    })()`
  );
  if (text.indexOf("AUTOSTAMP-VECTOR-KEEP") < 0) bad(`vector: 回读 getTextContent 丢了文字(前 120 字: ${JSON.stringify(text.slice(0, 120))})`);
  else console.log(`  ok vector: 回读 getTextContent 仍有文字(${text.length} 字符,含 AUTOSTAMP-VECTOR-KEEP)`);
}

// ---------- 段 3:W6 提交前拦截 ------------------------------------------

async function checkGuard(app, grantPath) {
  const info = await openDoc(app, grantPath);
  if (!info) return;
  await app.evaluate(
    `(async () => {
      const sh = window.__autoStampShell;
      sh.setParam('api.export.mode', 'raster');
      sh.setParam('api.export.dpi', 'custom');
      sh.setParam('api.export.customDpi', 600);
      sh.setParam('api.export.pages', 'all');
    })()`
  );
  // 体积预估就是 W6 的闸门输入:7200x7200pt 页 @600dpi q75 -> 每页 ~157 MB。
  const est = await app.evaluate(`window.__autoStampShell.probe('estimate')`);
  console.log(`  estimate per-page = ${est.perPageBytes} B(${est.perPageText})`);
  truthy("W6 预估确实超过 90 MiB 闸门", est.perPageBytes > 90 * 1024 * 1024);
  await driveSave(app, join(tmpdir(), "autostamp-export-guard-never.pdf").replace(/\\/g, "/"));
  await waitFor(
    async () => {
      const log = await toastLog(app);
      return log.some((t) => t.level === "warn" && t.text.indexOf("90 MB") >= 0) ? log : null;
    },
    8000,
    "guard: 没有 warn toast(warn.export.tooBig)"
  );
  const log = await toastLog(app);
  const warn = log.find((t) => t.level === "warn");
  console.log(`  ok warn toast: "${warn.text}"`);
  const names = await netNames(app);
  const pdfHits = names.filter((n) => /\/api\/pdf\/(export|save|apply)/.test(n));
  cmp("W6 拦截后 /api/pdf/* 请求次数", pdfHits.length, 0);
  const chain = await app.evaluate(`window.__autoStampShell.probe('chain')`);
  cmp("W6: 没有产生 save asset", chain.save, "");
  cmp("W6: 没有产生 export asset", chain.export, "");
}

// ---------- 段 4:probe 钉子(子集页) ------------------------------------

async function checkChain(app, grantPath, sealId, sandbox) {
  const target = join(sandbox, "out-subset.pdf").replace(/\\/g, "/");
  const info = await openDoc(app, grantPath);
  if (!info) return;
  await addSealInstance(app, sealId, "chain-me");
  await app.evaluate(
    `(async () => {
      const sh = window.__autoStampShell;
      sh.setParam('api.export.mode', 'raster');
      sh.setParam('api.export.dpi', '150');
      sh.setParam('api.export.quality', 75);
      sh.setParam('api.export.pages', '2');
    })()`
  );
  await driveSave(app, target);
  const done = await waitSaveDone(app, 90000, "chain");
  const chain = await app.evaluate(`window.__autoStampShell.probe('chain')`);
  const body = await app.evaluate(`window.__autoStampShell.probe('exportBody')`);

  // exportBody 在发请求前就记录,后端 405 也照样钉得住 —— 这就是本段的职责。
  if (!body) {
    bad("chain: probe('exportBody') 为空");
    return;
  }
  const specKeys = Object.keys(body.spec || {}).sort();
  cmp("chain: spec 字段集合 == Contract 五项", JSON.stringify(specKeys), JSON.stringify(["assetId", "dpi", "mode", "pages", "quality"]));
  cmp("chain: spec.assetId 是盖章后的 asset", body.spec.assetId, chain.apply);
  cmp("chain: spec.pages 是面板词表原文", body.spec.pages, "2");
  cmp("chain: 只送源页 2(文件名 page-2)", JSON.stringify(body.pages), JSON.stringify([2]));
  if (!Array.isArray(body.bytesPerPage) || body.bytesPerPage.length !== 1 || !(body.bytesPerPage[0] > 0)) {
    bad(`chain: bytesPerPage 形状不对: ${JSON.stringify(body.bytesPerPage)}`);
  } else {
    console.log(`  ok chain: exportBody 钉住 spec=${JSON.stringify(body.spec)} bytesPerPage=${body.bytesPerPage[0]} B px=${JSON.stringify(body.px)}`);
  }
  if (!done.ok) {
    bad(`chain: 保存链没有完成: ${done.missing ? "POST /api/pdf/export 未注册(405),exportBody 已钉住,不假绿" : done.why} | server: ${serverTail.join(" // ")}`);
    return;
  }
  truthy("chain: 链上 export asset", Boolean(chain.export));
  cmp("chain: 当前文档是导出的 asset", chain.current, chain.export);
  cmp("chain: 落盘后实例清空(W2)", chain.instances.length, 0);
  // chain-2:同一份 spec 再保存一次必须复用已光栅化的 asset —— 多一代 JPEG 编码
  // 就是可见画质损失,而面板字段本身分不出「刚光栅化过」与「用户又要了一次」。
  // 完成信号是请求本身:/api/pdf/save 回显同一个 assetId(save.go 的 saveResult),
  // 所以 probe 里的 id 永远不会变,拿 id 等会一直超时(实测踩过)。
  const target2 = join(sandbox, "out-subset-again.pdf").replace(/\\/g, "/");
  await driveSave(app, target2);
  const names2 = await waitReq(app, "/api/pdf/save", 90000, "chain-2 二次保存");
  cmp("chain: 二次保存不重新光栅化(无二次 JPEG 世代)", names2.filter((n) => n.includes("/api/pdf/export")).length, 0);
  // chain-3:参数变了就是新的落盘意图,必须重光栅化恰好一次并换来新 export asset。
  // pages 换成 all 是因为当前文档已是那份单页子集(源页 2 已不存在)。
  await app.evaluate(
    `(async () => {
      const sh = window.__autoStampShell;
      sh.setParam('api.export.pages', 'all');
      sh.setParam('api.export.quality', 85);
    })()`
  );
  const target3 = join(sandbox, "out-subset-q85.pdf").replace(/\\/g, "/");
  await driveSave(app, target3);
  // 先等 export 请求真的发出去(重光栅化确实发生),再等 save 请求,链子才算走完。
  await waitReq(app, "/api/pdf/export", 90000, "chain-3 重光栅化");
  const names3 = await waitReq(app, "/api/pdf/save", 90000, "chain-3 保存");
  cmp("chain: 改了参数就重新光栅化(恰好一次)", names3.filter((n) => n.includes("/api/pdf/export")).length, 1);
  const chain3 = await app.evaluate(`window.__autoStampShell.probe('chain')`);
  truthy("chain: 重光栅化换来新 asset", Boolean(chain3.export) && chain3.export !== chain.export);
  cmp("chain: 当前文档 = 新导出的 asset", chain3.current, chain3.export);
  const grant = await grantOf(app, target);
  const reopened = grant ? await openByGrant(app, grant) : null;
  if (!reopened) {
    bad("chain: 子集导出文件不能再 open");
    return;
  }
  cmp("chain: 子集导出页数 == 1", reopened.pageCount, 1);
  console.log("  ok chain: apply -> export(子集) -> save 记账与磁盘文件一致");
}

// ---------- 主流程 ------------------------------------------------------

async function main() {
  const exe = join(root, "dist", exeName());
  if (!process.argv.includes("--reuse-build") || !existsSync(exe)) {
    console.log("export-smoke: building", exeName());
    const b = await run(["go", "build", "-o", join("dist", exeName()), "."]);
    if (b.code !== 0) throw new Error("go build failed:\n" + b.stderr);
  }

  const sandbox = mkdtempSync(join(tmpdir(), "autostamp-export-smoke-"));
  const env = { ...process.env, APPDATA: join(sandbox, "Roaming"), LOCALAPPDATA: join(sandbox, "Local") };
  const dir = join(sandbox, "samples");
  mkdirSync(dir, { recursive: true });

  const solidB64 = pngRGBA(48, 48, () => [INK[0], INK[1], INK[2], 255]).toString("base64");

  const busy2 = join(dir, "busy-2p.pdf");
  const busy1 = join(dir, "busy-1p.pdf");
  const huge = join(dir, "huge-1p.pdf");
  writeFileSync(busy2, await (async () => {
    const gen = await openChrome({ port: SAMPLE_PORT });
    const buf = await printPdf(
      gen,
      `<body style="margin:0">${PAGE_INNER("AUTOSTAMP-RASTER", true)}${PAGE_INNER("AUTOSTAMP-RASTER-B", false)}</body>`
    );
    await gen.close(!process.argv.includes("--keep-profile"));
    return buf;
  })());
  writeFileSync(busy1, await (async () => {
    const gen = await openChrome({ port: SAMPLE_PORT });
    const buf = await printPdf(gen, `<body style="margin:0">${PAGE_INNER("AUTOSTAMP-VECTOR-KEEP", false)}</body>`);
    await gen.close(!process.argv.includes("--keep-profile"));
    return buf;
  })());
  // W6 的闸门样本:100x100 英寸(7200x7200pt)单页,面积是 A4 的 ~103 倍,
  // custom 600 dpi 的预估 > 90 MiB。留一行文字避免触发 noText 的 warn toast。
  writeFileSync(huge, await (async () => {
    const gen = await openChrome({ port: SAMPLE_PORT });
    const buf = await printPdf(
      gen,
      `<body style="margin:0"><div style="width:7200pt;height:7200pt;background:rgb(${GROUND.join(",")})">` +
      `<p style="margin:40pt;font:24pt sans-serif;color:#24292f">AUTOSTAMP GUARD 100x100in</p></div></body>`,
      7200,
      7200
    );
    await gen.close(!process.argv.includes("--keep-profile"));
    return buf;
  })());

  const { proc } = await run(["dist/" + exeName(), "-no-browser", "-window=false"], { env, detachedChild: true });
  const child = proc;
  let stderrText = "";
  child.stderr.on("data", (d) => {
    stderrText += d.toString();
    serverTail = stderrText.trim().split("\n").slice(-6);
  });
  const url = await waitFor(() => {
    const m = stderrText.match(/url=(http:\/\/127\.0\.0\.1:\d+)/);
    return m ? m[1] : null;
  }, 10000, "server never printed its url:\n" + stderrText);
  console.log("export-smoke: server", url);

  const app = await openChrome({
    port: APP_PORT,
    url,
    waitFor: "!!(window.__autoStampShell && window.__autoStampPreview)",
    diag: "document.readyState + '|' + location.href",
  });

  try {
    const seal = await prepareSeal(app, solidB64, "solid.png");
    if (!seal) throw new Error("seal/prepare 未就绪");
    await waitSealReady(app, seal.sealId);

    const seg = async (name, fn) => {
      if (!runPart(name)) return;
      console.log(`-- ${name} --`);
      try {
        await fn();
      } catch (e) {
        bad(`${name}: crashed ${e && e.stack ? e.stack.split("\n")[0] : e} | last toast: ${(await toastLog(app)).slice(-3).map((t) => t.level + ":" + t.text).join(" | ")} | server: ${serverTail.slice(-3).join(" // ")}`);
      }
    };

    await seg("raster", () => checkRaster(app, busy2, seal.sealId, sandbox));
    await seg("vector", () => checkVector(app, busy1, seal.sealId, sandbox));
    await seg("guard", () => checkGuard(app, huge));
    await seg("chain", () => checkChain(app, busy2, seal.sealId, sandbox));

    const errNoise = (s) =>
      /favicon|about:blank|pptr:/.test(s) ||
      (exportRouteMissing && s.indexOf("/api/pdf/export") >= 0 && s.indexOf("405") >= 0);
    const reqNoise = (s) =>
      /favicon/.test(s) ||
      (exportRouteMissing && s.indexOf("/api/pdf/export") >= 0 && s.indexOf("405") >= 0);
    const pageErrors = app.errors.filter((e) => !errNoise(e));
    const reqFailures = app.failures.filter((f) => !reqNoise(f));
    if (pageErrors.length) {
      pageErrors.forEach((e) => console.error("   console error:", e));
      bad(`页面 console error = ${pageErrors.length}, want 0`);
    } else {
      console.log("  ok 页面 console error = 0");
    }
    if (reqFailures.length) {
      reqFailures.forEach((f) => console.error("   request fail:", f));
      bad(`失败请求 ${reqFailures.length}, want 0`);
    }
  } finally {
    await app.close(!process.argv.includes("--keep-profile"));
    child.kill();
    if (!process.argv.includes("--keep-profile")) rmSync(sandbox, { recursive: true, force: true, maxRetries: 6 });
  }

  if (exportRouteMissing) {
    console.log("note: POST /api/pdf/export 未注册(并行后端任务未落地);raster/chain 的后端侧断言按失败计,guard/vector/exportBody 已钉住。");
  }
  if (fails.length) {
    console.error("export-smoke: FAILED");
    fails.forEach((f) => console.error(" - " + f));
    process.exit(1);
  }
  console.log("export-smoke: ok");
}

main().catch((e) => {
  console.error("export-smoke: crash", e && e.stack ? e.stack : e);
  process.exit(1);
});
