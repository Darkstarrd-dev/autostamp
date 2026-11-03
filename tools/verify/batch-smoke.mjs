#!/usr/bin/env node
// tools/verify/batch-smoke.mjs — P6 验收：预设库 UI + 批处理前端跑链（BM1）。
//
// 两段（缺省全跑，`--only=<preset|batch>` 单跑）：
//   preset 真 UI 里 存预设 -> 列表出现（印章卡 + 批处理卡两个 select）-> 改面板参数
//          -> 载入预设 -> 面板字段写回 -> 删除预设；全程 console 0 error。
//   batch  用 Page.printToPDF 现场造 3 份 PDF 写进临时目录，填 #batch-dir-path，
//          跑 fs/pick{dir:true,filePath} -> 点 #batch-start -> 等队列全部 ok，
//          断言磁盘上 _batch\<名>.dpi<dpi>.q<q>.pdf 存在、页数与源一致、源文件字节
//          未被改动；再点导出 CSV/JSON，断言下载内容含表头与 3 行。
//
// 注意：exe 内嵌前端（web/embed.go all:static），所以默认**每次重新编译**；
// --reuse-build 只在确认前端没改时使用（overlay-smoke 的旧坑）。
//
// Usage: node tools/verify/batch-smoke.mjs [--reuse-build] [--keep-profile] [--only=<name>]
// Exit: 0 = pass, 1 = fail.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import zlib from "node:zlib";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { openChrome, makeReport } from "./cdp.mjs";

const root = resolve(join(fileURLToPath(import.meta.url)), "..", "..", "..");
const APP_PORT = Number(process.env.BATCH_SMOKE_PORT || 9381);
const SAMPLE_PORT = Number(process.env.BATCH_SMOKE_SAMPLE_PORT || 9382);
const fails = [];
const { bad, cmp, truthy } = makeReport(fails);

const PART = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);
const runPart = (name) => !PART || PART === name;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, maxMs, msg) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try {
      v = await fn();
    } catch (e) {
      v = null;
    }
    if (v) return v;
    if (Date.now() - t0 > maxMs) throw new Error(msg);
    await sleep(150);
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
      ok({ proc: p, childStderr: stderr });
      return;
    }
    p.on("close", (code) => ok({ code, stdout, stderr }));
    if (o.timeout) setTimeout(() => p.kill(), o.timeout);
  });
}

function exeName() {
  return process.platform === "win32" ? "autostamp-batch-smoke.exe" : "autostamp-batch-smoke";
}

// ---------- PNG 生成（与 apply-smoke 同一套最小编码器）------------------

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// pngRGBA paints an w*h RGBA image where every pixel comes from paint(x,y).
// The IHDR scratch is 17 bytes with the type written first (apply-smoke's
// trick): chunk("IHDR", subarray(4)) yields the exact 13-byte data Go's
// png.Decode demands; a padded 17-byte IHDR data field is rejected.
function pngRGBA(w, h, paint) {
  const ihdr = Buffer.alloc(17);
  ihdr.write("IHDR", 0);
  ihdr.writeUInt32BE(w, 4);
  ihdr.writeUInt32BE(h, 8);
  ihdr[12] = 8; // bit depth
  ihdr[13] = 6; // colour type RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const c = paint(x, y);
      const p = row + 1 + x * 4;
      raw[p] = c[0];
      raw[p + 1] = c[1];
      raw[p + 2] = c[2];
      raw[p + 3] = c[3];
    }
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr.subarray(4)),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}


const INK = [200, 24, 28]; // #c8181c 的印章色
const GROUND = [217, 230, 255];

// ---------- 样本 PDF：CDP Page.printToPDF（与 apply-smoke 同一做法）----

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

// pageHtml mirrors apply-smoke's two-page sample: sibling page divs, the
// break style rides the div itself (Chrome honours it, children may not).
const pageHtml = (pages, ground) =>
  `<body style="margin:0">` +
  Array.from({ length: pages })
    .map((_, i) => {
      const brk = i < pages - 1 ? "page-break-after:always;" : "";
      return `<div style="width:595.3pt;height:841.9pt;background:rgb(${ground.join(",")});${brk}"></div>`;
    })
    .join("") +
  `</body>`;

// ---------- 页面侧驱动 ------------------------------------------------------

// pageEval wraps evaluate with JSON normalisation (same shape as shell-smoke).
function pageEval(app) {
  return async (expr) => {
    const v = await app.evaluate(expr);
    if (typeof v === "string") {
      const t = v.trim();
      if (t.startsWith("{") || t.startsWith("[") || t.startsWith('"') || /^-?\d/.test(t)) return JSON.parse(t);
    }
    return v;
  };
}

