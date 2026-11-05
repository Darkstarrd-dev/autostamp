#!/usr/bin/env node
// tools/verify/apply-smoke.mjs — P4 落盘链路的数值验收(AGENTS §8;IMPLEMENTATION_PLAN P4 验收)。
//
// 四段(缺省全跑,`--only=<name>` 单跑):
//   matrix 真链路桥 + 回读一致性:open -> seal/prepare -> 实例 -> `盖到 PDF` ->
//          落盘后的 asset 交给 pdf.js **重新渲染**,取样像素必须等于同一对颜色在
//          同族渲染器里独立 blend 的参考值(16 模式 x {1.0,0.6,0.3},absdiff <= 2)。
//          预览侧的像素等值性由 pixel-matrix.mjs 钉死,这里钉的是落盘侧。
//   strip  骑缝章落盘:两页样本 + 水平双色印章 -> 第 1 页条带取印章左半色、第 2 页
//          取右半色(逐页一条 + 切分顺序),条带贴页边(骑缝语义),bbox 的四条边
//          误差 <= 1 pt(框内是印章、框外 2 pt 是底)。
//   chain  切分 + 落盘 + 保存的资产链:手动 2 拼切分 -> 新 asset(2 页) -> 盖章 ->
//          保存到沙箱路径;磁盘文件能再 fs/pick + open,页数一致。
//   undo   撤销盖章 / 撤销切分:资产 id 换回上一份、实例列表带印章回来、链上 id 归位;
//          无可撤销时是 warn 级 toast 且返回 false。
//
// Usage: node tools/verify/apply-smoke.mjs [--reuse-build] [--keep-profile] [--only=<name>]
// Exit: 0 = pass, 1 = fail.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { openChrome, makeReport } from "./cdp.mjs";

const root = resolve(join(fileURLToPath(import.meta.url)), "..", "..", "..");
const APP_PORT = Number(process.env.APPLY_SMOKE_PORT || 9371);
const SAMPLE_PORT = Number(process.env.APPLY_SMOKE_SAMPLE_PORT || 9372);
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
  return process.platform === "win32" ? "autostamp-apply-smoke.exe" : "autostamp-apply-smoke";
}

// ---------- PNG 生成(颜色必须已知,不能靠仓库 fixture) ------------------

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

// pngRGBA paints an w*h RGBA image where every pixel comes from paint(x,y). The
// IHDR scratch buffer is 17 long because colour type must not be dropped
// (same reason as pixel-matrix.mjs: Go's png.Decode rejects a 12-byte IHDR).
function pngRGBA(w, h, paint) {
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

// ---------- 样本 PDF:CDP Page.printToPDF(与 preview-smoke 同一做法) ----

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
  if (!d.every((v) => Math.abs(v) <= tol)) {
    bad(`${label}: got ${got.join(",")} want ${want.join(",")} (±${tol}, delta ${d.join(",")})`);
  } else {
    console.log(`  ok ${label} = ${got.join(",")} (Δ ${d.join(",")})`);
  }
}

const isClose = (px, c, tol) => [0, 1, 2].every((i) => Math.abs(px[i] - c[i]) <= tol);

const BLEND = [
  "normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn",
  "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity",
];
// canvas 的 globalCompositeOperation 名字:PDF 的 normal 对应 source-over。
const GCO = { normal: "source-over" };

const GROUND = [217, 230, 255]; // 与 pixel-matrix 同一底(FACTS §1.3)
const INK = [200, 24, 28]; // #c8181c 的印章色
// 骑缝印章的两半色:左右两半一眼可辨,才能证明第 1 页拿到左半、第 2 页拿到右半。
const HALF_L = [24, 190, 70];
const HALF_R = [210, 40, 90];

// 实例几何(与面板字段一一对应):tl 锚点 + offset 150,300,印章框的左上角就落在
// 页空间 150,300;取样点必须在框内,避开边界的抗锯齿。
const SAMPLE_X = 190;
const SAMPLE_Y = 340;
const SAMPLE_SPAN = 8;

// 骑缝章几何:scale 0.2、startOffset 40、单面右缘(binding:right)。条带宽 =
// 页宽 x 0.2 / 页数,条带高 = 全框宽 x 印章纵横比(pdfcore StampGeom.Box 的镜像)。
const STRIP_SCALE = 0.2;
const STRIP_START = 40;

