#!/usr/bin/env node
// tools/verify/shell-smoke.mjs — behavioural check of the served P0/P1 shell.
//
// Unlike ui-smoke.mjs (which checks the design artifact docs/ui/mockup.html
// from a file:// URL), this one starts the real binary, serves the embedded
// front-end over the loopback origin, and drives it with headless Chrome.
// That is the only way to prove the CSP, the static asset chain, the /api
// round-trip and the shell state machine actually work together.
//
// Checks:
//   * the shell loads with 0 console errors and no failed subresource
//   * every docs/UI_SPEC.md §6 contract id exists, and every UI_SPEC §2 field
//     is represented by a data-field control (plus the reverse check)
//   * every data-i18n key resolves to non-empty en + cn text
//   * density modes, deep-link states (#crosspage), and ?lang=cn
//   * 1280x720 and 1440x900 stay free of horizontal overflow
//   * settings round-trip: the shell's PATCH is visible in GET /api/settings,
//     an out-of-range value is clamped and echoed back as a toast warning
//   * the unimplemented /api/pdf/save route surfaces the router's status reply
//     (no fake success), and the toast is announced to AT (role=status)
//
// Usage: node tools/verify/shell-smoke.mjs [--reuse-build] [--keep-profile]
// Exit: 0 = pass.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openChrome, makeReport } from "./cdp.mjs";

const root = resolve(join(fileURLToPath(import.meta.url)), "..", "..", "..");
const CDP_PORT = Number(process.env.SHELL_SMOKE_PORT || 9334);
const fails = [];
const { bad, cmp, truthy } = makeReport(fails);

const spec = readFileSync(join(root, "docs", "UI_SPEC.md"), "utf8").replace(/\r\n/g, "\n");
const contractIds = (spec.match(/```ui-ids\n([\s\S]*?)```/) || [])[1]
  .trim()
  .split(/\s+/)
  .filter(Boolean);
const fieldLines = (spec.match(/```ui-fields\n([\s\S]*?)```/) || [])[1]
  .trim()
  .split(/\n/)
  .map((l) => Object.fromEntries(l.split(/\s+/).map((kv) => kv.split("="))))
  .filter((r) => r.field);

// section returns the body of "## <title>" up to the next "## " heading.
function specSection(title) {
  const at = spec.indexOf("\n## " + title);
  if (at < 0) throw new Error("UI_SPEC section not found: " + title);
  const rest = spec.slice(at + 1);
  const next = rest.indexOf("\n## ", 1);
  return next < 0 ? rest : rest.slice(0, next);
}
// i18nKeys pulls the key column from the UI_SPEC 4 table.
const i18nSpecKeys = new Set(
  (specSection("4.") + "")
    .split(/\n/)
    .map((l) => (l.match(/^\|([a-z][\w.]*)\|/i) || [])[1])
    .filter((k) => k && k.includes("."))
);