// sealPresetViaUI 走真控件：__autoStampSeal.prepare(真链路) -> 填名字 -> 点保存。
async function sealPresetViaUI(app, json, pngB64, name) {
  const saved = await json(`(async () => {
    const bin = atob(${JSON.stringify(pngB64)});
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const file = new File([buf], ${JSON.stringify(name + ".png")}, { type: "image/png" });
    const meta = await window.__autoStampSeal.prepare(file);
    window.__autoStampShell.setSealForSelected(meta.sealId);
    const nameInput = document.querySelector("#seal-preset-name");
    nameInput.value = ${JSON.stringify(name)};
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    return { sealId: meta.sealId };
  })()`);
  truthy("seal prepared for the preset", saved && saved.sealId);
  await app.evaluate(`document.querySelector("#seal-preset-save").click()`);
  await waitFor(
    async () => (await json(`window.__autoStampBatch.probe("presets")`)).some((p) => p.name === name),
    8000,
    `preset "${name}" never appeared in GET /api/seal/preset`,
  );
  // 两个 select 都要镜像到：印章卡 + 批处理卡。
  const opts = await json(`(function () {
    var pick = function (sel) { return [].slice.call(document.querySelectorAll(sel + " option")).map(function (o) { return o.value; }); };
    return { seal: pick("#seal-preset-select"), batch: pick("#batch-preset") };
  })()`);
  cmp("preset listed in both selects", [opts.seal.includes(name), opts.batch.includes(name)], [true, true]);
}

// ---------- 主流程 ------------------------------------------------------