// ---------- 打开链 ------------------------------------------------------

async function grantOf(app, filePath) {
  const pick = await app.evaluate(
    `(async () => {
      const h = { 'content-type': 'application/json', 'X-AutoStamp-Session': sessionStorage.getItem('autostamp.session') };
      const r = await fetch('/api/fs/pick', { method: 'POST', headers: h, body: JSON.stringify({ filePath: ${JSON.stringify(filePath)}, filter: 'pdf' }) });
      return { href: location.href, status: r.status, body: await r.json().catch(() => null) };
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

async function prepareSeal(app, pngB64, name, options) {
  const prepared = await app.evaluate(
    `(async () => {
      const bin = atob(${JSON.stringify(pngB64)});
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const file = new File([buf], ${JSON.stringify(name)}, { type: 'image/png' });
      const m = await window.__autoStampSeal.prepare(file, ${JSON.stringify(options)});
      return { sealId: m.sealId, srcWidth: m.srcWidth, srcHeight: m.srcHeight, mime: m.mime };
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

// instanceParams 是一份完整的面板词表(UI_SPEC §2),所以每个实例都从同一组字段
// 出发;字段名就是请求体里的名字,不经过任何私有测试钩子。
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

// ---------- 段 1:回读一致性矩阵 ----------------------------------------

async function checkMatrix(app, grantId, sealId) {
  const rows = await app.evaluate(
    `(async () => {
      const api = window.__autoStampApi, sh = window.__autoStampShell, ov = window.__autoStampOverlay;
      const modes = ${JSON.stringify(BLEND)}, GCO = ${JSON.stringify(GCO)}, INK = ${JSON.stringify(INK)};
      const P = ${JSON.stringify(instanceParams({ blend: "multiply", opacity: 1, scale: 0.15 }))};
      const out = [];
      for (const m of modes) {
        for (const op of [1, 0.6, 0.3]) {
          const info = await api.request('/api/pdf/open', { method: 'POST', body: { pathGrantId: ${JSON.stringify(grantId)} } });
          await sh.adopt(info);
          // 上一轮撤销盖章会把实例带回来;把它们和印章脱钩,本轮才只有「一个」印章。
          sh.state.instances.forEach((i) => { i.sealId = null; });
          const params = Object.assign({}, P, { 'api.apply.blend': m, 'api.apply.opacity': op });
          sh.addInstance('readback', params);
          sh.setSealForSelected(${JSON.stringify(sealId)});
          await new Promise((r) => setTimeout(r, 80));
          // 底像素从**同一份未盖章页面**的渲染里取:落盘侧把它当作 /BM 的目标,
          // 所以参考值必须用它(不是常量底,因为 pdf.js 的取色可能有偏移)。
          const g = ov.sample(${SAMPLE_X}, ${SAMPLE_Y}, ${SAMPLE_SPAN}, ${SAMPLE_SPAN}, 'page').data.slice(0, 3);
          const applied = await sh.stampIntoPDF({ quiet: true });
          if (!applied || !applied.assetId) return { badApply: { m, op, applied } };
          // 回读:preview.open 已把落盘后的 PDF 交给 pdf.js,叠加层此时没有实例
          // (W2),所以画布像素就是「保存 -> 再渲染」的结果。这里显式 redraw 一次:
          // 只有重新渲染才会换画布元素,而叠加层的快照是按画布元素识别的
          // (app-overlay 的 paint -> state.surface);不 redraw 时读到的是上一份
          // 文档的位图 —— 2026-11-02 实测,落盘后的画布整页 0 命中印章色。
          await window.__autoStampPreview.redraw();
          const got = ov.sample(${SAMPLE_X}, ${SAMPLE_Y}, ${SAMPLE_SPAN}, ${SAMPLE_SPAN}, 'composite');
          const ref = document.createElement('canvas');
          ref.width = 8; ref.height = 8;
          const ctx = ref.getContext('2d');
          ctx.filter = 'none';
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = 'rgb(' + g.join(',') + ')';
          ctx.fillRect(0, 0, 8, 8);
          ctx.globalCompositeOperation = GCO[m] || m;
          if (ctx.globalCompositeOperation !== (GCO[m] || m)) return { rejected: m };
          ctx.globalAlpha = op;
          ctx.fillStyle = 'rgb(' + INK.join(',') + ')';
          ctx.fillRect(0, 0, 8, 8);
          const want = Array.from(ctx.getImageData(4, 4, 1, 1).data);
          out.push({ m, op, g, want: want.slice(0, 3), px: got.data.slice(0, 3), alpha: got.data[3] });
          await sh.undoStamping();
        }
      }
      return out;
    })()`
  );
  if (rows && rows.badApply) {
    bad("盖到 PDF 没有回新 asset: " + JSON.stringify(rows.badApply).slice(0, 240));
    return;
  }
  if (rows && rows.rejected) {
    bad(`canvas 拒绝了混合模式名 ${JSON.stringify(rows.rejected)}(渲染族不同源,断言无法进行)`);
    return;
  }
  if (!Array.isArray(rows) || rows.length !== BLEND.length * 3) {
    bad(`回读矩阵没有跑满 ${BLEND.length * 3} 组: ${JSON.stringify(rows).slice(0, 200)}`);
    return;
  }
  let worst = 0;
  let worstLabel = "";
  for (const e of rows) {
    if (e.alpha !== 255) bad(`${e.m} x ${e.op}: 回读 alpha = ${e.alpha}, want 255`);
    const d = [0, 1, 2].map((i) => Math.abs(e.px[i] - e.want[i]));
    if (Math.max(...d) > worst) {
      worst = Math.max(...d);
      worstLabel = `${e.m} x ${e.op}`;
    }
    if (d.some((v) => v > 2)) {
      bad(`回读 ${e.m} x ${e.op}: 落盘渲染 ${e.px.join(",")} != 独立 blend ${e.want.join(",")} (底 ${e.g.join(",")} Δ ${d.join(",")})`);
    }
  }
  console.log(`  ok ${rows.length} 组「落盘 -> pdf.js 回读」与独立 blend 一致(最大 Δ = ${worst} @ ${worstLabel})`);
}

// ---------- 段 2:骑缝章落盘 --------------------------------------------

async function checkStrips(app, grantId, sealId, fixture) {
  const pageW = fixture.pageW;
  const pageCount = fixture.pageCount;
  const aspect = fixture.sealHeight / fixture.sealWidth;
  const stripW = (STRIP_SCALE * pageW) / pageCount;
  const stripH = STRIP_SCALE * pageW * aspect;
  const midY = STRIP_START + stripH / 2;

  const probeAt = (x, y) =>
    `Array.from(window.__autoStampOverlay.sample(${x}, ${y}, 2, 2, 'composite').data).slice(0, 3)`;

  const got = await app.evaluate(
    `(async () => {
      const api = window.__autoStampApi, sh = window.__autoStampShell, p = window.__autoStampPreview;
      const info = await api.request('/api/pdf/open', { method: 'POST', body: { pathGrantId: ${JSON.stringify(grantId)} } });
      await sh.adopt(info);
      sh.state.instances.forEach((i) => { i.sealId = null; });
      sh.addInstance('cross', ${JSON.stringify(
        instanceParams({ blend: "normal", opacity: 1, scale: STRIP_SCALE, offset: "0,0", crossPage: true, startOffset: STRIP_START, binding: "right" })
      )});
      sh.setSealForSelected(${JSON.stringify(sealId)});
      await new Promise((r) => setTimeout(r, 120));
      const applied = await sh.stampIntoPDF({ quiet: true });
      if (!applied || !applied.assetId) return { badApply: true };
      // 定位印章实际落在哪:逐页扫一遍网格(8 pt 步长),把两半色的 bbox 打出来。
      // 失败时这行比断言本身有用 —— 它直接说明落盘几何与条带几何差在哪。
      const HL = ${JSON.stringify(HALF_L)}, HR = ${JSON.stringify(HALF_R)};
      const PAGEW = ${pageW}, PAGEH = ${fixture.pageH};
      const scan = [];
      for (let n = 1; n <= info.pageCount; n++) {
        await p.goTo(n);
        await new Promise((r) => setTimeout(r, 220));
        const box = {};
        for (const key of ["HL", "HR"]) {
          const want = key === "HL" ? HL : HR;
          let minx = null, miny = null, maxx = null, maxy = null, hits = 0;
          for (let y = 0; y <= PAGEH + 4; y += 8) {
            for (let x = 0; x <= PAGEW + 4; x += 8) {
              const d = window.__autoStampOverlay.sample(x, y, 2, 2, "composite").data;
              if (Math.abs(d[0] - want[0]) <= 24 && Math.abs(d[1] - want[1]) <= 24 && Math.abs(d[2] - want[2]) <= 24) {
                hits++;
                if (minx === null) { minx = x; miny = y; }
                maxx = x; maxy = y;
              }
            }
          }
          box[key] = { minx, miny, maxx, maxy, hits };
        }
        scan.push({ page: n, box });
      }
      const read = [];
      for (let n = 1; n <= info.pageCount; n++) {
        await p.goTo(n);
        await new Promise((r) => setTimeout(r, 220));
        read.push({
          page: n,
          // 3.5 pt inwards: the two-half boundary AA sits at the strip's right
          // edge (page edge), so a 2 pt probe flapped across that boundary when
          // the fit-zoom rounding changed (V4 removed the stage padding).
          rightInside: ${probeAt(pageW - 3.5, midY)},
          leftInside: ${probeAt(pageW - stripW + 2.5, midY)},
          leftOutside: ${probeAt(pageW - stripW - 3, midY)},
          insideTop: ${probeAt(pageW - 10, STRIP_START + 1.5)},
          aboveTop: ${probeAt(pageW - 10, STRIP_START - 2)},
          insideBottom: ${probeAt(pageW - 10, STRIP_START + stripH - 1.5)},
          belowBottom: ${probeAt(pageW - 10, STRIP_START + stripH + 2)},
          untouched: ${probeAt(100, STRIP_START + stripH / 2)},
        });
      }
      return { read, chain: sh.probe('chain'), scan };
    })()`
  );
  if (got.scan) {
    got.scan.forEach((s) => {
      console.log(
        `  scan 页 ${s.page}: 左半色 bbox ${s.box.HL.minx === null ? "无" : "[" + s.box.HL.minx + ", " + s.box.HL.miny + "]..[" + s.box.HL.maxx + ", " + s.box.HL.maxy + "]"} (hits ` +
          s.box.HL.hits + "), 右半色 bbox " +
          (s.box.HR.minx === null ? "无" : "[" + s.box.HR.minx + ", " + s.box.HR.miny + "]..[" + s.box.HR.maxx + ", " + s.box.HR.maxy + "]") +
          " (hits " + s.box.HR.hits + ")"
      );
    });
  }
  if (got.badApply) {
    bad("骑缝落盘没有回新 asset");
    return;
  }
  if (!Array.isArray(got.read) || got.read.length !== pageCount) {
    bad("骑缝回读页数不对: " + JSON.stringify(got.read).slice(0, 240));
    return;
  }
  got.read.forEach((r, i) => {
    const want = i === 0 ? HALF_L : HALF_R;
    // 逐页一条 + 切分顺序:拼回正确 = 第 1 页拿左半色,第 2 页拿右半色。
    within(`页 ${r.page} 右缘条带 == 印章${i === 0 ? "左" : "右"}半`, r.rightInside, want, 6);
    if (!isClose(r.leftInside, want, 6)) bad(`页 ${r.page} 条带左边界内 1.5 pt 不是印章(条带过窄)`);
    if (isClose(r.leftOutside, want, 6)) bad(`页 ${r.page} 条带左边界外 2 pt 仍是印章(条带过宽)`);
    if (!isClose(r.insideTop, want, 6)) bad(`页 ${r.page} startOffset 内 1.5 pt 不是印章(下移过多)`);
    if (!isClose(r.aboveTop, GROUND, 6)) bad(`页 ${r.page} startOffset 上方 2 pt 不是底(上边界错): ${r.aboveTop.join(",")}`);
    if (!isClose(r.insideBottom, want, 6)) bad(`页 ${r.page} 条带下边界内 1.5 pt 不是印章(高度错)`);
    if (!isClose(r.belowBottom, GROUND, 6)) bad(`页 ${r.page} 条带下方 2 pt 不是底(过高): ${r.belowBottom.join(",")}`);
    if (!isClose(r.untouched, GROUND, 6)) bad(`页 ${r.page} 框外(页左部)被盖住了: ${r.untouched.join(",")}`);
    if (i > 0) {
      // 两页的条带必须取印章的不同部分:同色 = 同一块切片(顺序错/重复)。
      if (isClose(r.rightInside, got.read[0].rightInside, 8)) bad(`页 ${r.page} 条带色与页 1 相同(切分顺序或重复贴章)`);
    }
  });
  console.log(
    `  ok 骑缝落盘:逐页一条、按切分顺序对应印章左右半、bbox 误差 <= 1 pt ` +
      `(条带宽 ${stripW.toFixed(2)} pt x 高 ${stripH.toFixed(2)} pt,右缘 x ∈ [${(pageW - stripW).toFixed(1)}, ${pageW.toFixed(1)}], y ∈ [${STRIP_START}, ${(STRIP_START + stripH).toFixed(1)}])`
  );
  // W2:落盘后叠加层必须没有实例(否则下一次保存会再盖一次)。
  if (!got.chain || !got.chain.apply) bad("链上没有 apply asset");
  if (got.chain && got.chain.instances.length !== 0) bad(`落盘后实例未清空(W2): ${JSON.stringify(got.chain.instances)}`);
}

// HD11: "stamp on the page you stamp on" — pages word "2" must put ink on
// page 2 *only*; page 1 stays at the backdrop. The readback samples the
// applied asset (stampIntoPDF adopts it), so this proves the disk side too.
async function checkPerPage(app, grantId, sealId) {
  const r = await app.evaluate(
    `(async () => {
      const api = window.__autoStampApi, sh = window.__autoStampShell, p = window.__autoStampPreview;
      const info = await api.request('/api/pdf/open', { method: 'POST', body: { pathGrantId: ${JSON.stringify(grantId)} } });
      await sh.adopt(info);
      sh.state.instances.forEach((i) => { i.sealId = null; });
      const params = ${JSON.stringify(instanceParams({ blend: "normal", opacity: 1, scale: 0.25, offset: "0,0" }))};
      params["api.apply.pages"] = "2"; // HD11: page 2 only
      sh.addInstance('page2', params);
      sh.setSealForSelected(${JSON.stringify(sealId)});
      await new Promise((res) => setTimeout(res, 120));
      const applied = await sh.stampIntoPDF({ quiet: true });
      if (!applied || !applied.assetId) return { badApply: true };
      const px = [];
      for (let n = 1; n <= 2; n++) {
        await p.goTo(n);
        await new Promise((res) => setTimeout(res, 220));
        px.push({
          page: n,
          inside: Array.from(window.__autoStampOverlay.sample(40, 40, 2, 2, 'composite').data).slice(0, 3),
          outside: Array.from(window.__autoStampOverlay.sample(400, 400, 2, 2, 'composite').data).slice(0, 3),
        });
      }
      return { px, chain: sh.probe('chain') };
    })()`
  );
  if (!r || r.badApply) {
    bad("per-page 落盘失败");
    return;
  }
  if (!r.px || r.px.length !== 2) {
    bad(`per-page 取样页数 = ${r.px ? r.px.length : 0}, want 2`);
    return;
  }
  const byPage = new Map(r.px.map((x) => [x.page, x]));
  const p1 = byPage.get(1);
  const p2 = byPage.get(2);
  if (!isClose(p1.inside, GROUND, 6)) bad(`页 1 框内被盖住了(应不落章): ${p1.inside.join(",")}`);
  if (!isClose(p2.inside, INK, 6)) bad(`页 2 框内没有印章色: ${p2.inside.join(",")}`);
  if (!isClose(p1.outside, GROUND, 6)) bad(`页 1 框外被盖住: ${p1.outside.join(",")}`);
  if (!isClose(p2.outside, GROUND, 6)) bad(`页 2 框外被盖住: ${p2.outside.join(",")}`);
  if (!r.chain || !r.chain.apply) bad("链上没有 apply asset");
  if (r.chain && r.chain.instances.length !== 0) bad(`落盘后实例未清空(W2): ${JSON.stringify(r.chain.instances)}`);
  console.log("  ok 逐页落盘:pages=\"2\" 只盖第 2 页、第 1 页保持底");
}
// ---------- 段 3:切分 -> 落盘 -> 保存 ----------------------------------

async function checkChain(app, grantId, sealId, sandbox) {
  const target = join(sandbox, "written-out.pdf").replace(/\\/g, "/");
  const res = await app.evaluate(
    `(async () => {
      const api = window.__autoStampApi, sh = window.__autoStampShell, p = window.__autoStampPreview;
      const info = await api.request('/api/pdf/open', { method: 'POST', body: { pathGrantId: ${JSON.stringify(grantId)} } });
      await sh.adopt(info);
      const before = { id: sh.probe('chain').current, pages: p.probe('pageCount') };
      // 手动 2 拼(面板词表 v2):切点 0.5,rows 1 / cols 2 -> A4 变两份。
      sh.setParam('ui.split.mode', 'v2');
      const cut = await sh.runSplit();
      const afterSplit = { id: sh.probe('chain').split, pages: p.probe('pageCount') };
      const vetoChips = document.querySelectorAll('#split-veto button[data-veto-page]').length;
      // 切完再盖章:印章必须落在切分后的新 asset 上。
      sh.state.instances.forEach((i) => { i.sealId = null; });
      sh.addInstance('after-cut', ${JSON.stringify(instanceParams({ blend: "multiply", opacity: 1, scale: 0.15 }))});
      sh.setSealForSelected(${JSON.stringify(sealId)});
      await new Promise((r) => setTimeout(r, 80));
      const applied = await sh.stampIntoPDF({ quiet: true });
      const chain = sh.probe('chain');
      const saved = await api.request('/api/pdf/save', { method: 'POST', body: { assetId: chain.current, targetPath: ${JSON.stringify(target)} } });
      const grant = await api.request('/api/fs/pick', { method: 'POST', body: { filePath: ${JSON.stringify(target)}, filter: 'pdf' } });
      const gid = (((grant.picks || [])[0] || {}).pathGrantId) || '';
      const reopened = gid ? await api.request('/api/pdf/open', { method: 'POST', body: { pathGrantId: gid } }) : { code: 'no_grant' };
      sh.setParam('ui.split.mode', 'off');
      return { before, afterSplit, cut: Boolean(cut), vetoChips, applied: Boolean(applied), chain, saved, reopened };
    })()`
  );

  if (!res.cut) bad("手动 2 拼切分没有产出新 asset");
  if (res.afterSplit.pages !== res.before.pages * 2) {
    bad(`切分页数应为 ${res.before.pages * 2}, got ${res.afterSplit.pages}`);
  } else {
    console.log(`  ok 切分链:${res.before.pages} 页 -> ${res.afterSplit.pages} 页,split asset ${String(res.afterSplit.id).slice(0, 8)}…`);
  }
  if (res.vetoChips !== 0) bad(`A4 竖排页不该被判定为 2 拼(chips = ${res.vetoChips}, want 0)`);
  else console.log("  ok 已判定页 chip 行为空(A4 竖排不是 2 拼,D3 不用否决)");
  if (!res.applied) bad("切分后的 asset 上盖章失败");
  if (!res.chain.apply || !res.chain.current) bad("链上 apply/current asset 缺失: " + JSON.stringify(res.chain).slice(0, 200));
  if (res.chain.current !== res.chain.apply) bad("当前文档应是落盘后的 asset(W2)");
  truthy("save 回信封", res.saved && res.saved.assetId !== undefined);
  if (!existsSync(target)) bad("磁盘上没有写出文件: " + target);
  else {
    const size = statSync(target).size;
    if (!(size > 1024)) bad(`保存文件过小: ${size}`);
    else console.log(`  ok 保存 -> ${size} B(路由内已 ValidateFile)`);
  }
  if (res.reopened && res.reopened.assetId) {
    if (res.reopened.pageCount !== res.afterSplit.pages) bad(`磁盘文件回读页数 = ${res.reopened.pageCount}, want ${res.afterSplit.pages}`);
    else console.log(`  ok 磁盘文件再 open 页数 = ${res.reopened.pageCount}(切分+盖章都写进了磁盘文件)`);
  } else {
    bad("保存的文件不能再 open: " + JSON.stringify(res.reopened).slice(0, 200));
  }
}

// ---------- 段 4:撤销盖章 ----------------------------------------------

async function checkUndo(app, grantId, sealId) {
  const res = await app.evaluate(
    `(async () => {
      const api = window.__autoStampApi, sh = window.__autoStampShell;
      const info = await api.request('/api/pdf/open', { method: 'POST', body: { pathGrantId: ${JSON.stringify(grantId)} } });
      await sh.adopt(info);
      sh.state.instances.forEach((i) => { i.sealId = null; });
      const n0 = sh.state.instances.length;
      sh.addInstance('undo-me', ${JSON.stringify(instanceParams({ blend: "multiply", opacity: 1, scale: 0.15 }))});
      sh.setSealForSelected(${JSON.stringify(sealId)});
      await new Promise((r) => setTimeout(r, 80));
      const before = { current: sh.probe('chain').current, instances: sh.state.instances.length };
      const applied = await sh.stampIntoPDF();
      const after = sh.probe('chain');
      const toastAfterApply = sh.probe('toast');
      const undone = await sh.undoStamping();
      const back = sh.probe('chain');
      const emptyUndo = await sh.undoStamping();
      const toast = sh.probe('toast');
      return { n0, before, afterApplied: Boolean(applied), after, toastAfterApply, undone, back, emptyUndo, toast };
    })()`
  );
  if (!res.afterApplied) bad("盖到 PDF 失败");
  if (res.after.instances.length !== 0) bad(`落盘后实例应清空(W2): ${JSON.stringify(res.after.instances)}`);
  if (!res.after.apply) bad("链上没有 apply asset");
  if (res.toastAfterApply.level !== "ok") bad(`盖到 PDF 的 toast 不是 ok: ${JSON.stringify(res.toastAfterApply)}`);
  if (!res.undone) bad("撤销盖章返回 false");
  if (res.back.current !== res.before.current) bad(`撤销盖章没有换回上一份 asset: ${res.before.current} -> ${res.back.current}`);
  if (res.back.apply !== "") bad(`撤销后链上 apply id 应清空: ${JSON.stringify(res.back.apply)}`);
  const restored = res.back.instances.filter((i) => i.sealId).length;
  if (restored < 1) bad(`撤销盖章没有恢复带印章的实例: ${JSON.stringify(res.back.instances)}`);
  if (res.emptyUndo !== false) bad("没有可撤销的盖章时应该返回 false");
  if (res.toast.level !== "warn") bad(`无可撤销时应该是 warn 级 toast: ${JSON.stringify(res.toast)}`);
  console.log(`  ok 撤销盖章:asset 换回 ${String(res.back.current).slice(0, 8)}…、实例恢复 ${restored} 个、链上 apply 清空、再撤销 warn`);
}

// ---------- 主流程 ------------------------------------------------------

async function main() {
  const exe = join(root, "dist", exeName());
  if (!process.argv.includes("--reuse-build") || !existsSync(exe)) {
    console.log("apply-smoke: building", exeName());
    const b = await run(["go", "build", "-o", join("dist", exeName()), "."]);
    if (b.code !== 0) throw new Error("go build failed:\n" + b.stderr);
  }

  const sandbox = mkdtempSync(join(tmpdir(), "autostamp-apply-smoke-"));
  const env = { ...process.env, APPDATA: join(sandbox, "Roaming"), LOCALAPPDATA: join(sandbox, "Local") };
  const dir = join(sandbox, "samples");
  mkdirSync(dir, { recursive: true });

  const solidB64 = pngRGBA(48, 48, () => [INK[0], INK[1], INK[2], 255]).toString("base64");
  // 双色印章:左半 24 列 HALF_L、右半 24 列 HALF_R -> 切分顺序能用颜色分辨。
  const splitB64 = pngRGBA(
    48,
    24,
    (x) => (x < 24 ? [HALF_L[0], HALF_L[1], HALF_L[2], 255] : [HALF_R[0], HALF_R[1], HALF_R[2], 255])
  ).toString("base64");

  const onePage = join(dir, "ground-1p.pdf");
  const twoPage = join(dir, "ground-2p.pdf");
  writeFileSync(onePage, await (async () => {
    const gen = await openChrome({ port: SAMPLE_PORT });
    const buf = await printPdf(
      gen,
      `<body style="margin:0"><div style="width:595.3pt;height:841.9pt;background:rgb(${GROUND.join(",")})"></div></body>`
    );
    await gen.close(!process.argv.includes("--keep-profile"));
    return buf;
  })());
  writeFileSync(twoPage, await (async () => {
    const gen = await openChrome({ port: SAMPLE_PORT });
    const html =
      `<body style="margin:0">` +
      `<div style="width:595.3pt;height:841.9pt;background:rgb(${GROUND.join(",")});page-break-after:always"></div>` +
      `<div style="width:595.3pt;height:841.9pt;background:rgb(${GROUND.join(",")})"></div>` +
      `</body>`;
    const buf = await printPdf(gen, html);
    await gen.close(!process.argv.includes("--keep-profile"));
    return buf;
  })());

  const { proc } = await run(["dist/" + exeName(), "-no-browser", "-window=false"], { env, detachedChild: true });
  const child = proc;
  let stderrText = "";
  child.stderr.on("data", (d) => (stderrText += d.toString()));
  const url = await waitFor(() => {
    const m = stderrText.match(/url=(http:\/\/127\.0\.0\.1:\d+)/);
    return m ? m[1] : null;
  }, 10000, "server never printed its url:\n" + stderrText);
  console.log("apply-smoke: server", url);

  const app = await openChrome({
    port: APP_PORT,
    url,
    waitFor: "!!(window.__autoStampShell && window.__autoStampPreview)",
    diag: "document.readyState + '|' + location.href",
  });

  try {
    const solid = await prepareSeal(app, solidB64, "solid.png", { despill: false, alphaTrim: false, resampleDpi: 300 });
    const splitSeal = await prepareSeal(app, splitB64, "split.png", { despill: false, alphaTrim: false, resampleDpi: 300 });
    if (!solid || !splitSeal) throw new Error("seal/prepare 未就绪");
    await waitSealReady(app, solid.sealId);
    await waitSealReady(app, splitSeal.sealId);

    if (runPart("matrix")) {
      const grant = await grantOf(app, onePage);
      if (!grant) throw new Error("one-page fixture 未授权");
      await checkMatrix(app, grant, solid.sealId);
    }
    if (runPart("strip")) {
      const grant = await grantOf(app, twoPage);
      const info = await openByGrant(app, grant);
      if (!info) throw new Error("two-page fixture 打不开");
      const pages = info.pages || [];
      if (pages.length < 2) bad(`两页样本页数 = ${pages.length}, want 2(printToPDF 分页未生效?)`);
      await checkStrips(app, grant, splitSeal.sealId, {
        pageW: (pages[0] && pages[0].width) || 595.28,
        pageH: (pages[0] && pages[0].height) || 841.89,
        pageCount: info.pageCount || pages.length,
        sealWidth: splitSeal.srcWidth,
        sealHeight: splitSeal.srcHeight,
      });
      cmp("两页样本的 seal 纵横比来源", splitSeal.srcWidth > 0, true);
    }
    if (runPart("perpage")) {
      const grant = await grantOf(app, twoPage);
      if (!grant) throw new Error("two-page fixture 未授权");
      await checkPerPage(app, grant, solid.sealId);
    }
    if (runPart("chain")) {
      const grant = await grantOf(app, onePage);
      if (!grant) throw new Error("one-page fixture 未授权");
      await checkChain(app, grant, solid.sealId, sandbox);
    }
    if (runPart("undo")) {
      const grant = await grantOf(app, onePage);
      if (!grant) throw new Error("one-page fixture 未授权");
      await checkUndo(app, grant, solid.sealId);
    }
    if (app.errors.length) {
      app.errors.forEach((e) => console.error("   console error:", e.text));
      bad(`页面 console error = ${app.errors.length}, want 0`);
    }
    if (app.failures.length) {
      app.failures.forEach((f) => console.error("   request fail:", f.url, f.status));
      bad(`失败请求 ${app.failures.length}, want 0`);
    }
  } finally {
    await app.close(!process.argv.includes("--keep-profile"));
    child.kill();
    if (!process.argv.includes("--keep-profile")) rmSync(sandbox, { recursive: true, force: true, maxRetries: 6 });
  }

  if (fails.length) {
    console.error("apply-smoke: FAILED");
    fails.forEach((f) => console.error(" - " + f));
    process.exit(1);
  }
  console.log("apply-smoke: ok");
}

main().catch((e) => {
  console.error("apply-smoke: crash", e && e.stack ? e.stack : e);
  process.exit(1);
});