function exeName() {
  return process.platform === "win32" ? "autostamp-shell-smoke.exe" : "autostamp-shell-smoke";
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

async function main() {
  const exe = join(root, "dist", exeName());
  if (!existsSync(exe) || !process.argv.includes("--reuse-build")) {
    if (!process.argv.includes("--reuse-build")) {
      console.log("shell-smoke: building", exeName());
      const b = await run(["go", "build", "-o", join("dist", exeName()), "."]);
      if (b.code !== 0) throw new Error("go build failed:\n" + b.stderr);
    }
  }

  // Isolate the settings/session directories so a verify run never touches the
  // real %APPDATA%\AutoStamp (the acceptance run would otherwise rewrite the
  // user's settings.json).
  const sandbox = mkdtempSync(join(tmpdir(), "autostamp-shell-smoke-"));
  const env = { ...process.env, APPDATA: join(sandbox, "Roaming"), LOCALAPPDATA: join(sandbox, "Local") };

  const { proc } = await run(["dist" + "/" + exeName(), "-no-browser", "-window=false"], { env, detachedChild: true });
  const child = proc;
  let stderrText = "";
  child.stderr.on("data", (d) => (stderrText += d.toString()));

  const url = await waitFor((() => {
    const m = stderrText.match(/url=(http:\/\/127\.0\.0\.1:\d+)/);
    return m ? m[1] : null;
  }), 8000, "server never printed its url:\n" + stderrText);

  console.log("shell-smoke: server", url);

  // health must report the identity the front-end checks
  const health = await getJSON(url + "/api/health");
  cmp("health name", health.data.name, "autostamp");
  truthy("health version", !!health.data.version);

  const chrome = await openChrome({
    port: CDP_PORT,
    url,
    waitFor: "!!(window.__autoStampShell && window.__autoStampShell.STATES)",
    diag: "document.readyState+'|'+location.href+'|'+(window.__autoStampShell?'shell':'none')",
  });
  const evaluate = chrome.evaluate;
  const pageErr = async (expr) => {
    try {
      return await evaluate(expr);
    } catch (e) {
      bad("page eval: " + e.message + " [" + expr.slice(0, 60) + "]");
      console.error("   probe failed:", e.message, "|", expr.slice(0, 100).replace(/\n/g, " "));
      return null;
    }
  };
  // page probes return JSON text (CDP serialises plain values too), so normalise
  // both shapes here instead of at every call site.
  const json = async (expr) => {
    const v = await pageErr(expr);
    if (typeof v === "string") {
      const t = v.trim();
      if (t.startsWith("{") || t.startsWith("[") || t.startsWith('"') || /^-?\d/.test(t)) return JSON.parse(t);
    }
    return v;
  };
  const ids = await pageErr("[...document.querySelectorAll('[id]')].map(function(e){return e.id;})");
  const missingIds = contractIds.filter((id) => !ids.includes(id));
  if (missingIds.length) bad("UI_SPEC §6 ids missing from the shell: " + missingIds.join(" "));
  cmp("UI_SPEC 6 id count matched", contractIds.length, contractIds.filter((id) => ids.includes(id)).length);
  const dupes = await pageErr(`(function () {
    var seen = {};
    var out = [];
    document.querySelectorAll("[id]").forEach(function (el) {
      var id = el.id;
      if (seen[id]) return;
      seen[id] = true;
      if (document.querySelectorAll('[id="' + id.replace(/"/g, "") + '"]').length > 1) out.push(id);
    });
    return out;
  })()`);
  if (dupes && dupes.length) bad("duplicate DOM ids: " + dupes.join(" "));
  const declared = new Set(fieldLines.map((r) => r.field));
  const inPage = new Set(await pageErr("[...document.querySelectorAll('[data-field]')].map(e=>e.getAttribute('data-field'))"));
  const noFieldControls = fieldLines.filter((r) => r.ctl === "yes" && !inPage.has(r.field)).map((r) => r.field);
  if (noFieldControls.length) bad("UI_SPEC §2 fields without a control: " + noFieldControls.join(" "));
  const unknownFields = [...inPage].filter((f) => !declared.has(f));
  if (unknownFields.length) bad("data-field names not in UI_SPEC §2: " + unknownFields.join(" "));
  cmp("model field vocabulary size", declared.size, fieldLines.length);

  // slider <-> number pairing
  const pairsData = await json(`(function(){
    var out = {};
    ["api.apply.opacity","api.apply.scale","api.apply.rotation","api.apply.startOffset","api.export.quality"].forEach(function(f){
      var els = [].slice.call(document.querySelectorAll('[data-field="' + f + '"]'));
      var range = els.filter(function(e){ return e.type === "range"; })[0];
      var num = els.filter(function(e){ return e.type === "number"; })[0];
      var step = Number(range.step) || 1;
      var mid = Math.round(((Number(range.min) + Number(range.max)) / 2) / step) * step;
      range.value = String(mid);
      range.dispatchEvent(new Event("input"));
      var forward = Number(num.value) === mid;
      num.value = String(mid + step);
      num.dispatchEvent(new Event("input"));
      out[f] = { pair: els.length, mid: mid, forward: forward, backward: Number(range.value) === mid + step };
    });
    return JSON.stringify(out);
  })()`);
  for (const [f, v] of Object.entries(pairsData || {})) {
    if (v.pair !== 2) bad(`${f}: slider+number pair count = ${v.pair}`);
    if (!v.forward || !v.backward) bad(`${f}: slider/number are not two-way bound (${JSON.stringify(v)})`);
  }
  console.log("  ok slider/number two-way bound =", Object.keys(pairsData || {}).join(","));

  // grouped 16-mode blend select
  const blend = await json(`(function(){
    var sel = document.querySelector("#apply-blend");
    var seen = {};
    var dup = [];
    [].slice.call(sel.options).forEach(function(o){ if (seen[o.value]) dup.push(o.value); seen[o.value] = 1; });
    return JSON.stringify({
      groups: [].slice.call(sel.querySelectorAll("optgroup")).length,
      modes: [].slice.call(sel.options).length,
      value: sel.value,
      dup: dup,
    });
  })()`);
  if (blend.groups < 5 || blend.modes !== 16) bad("blend select = " + JSON.stringify(blend));
  if (blend.dup.length) bad("duplicate blend options: " + blend.dup.join(" "));

  // ---------- state machine + deep link ----------
  const states = await pageErr("window.__autoStampShell.STATES");
  cmp("UI_SPEC 1 states", states.length, 12);
  for (const st of states) {
    await evaluate(`window.__autoStampShell.setState(${JSON.stringify(st)})`);
    const r = await pageErr(`window.__autoStampShell.verifyState(${JSON.stringify(st)})`);
    if (!r || !r.ok) bad(`state ${st} unreachable: ${JSON.stringify(r)}`);
  }
  await evaluate("window.__autoStampShell.setState('opened')");
  await evaluate("window.__autoStampShell.setState('stamp-selected')");
  // P1: the stage carries no fake document. app-preview.js renders the first
  // page-frame (canvas + .textLayer) only after POST /api/pdf/open returns a
  // real asset, so an empty stage is the contract, not a missing feature.
  const frames = await pageErr("document.querySelectorAll('#preview-stage .page-frame').length");
  if (frames !== 0) bad(`the shell rendered ${frames} page-frame(s) with no document open`);
  const cross = await pageErr("window.__autoStampShell.setModal('save-modal')");
  if (cross !== "save-modal") bad("setModal failed: " + cross);
  await evaluate("window.__autoStampShell.setModal(null)");

  // ---------- density + i18n + theme ----------
  for (const d of ["two-col", "single-col", "collapsed"]) {
    const got = await pageErr(`window.__autoStampShell.setDensity(${JSON.stringify(d)})`);
    cmp("density " + d, got, d);
  }
  await evaluate("window.__autoStampShell.setDensity('two-col')");
  const widths = await json(`(function(){
    var sb = document.querySelector("#right-sidebar");
    var main = document.querySelector("#app-main");
    return JSON.stringify({
      panel: Math.round(sb.getBoundingClientRect().width),
      hidden: getComputedStyle(sb).display === "none",
      scrollW: main.scrollWidth,
      clientW: main.clientWidth,
    });
  })()`);
  if (widths.panel < 200 || widths.panel > 480) bad("panel width out of range: " + JSON.stringify(widths));
  await evaluate("window.__autoStampShell.setDensity('collapsed')");
  const collapsed = await json(`(function(){
    var sb = document.querySelector("#right-sidebar");
    return JSON.stringify({ hidden: getComputedStyle(sb).display === "none", over: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 });
  })()`);
  if (!collapsed.hidden) bad("collapsed density must hide the panel");
  if (collapsed.over) bad("collapsed density causes horizontal overflow");
  await evaluate("window.__autoStampShell.setDensity('two-col')");

  for (const [w, h] of [[1280, 720], [1440, 900]]) {
    await chrome.setViewport(w, h);
    for (const st of ["empty", "opened", "stamp-selected", "split-preview", "crosspage", "export", "save-confirm", "password-error"]) {
      await evaluate(`window.__autoStampShell.setState(${JSON.stringify(st)})`);
      const over = await evaluate("window.__autoStampShell.probe('overflow')");
      if (over) bad(`${w}x${h} / ${st}: horizontal overflow`);
    }
  }
  await chrome.setViewport(1440, 900);
  await evaluate("window.__autoStampShell.setState('opened')");

  const pairs = await pageErr("window.__autoStampShell.i18nPairs()");
  const emptyTwin = pairs.filter((p) => !p.en || !p.cn);
  if (emptyTwin.length) {
    bad("i18n keys with an empty twin: " + emptyTwin.slice(0, 10).map((p) => `${p.key}(${p.en}|${p.cn})`).join(" "));
  }
  // The catalog is the vocabulary: every UI_SPEC 4 key must be resolvable there
  // (toast/hint keys are used from JS, not always bound to a DOM element), and
  // every key a DOM control registers must come from that vocabulary.
  const catalogKeys = new Set(await pageErr("Object.keys(window.__autoStampI18n.CATALOG)"));
  const domKeys = new Set(pairs.map((p) => p.key));
  const notVocabulary = [...domKeys].filter((k) => !i18nSpecKeys.has(k));
  if (notVocabulary.length) bad("keys used by the shell but missing from UI_SPEC §4: " + notVocabulary.join(" "));
  const noCatalog = [...i18nSpecKeys].filter((k) => !catalogKeys.has(k) && !domKeys.has(k));
  if (noCatalog.length) bad("UI_SPEC §4 keys the shell cannot resolve: " + noCatalog.join(" "));

  // After switching, every text element must show its cn twin and every
  // placeholder its cn twin; a single English leftover is a contract break.
  const renderedWrong = async (lang) => {
    const bad_ = await pageErr(`(function(){
      var out = [];
      var cat = window.__autoStampI18n.CATALOG;
      document.querySelectorAll('[data-i18n]').forEach(function(el){
        var k = el.getAttribute('data-i18n');
        var e = cat[k];
        var want;
        if (e) want = e.${lang};
        else if (${lang} === "cn") want = el.getAttribute('data-i18n-cn');
        else return;
        if (want === null || want === undefined) return;
        if (el.textContent.trim() !== String(want).trim()) out.push(k + " => " + el.textContent.trim());
      });
      return out;
    })()`);
    return bad_;
  };
  await evaluate("window.__autoStampShell.applyLang('cn')");
  const cnWrong = await renderedWrong("cn");
  if (cnWrong && cnWrong.length) bad("cn text not applied: " + cnWrong.slice(0, 8).join(" | "));
  const phWrong = await pageErr(`(function(){
    var cat = window.__autoStampI18n.CATALOG;
    var out = [];
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el){
      var k = el.getAttribute('data-i18n-placeholder');
      var e = cat[k];
      var want = e ? e.cn : el.getAttribute('data-i18n-cn-placeholder');
      if (want === null || want === undefined) return;
      if (el.getAttribute('placeholder') !== want) out.push(k);
    });
    return out;
  })()`);
  if (phWrong && phWrong.length) bad("cn placeholder not applied: " + phWrong.join(" "));
  await evaluate("window.__autoStampShell.applyLang('en')");
  const enWrong = await renderedWrong("en");
  if (enWrong && enWrong.length) bad("en text not restored: " + enWrong.slice(0, 8).join(" | "));
  truthy("i18n catalog has " + domKeys.size + " keys loaded", (await pageErr("window.__autoStampI18n.keys.length")) >= domKeys.size);
  await evaluate("window.__autoStampShell.applyLang('cn')");

  const themeTokens = await json(`(function(){
    var out = {};
    ["light","dark"].forEach(function(t){
      window.__autoStampShell.applyTheme(t);
      var cs = getComputedStyle(document.documentElement);
      out[t] = cs.getPropertyValue("--surface").trim();
    });
    window.__autoStampShell.applyTheme("light");
    return JSON.stringify(out);
  })()`);
  if (themeTokens.light === themeTokens.dark) bad("theme tokens did not switch: " + JSON.stringify(themeTokens));

  // ---------- settings round-trip (real /api) ----------
  await evaluate("window.__autoStampShell.applyLang('cn')");
  await new Promise((r) => setTimeout(r, 400));
  const persisted = await getJSON(url + "/api/settings");
  cmp("shell wrote ui.lang through POST /api/settings", persisted.data.settings.ui.lang, "cn");
  cmp("shell wrote ui.density", persisted.data.settings.ui.density, "two-col");
  cmp("shell wrote theme", persisted.data.settings.ui.theme, "light");

  // Out-of-range value must be clamped server-side and warned in the UI.
  await evaluate(`window.__autoStampShell.setParams({"api.export.customDpi": 9000})`);
  await new Promise((r) => setTimeout(r, 400));
  const clampToast = await json("window.__autoStampShell.probe('toast')");
  if (!clampToast.open || clampToast.level !== "warn") bad("clamp warning toast missing: " + JSON.stringify(clampToast));
  if (!/customDpi/.test(clampToast.text)) bad("toast must name the clamped field, got: " + clampToast.text);
  const clamped = await getJSON(url + "/api/settings");
  cmp("out-of-range customDpi clamped to 600", clamped.data.settings.export.customDpi, 600);

  // crosspage: binding=none must clear apply.crossPage (D2 invariant)
  const cp = await json(`(function(){
    var s = window.__autoStampShell;
    s.setParams({"api.apply.crossPage": true});
    document.querySelector("#crosspage-binding button[data-value='none']").click();
    var f = s.fields();
    return JSON.stringify({ cross: f["api.apply.crossPage"], binding: f["ui.crosspage.binding"], state: s.probe("state") });
  })()`);
  cmp("binding=none clears apply.crossPage (D2)", cp, { cross: false, binding: "none", state: "opened" });
  const fixedToast = await json("window.__autoStampShell.probe('toast')");
  if (fixedToast.level !== "warn") bad("binding=none must warn, got " + JSON.stringify(fixedToast));

  // instance list (decision I1)
  const inst = await pageErr(`(function(){
    var s = window.__autoStampShell;
    var before = s.probe("instanceCount");
    s.addInstance("A");
    s.duplicateSelected();
    var mid = s.probe("instanceCount");
    var selected = s.probe("selected");
    s.deleteSelected();
    var afterDel = s.probe("instanceCount");
    while (s.probe("instanceCount") > 1) s.deleteSelected();
    var lastDelete = s.deleteSelected();
    return JSON.stringify({ before: before, mid: mid, afterDel: afterDel, lastDelete: lastDelete, one: s.probe("instanceCount"), names: s.probe("instances").map(function(i){return i.name;}) });
  })()`);
  const instData = JSON.parse(inst);
  if (instData.mid !== instData.before + 2) bad("instance add/duplicate: " + inst);
  if (instData.afterDel !== instData.mid - 1) bad("instance delete: " + inst);
  if (instData.one !== 1) bad("last instance must survive deletion: " + inst);
  if (instData.lastDelete !== null) bad("deleting the last instance must be refused, got " + instData.lastDelete);

  // ---------- routes that do not exist yet must not fake success ----------
  const saveFail = await pageErr(`(function(){
    var s = window.__autoStampShell;
    s.setParams({"api.save.targetPath": "C:/nope/x.pdf"});
    return s.setModal("save-modal");
  })()`);
  if (saveFail !== "save-modal") bad("save modal: " + saveFail);
  await evaluate(`document.querySelector("#save-confirm").click()`);
  await new Promise((r) => setTimeout(r, 600));
  const saveToast = await json("window.__autoStampShell.probe('toast')");
  if (!saveToast.open || saveToast.level !== "error") bad("/api/pdf/save must surface a real error toast: " + JSON.stringify(saveToast));
  if (!/405/.test(saveToast.text)) bad("the save toast must carry the router's status reply verbatim, got: " + saveToast.text);
  const toastSemantics = await json(`(function(){
    var t = document.querySelector("#error-toast");
    return { role: t.getAttribute("role"), live: t.getAttribute("aria-live") };
  })()`);
  cmp("toast is announced to assistive tech", toastSemantics, { role: "status", live: "polite" });

  const modalSemantics = await json(`(function(){
    var out = {};
    ["save-modal","confirm-modal","password-modal","shortcuts-modal"].forEach(function(id){
      var m = document.querySelector("#"+id);
      out[id] = { role: m.getAttribute("role"), modal: m.getAttribute("aria-modal") };
    });
    return out;
  })()`);
  for (const [id, v] of Object.entries(modalSemantics)) {
    if (v.role !== "dialog" || v.modal !== "true") bad(`${id} is not an announced dialog: ${JSON.stringify(v)}`);
  }
  await evaluate("window.__autoStampShell.setModal(null)");

  // shortcuts: Ctrl+S must open the save dialog, Esc must close it
  const keys = await pageErr(`(function(){
    var s = window.__autoStampShell;
    function press(key, opt) {
      document.dispatchEvent(new KeyboardEvent("keydown", Object.assign({key: key, bubbles: true, cancelable: true}, opt||{})));
    }
    press("s", {ctrlKey: true});
    var opened = s.probe("modal");
    var state = s.probe("state");
    press("Escape");
    var closed = s.probe("modal");
    press("?");
    var shortcuts = s.probe("modal");
    var rows = document.querySelectorAll("#shortcuts-table tr").length;
    press("Escape");
    return { opened: opened, state: state, closed: closed, shortcuts: shortcuts, rows: rows };
  })()`);
  cmp("Ctrl+S opens the save dialog (S1)", { opened: keys.opened, state: keys.state, closed: keys.closed, shortcuts: keys.shortcuts }, {
    opened: "save-modal",
    state: "save-confirm",
    closed: "",
    shortcuts: "shortcuts-modal",
  });
  if (keys.rows < 7) bad(`shortcuts table rows = ${keys.rows}, want >= 7 (UI_SPEC §5)`);

  // deep link: #crosspage re-runs the state machine (UI_SPEC §7)
  await evaluate("window.__autoStampShell.setModal(null); window.__autoStampShell.setState('opened'); location.hash = 'crosspage';");
  await new Promise((r) => setTimeout(r, 250));
  const deep = await json("window.__autoStampShell.probe('state')");
  cmp("deep link #crosspage -> crosspage", deep, "crosspage");
  await evaluate("location.hash = '';");

  const version = await pageErr("window.__autoStampShell.probe('version')");
  truthy("topbar shows the health version", /autostamp/.test(version));

  // The save click below is deliberate: /api/pdf/save is unwired until P4, so
  // its non-2xx reply is the behaviour asserted above, not an incidental error.
  const deliberate = (e) => /\/api\/pdf\/save/.test(e);
  const unexpectedErrors = chrome.errors.filter((e) => !deliberate(e));
  const unexpectedFailures = chrome.failures.filter((e) => !deliberate(e));
  if (unexpectedErrors.length) bad("console errors: " + unexpectedErrors.join(" | "));
  if (unexpectedFailures.length) bad("resource failures: " + unexpectedFailures.join(" | "));
  if (!chrome.failures.some(deliberate)) bad("the deliberate POST /api/pdf/save never reached the network");

  await chrome.close(process.argv.includes("--keep-profile"));
  child.kill();
  rmSync(sandbox, { recursive: true, force: true });

  console.log(`shell-smoke: ids=${ids.length} fields=${declared.size} states=${states.length} consoleErrors=${chrome.errors.length}`);
  if (fails.length) {
    console.error("--- FAILURES ---");
    fails.forEach((f) => console.error("  " + f));
    console.error(`shell-smoke: ${fails.length} failure(s)`);
    return 1;
  }
  console.log("shell-smoke: OK");
  return 0;
}

async function getJSON(url) {
  const res = await fetch(url);
  return res.json();
}

async function waitFor(fn, maxMs, failMsg) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > maxMs) throw new Error(failMsg);
    await new Promise((r) => setTimeout(r, 120));
  }
}

let code = 0;
try {
  code = await main();
} catch (e) {
  console.error("shell-smoke: FATAL", e && e.message ? e.stack || e.message : e);
  code = 1;
}
process.exit(code);