async function main() {
  const exe = join(root, "dist", exeName());
  if (!process.argv.includes("--reuse-build") || !existsSync(exe)) {
    console.log("batch-smoke: building", exeName());
    const b = await run(["go", "build", "-o", join("dist", exeName()), "."]);
    if (b.code !== 0) throw new Error("go build failed:\n" + b.stderr);
  }

  const sandbox = mkdtempSync(join(tmpdir(), "autostamp-batch-smoke-"));
  const env = { ...process.env, APPDATA: join(sandbox, "Roaming"), LOCALAPPDATA: join(sandbox, "Local") };
  const dir = join(sandbox, "docs");
  mkdirSync(dir, { recursive: true });
  const dlDir = join(sandbox, "downloads");
  mkdirSync(dlDir, { recursive: true });


  const pngB64 = pngRGBA(48, 48, () => [INK[0], INK[1], INK[2], 255]).toString("base64");
  // P6 验收形态：20 份可盖（页数不一）+ 1 份加密（encfx 现场生成）+ 1 份故意坏。
  // 失败项不能影响其它项，加密项必须跳过而不是提示密码（BM4）。
  const validSamples = Array.from({ length: 20 }, (_, i) => ({
    name: `b-${String(i + 1).padStart(2, "0")}.pdf`,
    pages: i % 4 === 0 ? 2 : 1,
    ground: i % 3 === 0 ? [255, 255, 255] : GROUND,
  }));
  const specialSamples = [
    { name: "zz-secret.pdf", pages: 1, ground: GROUND },
    { name: "zz-broken.pdf", pages: 0, ground: GROUND },
  ];
  const allSamples = [...validSamples, ...specialSamples];
  {
    const gen = await openChrome({ port: SAMPLE_PORT });
    for (const s of validSamples) {
      writeFileSync(join(dir, s.name), await printPdf(gen, pageHtml(s.pages, s.ground)));
    }
    await gen.close(!process.argv.includes("--keep-profile"));
  }
  // 加密样本：pdfcpu AES-256（tools/verify/encfx），而不是「空页代替」。
  const encfx = spawnSync("go", ["run", "./tools/verify/encfx", join(dir, "zz-secret.pdf"), "secret-open", "secret-owner"], {
    cwd: root, encoding: "utf8",
  });
  if (encfx.status !== 0) throw new Error("encfx failed: " + (encfx.stderr || encfx.stdout));
  // 故意坏的文件：连 %PDF 头都不是。
  writeFileSync(join(dir, "zz-broken.pdf"), Buffer.from("not a pdf at all\n"));

  // 源字节快照：批处理之后必须一字节不动。
  const sha = (p) => createHash("sha1").update(readFileSync(p)).digest("hex");
  const srcBefore = Object.fromEntries(allSamples.map((s) => [s.name, sha(join(dir, s.name))]));

  const { proc } = await run(["dist/" + exeName(), "-no-browser", "-window=false"], { env, detachedChild: true });
  const child = proc;
  let stderrText = "";
  child.stderr.on("data", (d) => (stderrText += d.toString()));
  const url = await waitFor(() => {
    const m = stderrText.match(/url=(http:\/\/127\.0\.0\.1:\d+)/);
    return m ? m[1] : null;
  }, 10000, "server never printed its url:\n" + stderrText);
  console.log("batch-smoke: server", url);

  const app = await openChrome({
    port: APP_PORT,
    url,
    waitFor: "!!(window.__autoStampShell && window.__autoStampBatch && window.__autoStampSeal)",
    diag: "document.readyState + '|' + location.href",
  });
  const json = pageEval(app);

  try {
    // ---------- 段 1：预设库 ----------
    if (runPart("preset")) {
      await sealPresetViaUI(app, json, pngB64, "company-a");

      // 载入：先把面板参数改乱，再点应用，面板必须写回预设值。
      await json(`window.__autoStampShell.setParams({"api.apply.opacity": 0.3, "api.apply.scale": 0.5})`);
      await app.evaluate(`document.querySelector("#seal-preset-load").click()`);
      await waitFor(async () => {
        const f = await json(`window.__autoStampShell.fields()`);
        // scale 的 range 端步长 0.01，0.202 会被钳到 0.2 —— 按面板精度放宽。
        return Math.abs(Number(f["api.apply.opacity"]) - 0.6) < 1e-9 &&
          Math.abs(Number(f["api.apply.scale"]) - 0.202) < 0.011;
      }, 8000, "preset load never wrote the panel parameters back");
      const loaded = await json(`(function () {
        var t = document.querySelector("#error-toast");
        return { open: t.dataset.open === "true", text: t.textContent };
      })()`);
      cmp("preset load toast", [loaded.open, /载入|loaded/i.test(loaded.text)], [true, true]);

      // 删除：点删除 -> 列表清空 -> select 只剩占位项。
      await app.evaluate(`document.querySelector("#seal-preset-delete").click()`);
      await waitFor(async () => (await json(`window.__autoStampBatch.probe("presets")`)).length === 0, 8000, "preset was not deleted");
      const afterDelete = await json(`(function () {
        var pick = function (sel) { return [].slice.call(document.querySelectorAll(sel + " option")).map(function (o) { return o.value; }); };
        return { seal: pick("#seal-preset-select"), batch: pick("#batch-preset") };
      })()`);
      cmp("preset removed from both selects", [afterDelete.seal.includes("company-a"), afterDelete.batch.includes("company-a")], [false, false]);
      console.log("  ok preset segment");
    }

    // ---------- 段 2：批处理跑链 ----------
    if (runPart("batch")) {
      await sealPresetViaUI(app, json, pngB64, "batch-e2e");

      // 目录 + 预设两个必填项（BR6：预设为空不跑）。
      await json(`window.__autoStampShell.setParams({"api.batch.dirPath": ${JSON.stringify(dir)}, "api.batch.presetName": "batch-e2e"})`);
      const fieldsNow = await json(`window.__autoStampShell.fields()`);
      cmp("batch fields backfilled", [fieldsNow["api.batch.dpi"], Number(fieldsNow["api.batch.quality"]), Number(fieldsNow["api.batch.concurrency"])], ["150", 75, 2]);

      // BR6 负例：预设名清空 -> 不跑，只有 toast。
      await json(`window.__autoStampShell.setParams({"api.batch.presetName": ""})`);
      await app.evaluate(`document.querySelector("#batch-start").click()`);
      await sleep(500);
      let queueLen = (await json(`window.__autoStampBatch.probe("queue")`)).length;
      cmp("empty preset refuses to run (BR6)", queueLen, 0);
      await json(`window.__autoStampShell.setParams({"api.batch.presetName": "batch-e2e"})`);

      const dpi = Number((await json(`window.__autoStampShell.fields()`))["api.batch.dpi"]) || 150;
      const quality = Number((await json(`window.__autoStampShell.fields()`))["api.batch.quality"]) || 75;
      // startBatch 是异步的：click() 只触发，队列靠下面的 probe 轮询等。
      await app.evaluate(`document.querySelector("#batch-start").click()`);

      // 等队列跑完（3 个文件，并发 2）。
      await waitFor(async () => {
        const q = await json(`window.__autoStampBatch.probe("queue")`);
        return q.length === allSamples.length && q.every((r) => r.status !== "pending" && r.status !== "running");
      }, 240000, "batch queue never finished");
      const queue = await json(`window.__autoStampBatch.probe("queue")`);
      const report = await json(`window.__autoStampBatch.probe("report")`);
      const okNames = validSamples.map((s) => s.name);
      const expectTotal = validSamples.length + specialSamples.length;
      cmp("batch report counts (P6 acceptance: 20 ok + 1 encrypted + 1 corrupt)",
        [report.total, report.ok, report.failed, report.encrypted],
        [expectTotal, validSamples.length, 1, 1]);
      const byStatus = {};
      for (const r of queue) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      cmp("queue status histogram", Object.entries(byStatus).sort(), [["encrypted", 1], ["fail", 1], ["ok", validSamples.length]]);

      // BM4: the encrypted row is skipped without a password prompt, and the
      // corrupt row fails without dragging the others down.
      const encRow = queue.find((r) => r.status === "encrypted");
      truthy("encrypted row carries password_required", encRow && /password_required|密码/.test(encRow.message || ""), true);
      const failRow = queue.find((r) => r.status === "fail");
      truthy("corrupt row reports a code", failRow && !!failRow.message, true);

      // 磁盘断言：_batch\<名>.dpi<dpi>.q<q>.pdf 存在、页数一致、源未动。
      const outDir = join(dir, "_batch");
      for (const s of validSamples) {
        const out = join(outDir, s.name.replace(/\.pdf$/i, "") + `.dpi${dpi}.q${quality}.pdf`);
        truthy(`output exists: ${s.name}`, existsSync(out));
        if (!existsSync(out)) continue;
        const pageCount = await json(`(async () => {
          const h = { 'content-type': 'application/json', 'X-AutoStamp-Session': sessionStorage.getItem('autostamp.session') };
          const pick = await (await fetch('/api/fs/pick', { method: 'POST', headers: h, body: JSON.stringify({ filePath: ${JSON.stringify(out)}, filter: 'pdf' }) })).json();
          const grant = pick.data.picks[0].pathGrantId;
          const info = await window.__autoStampApi.request('/api/pdf/open', { method: 'POST', body: { pathGrantId: grant } });
          return info.pageCount;
        })()`);
        cmp(`page count matches source (${s.name})`, pageCount, s.pages);
      }
      truthy("no output for the encrypted source", !existsSync(join(outDir, "zz-secret.dpi" + dpi + ".q" + quality + ".pdf")));
      truthy("no output for the corrupt source", !existsSync(join(outDir, "zz-broken.dpi" + dpi + ".q" + quality + ".pdf")));
      cmp("source bytes untouched", Object.fromEntries(allSamples.map((s) => [s.name, sha(join(dir, s.name))])), srcBefore);

      // 报表下载：Blob + a[download]，不发生网络请求。
      await app.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });
      await app.evaluate(`document.querySelector("#batch-export-csv").click()`);
      const csvPath = join(dlDir, "batch-report.csv");
      await waitFor(() => existsSync(csvPath), 8000, "batch-report.csv never downloaded");
      const csv = readFileSync(csvPath, "utf8");
      const lines = csv.trim().split(/\r?\n/);
      cmp("csv header + one row per file", [lines[0], lines.length - 1], ["file,status,output,message", expectTotal]);
      const batchRows = lines.slice(1).filter((l) => l.includes("_batch"));
      cmp("only ok rows carry an output path", batchRows.length, validSamples.length);
      await app.evaluate(`document.querySelector("#batch-export-json").click()`);
      const jsonPath = join(dlDir, "batch-report.json");
      await waitFor(() => existsSync(jsonPath), 8000, "batch-report.json never downloaded");
      const reportJson = JSON.parse(readFileSync(jsonPath, "utf8"));
      cmp("json report files", reportJson.files.length, expectTotal);
      console.log("  ok batch segment");
    }

    // The two failing fixtures (encrypted + corrupt) each post one open request
    // that answers 400 by design: that is the fixture, not a regression.
    const open400 = (f) => f.includes("/api/pdf/open") && f.includes("400");
    cmp("expected 400s from the two failing fixtures", app.failures.filter(open400).length, 2);
    const unexpected = app.failures.filter((f) => !open400(f));
    if (unexpected.length) bad(`失败请求 ${unexpected.length}, want 0: ${unexpected.join(" | ")}`);
    const noise = (e) => e.includes("/api/pdf/open") && e.includes("400");
    const realErrors = app.errors.filter((e) => !noise(e));
    if (realErrors.length) bad(`页面 console error = ${realErrors.length}, want 0: ${realErrors.join(" | ")}`);
  } finally {
    await app.close(!process.argv.includes("--keep-profile"));
    child.kill();
    if (!process.argv.includes("--keep-profile")) rmSync(sandbox, { recursive: true, force: true, maxRetries: 6 });
  }

  if (fails.length) {
    console.error("batch-smoke: FAILED");
    fails.forEach((f) => console.error(" - " + f));
    process.exit(1);
  }
  console.log("batch-smoke: ok");
}

main().catch((e) => {
  console.error("batch-smoke: crash", e && e.stack ? e.stack : e);
  process.exit(1);
});
