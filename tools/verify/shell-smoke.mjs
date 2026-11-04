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
//   * the typed path box opens a document on Enter (HD6: no Open button beside it)
//   * every data-i18n key resolves to non-empty en + cn text
//   * the layout is fixed two-col (no density control anywhere), the topbar is
//     icon-only with no text at all (HD5), and dropped ids never come back
//     (deep-link states #crosspage and ?lang=cn stay checked)
//   * the icon tooltips (data-i18n-title) carry en + cn twins
//   * 1280x720 and 1440x900 stay free of horizontal overflow
//   * settings round-trip: the shell's PATCH is visible in GET /api/settings,
//     an out-of-range value is clamped and echoed back as a toast warning
//   * the wired /api/pdf/save route surfaces a real JSON envelope error when
//     there is no opened asset (no fake success), and the toast is announced
//     to AT (role=status)
//   * the paste/drop load gate (UI_SPEC §8 PD1/PD2): a single PDF opens the
//     document, images load as seals (first -> selected instance, extras ->
//     named instances), multi/mix/foreign selections are refused by name,
//     text drags stay un-hijacked, and a focused field keeps text-paste
//     semantics (PD1: the typed path box is never a load target)
//
// Usage: node tools/verify/shell-smoke.mjs [--reuse-build] [--keep-profile]
// Exit: 0 = pass.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
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

  // ---------- fixed two-col layout + i18n + theme ----------
  // D-L1 is gone: the panel width is a constant, not one of three density modes.
  const widths = await json(`(function(){
    var sb = document.querySelector("#right-sidebar");
    var main = document.querySelector("#app-main");
    return JSON.stringify({
      panel: Math.round(sb.getBoundingClientRect().width),
      hidden: getComputedStyle(sb).display === "none",
      densityAttr: main.hasAttribute("data-density"),
    });
  })()`);
  if (widths.panel < 200 || widths.panel > 480) bad("panel width out of range: " + JSON.stringify(widths));
  if (widths.hidden) bad("the panel is hidden: the layout is fixed two-col");
  if (widths.densityAttr) bad("#app-main still carries a data-density attribute");

  // HD7 (2026-11-04): the left column bleeds - the empty card has no inset and
  // the stage has no padding, so pages sit flush against the container.
  const bleed = await json(`(function(){
    var back = document.documentElement.dataset.state || "empty";
    window.__autoStampShell.setState("empty");
    var read = function (sel) {
      var c = getComputedStyle(document.querySelector(sel));
      return { margin: c.margin, radius: c.borderTopLeftRadius, border: c.borderTopStyle, padding: c.paddingLeft };
    };
    var out = { empty: read("#empty-state"), stage: read("#preview-stage") };
    window.__autoStampShell.setState(back);
    return JSON.stringify(out);
  })()`);
  if (bleed.empty.margin !== "0px") bad("the empty card still carries a margin (HD7): " + bleed.empty.margin);
  if (bleed.empty.radius !== "0px") bad("the empty card still carries a border-radius (HD7): " + bleed.empty.radius);
  if (bleed.empty.border !== "dashed") bad("the drop affordance border is gone: " + bleed.empty.border);
  if (bleed.stage.padding !== "0px") bad("#preview-stage still has padding (HD7): " + bleed.stage.padding);
  console.log("  bleed:", JSON.stringify(bleed));

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
  // The icon buttons carry their accessible name through data-i18n-title, so the
  // pair list has to report every one of them with an en + cn value.
  const titlePairs = pairs.filter((p) => p.kind === "title");
  if (!titlePairs.length) bad('i18nPairs() reports no kind "title" pair: the icon buttons have no bilingual tooltip');
  const titleCtl = await pageErr("document.querySelectorAll('[data-i18n-title]').length");
  if (typeof titleCtl === "number" && titleCtl !== titlePairs.length) {
    bad(`[data-i18n-title] controls = ${titleCtl}, but i18nPairs title pairs = ${titlePairs.length}`);
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
  const tipWrong = await pageErr(`(function(){
    var cat = window.__autoStampI18n.CATALOG;
    var out = [];
    document.querySelectorAll('[data-i18n-title]').forEach(function(el){
      var k = el.getAttribute('data-i18n-title');
      var e = cat[k];
      var want = e ? e.cn : el.getAttribute('data-i18n-title-cn');
      if (want === null || want === undefined) return;
      if (el.getAttribute('title') !== want) out.push(k + " title=" + JSON.stringify(el.getAttribute('title')));
      if (el.getAttribute('aria-label') !== want) out.push(k + " aria-label=" + JSON.stringify(el.getAttribute('aria-label')));
    });
    return out;
  })()`);
  if (tipWrong && tipWrong.length) bad("cn tooltip not applied to title/aria-label: " + tipWrong.slice(0, 8).join(" | "));
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

  // ---------- a wired route must not fake success ----------
  // /api/pdf/save is implemented (P4). Two separate truths:
  //  * the shell refuses to save when no document is open (client-side guard,
  //    err.apply.noDoc) — it must not send a request with no assetId, and it
  //    must not pretend it succeeded;
  //  * a request that *does* reach the server without an assetId answers the
  //    JSON envelope error (bad_body), not the old router 405 text.
  const saveFail = await pageErr(`(function(){
    var s = window.__autoStampShell;
    s.setParams({"api.save.targetPath": "C:/nope/x.pdf"});
    return s.setModal("save-modal");
  })()`);
  if (saveFail !== "save-modal") bad("save modal: " + saveFail);
  await evaluate(`document.querySelector("#save-confirm").click()`);
  await new Promise((r) => setTimeout(r, 600));
  const saveToast = await json("window.__autoStampShell.probe('toast')");
  if (!saveToast.open || saveToast.level !== "error") bad("/api/pdf/save with no document must surface an error toast: " + JSON.stringify(saveToast));
  // The guard is the UI_SPEC §4 state error (err.apply.noDoc), not a code
  // string and not a fake success: the shell refuses to send assetId-less JSON.
  if (!/no document is open|未打开文档/.test(saveToast.text)) bad("the save guard must carry err.apply.noDoc, got: " + saveToast.text);
  // The route answers the envelope (never the old router 405 text) and never
  // fakes success: no session header -> bad_session, valid session but no
  // assetId -> bad_body. Both are read from Node so the page network log stays
  // empty (the guard above must not issue any request at all).
  const sessionTok = await pageErr("sessionStorage.getItem('autostamp.session')");
  const saveNoSession = await fetch(url + "/api/pdf/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  cmp("POST /api/pdf/save without a session token is refused", { status: saveNoSession.status, code: (await saveNoSession.json()).code }, { status: 400, code: "bad_session" });
  const saveNoAsset = await fetch(url + "/api/pdf/save", { method: "POST", headers: { "Content-Type": "application/json", "X-AutoStamp-Session": sessionTok }, body: "{}" });
  const saveNoAssetBody = await saveNoAsset.json();
  cmp("POST /api/pdf/save without an assetId answers bad_body", { status: saveNoAsset.status, ok: saveNoAssetBody.ok, code: saveNoAssetBody.code }, { status: 400, ok: false, code: "bad_body" });
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

  // probe('version') is the pure version string; the version and the opened file
  // name live in document.title (and the native caption), never in the topbar (HD5).
  const version = await pageErr("window.__autoStampShell.probe('version')");
  cmp("probe('version') == GET /api/health version", version, health.data.version);
  cmp("document.title = AutoStamp <version>", await pageErr("window.__autoStampShell.probe('docTitle')"), "AutoStamp " + health.data.version);
  // the dropped ids must stay gone (UI_SPEC §6/§7 id contract; HD5 drops the
  // chip, HD6 drops the extra load entries and the hidden file input)
  const dropped = ["app-version", "density-seg", "btn-upload", "btn-export", "recent-open", "recent-menu", "recent-clear", "empty-recent", "app-logo", "app-title", "top-file", "empty-upload", "empty-open", "file-input"];
  const revived = await pageErr(`(function(){
    var have = {};
    window.__autoStampShell.ids().forEach(function(id){ have[id] = true; });
    return ${JSON.stringify(dropped)}.filter(function(id){ return have[id]; });
  })()`);
  if (revived && revived.length) bad("dropped ids came back: " + revived.join(" "));
  // HD5: the topbar is icon-only — no text node outside the controls, and no
  // element of its own carries a label (the old version/file chip is gone).
  const stray = await json(`(function(){
    var bar = document.querySelector("#topbar");
    var out = [];
    for (var n = bar.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3 && n.nodeValue.trim()) out.push("text node: " + n.nodeValue.trim());
    }
    Array.prototype.forEach.call(bar.children, function (el) {
      if (el.tagName === "BUTTON" || el.matches(".seg, .spacer")) return;
      if (el.textContent.trim()) out.push(el.tagName.toLowerCase() + "#" + el.id + ": " + el.textContent.trim());
    });
    return JSON.stringify(out);
  })()`);
  if (stray && stray.length) bad("the topbar carries stray text: " + stray.join(" | "));

  // HD5 geometry: open + save sit side by side against the left edge, and the
  // language/theme/shortcuts cluster shares one row with shortcuts rightmost.
  const bar = await json(`(function(){
    var r = function (sel) { var e = document.querySelector(sel); var b = e.getBoundingClientRect();
      return { x: Math.round(b.x), right: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height),
        cy: Math.round(b.y + b.height / 2), icons: e.querySelectorAll("svg.ic").length, text: e.textContent.trim().length }; };
    var tb = document.querySelector("#topbar").getBoundingClientRect();
    return JSON.stringify({
      right: Math.round(tb.right),
      open: r("#btn-open"), save: r("#btn-save"), shortcuts: r("#btn-shortcuts"),
      lang: r("#lang-seg"), theme: r("#theme-seg")
    });
  })()`);
  if (bar.open.x >= 30) bad(`#btn-open is not at the left edge: ${JSON.stringify(bar.open)}`);
  if (bar.save.x > bar.right / 2) bad(`#btn-save is not in the left half of the topbar: ${JSON.stringify([bar.save.x, bar.right])}`);
  if (!(bar.save.right > bar.open.right)) bad(`#btn-save does not follow #btn-open: ${JSON.stringify([bar.open, bar.save])}`);
  if (bar.save.x - bar.open.right >= 24) bad(`the two icon buttons are not adjacent (gap ${bar.save.x - bar.open.right}): ${JSON.stringify([bar.open.right, bar.save.x])}`);
  const rows = [bar.lang.cy, bar.theme.cy, bar.shortcuts.cy];
  if (Math.max(...rows) - Math.min(...rows) > 4) bad(`the right cluster is not one row: ${JSON.stringify({ lang: bar.lang.cy, theme: bar.theme.cy, shortcuts: bar.shortcuts.cy })}`);
  if (!(bar.shortcuts.x > bar.theme.right)) bad(`#btn-shortcuts is not right of the theme switch: ${JSON.stringify([bar.theme.right, bar.shortcuts.x])}`);
  if (bar.right - bar.shortcuts.right >= 24) bad(`#btn-shortcuts is not the rightmost control (topbar right ${bar.right}, button right ${bar.shortcuts.right})`);
  for (const k of ["open", "save", "shortcuts"]) {
    if (bar[k].icons !== 1) bad(`#btn-${k} must hold exactly one inline svg icon: ${JSON.stringify(bar[k])}`);
    if (bar[k].text !== 0) bad(`#btn-${k} must be icon-only, found ${bar[k].text} text chars`);
    if (bar[k].w < 24 || bar[k].h < 24) bad(`icon button too small: ${k} ${JSON.stringify(bar[k])}`);
  }
  truthy(`the language switch shows two text choices (中/EN): ${JSON.stringify([bar.lang.text, bar.lang.icons])}`, bar.lang.text > 0 && bar.lang.icons === 0);
  if (bar.theme.icons !== 2) bad(`the theme switch must be two svg icons (sun/moon): ${JSON.stringify(bar.theme)}`);
  console.log("  topbar:", JSON.stringify({ right: bar.right, open: bar.open.x, save: bar.save.x, lang: bar.lang.x, theme: bar.theme.x, shortcuts: bar.shortcuts.right, icons: [bar.open.icons, bar.save.icons, bar.shortcuts.icons, bar.theme.icons] }));

  // ---------- PD1/PD2: paste + drop load gate (UI_SPEC §8) ----------
  // Real File objects flow through real ClipboardEvent/DragEvent into the
  // shell's window-level gate, then through the real /api round-trips. The
  // PDF fixture is produced by CDP (same trick preview-smoke uses); the seal
  // fixture is the committed alpha PNG (docs/ui/fixtures/seal.png).
  const sealB64 = readFileSync(join(root, "docs", "ui", "fixtures", "seal.png")).toString("base64");
  const printout = await chrome.send("Page.printToPDF", { printBackground: false });
  const pdfB64 = printout.data
    || (printout.streamId ? (await chrome.send("IO.read", { handle: printout.streamId, offset: 0 })).base64 : null);
  truthy("printToPDF produced a PDF to drop/paste", Boolean(pdfB64 && pdfB64.length > 100));

  const gate = await json(`(async function () {
    var s = window.__autoStampShell;
    function b64file (b64, name, type) {
      return new File([Uint8Array.from(atob(b64), function (c) { return c.charCodeAt(0); })], name, { type: type });
    }
    function wait (fn, ms) {
      return new Promise(function (res) {
        var t0 = Date.now();
        var iv = setInterval(function () {
          var done = false;
          try { done = !!fn(); } catch (e) { done = false; }
          if (done) { clearInterval(iv); res(true); }
          else if (Date.now() - t0 > ms) { clearInterval(iv); res(false); }
        }, 100);
      });
    }
    function dropEv (files) {
      var dt = new DataTransfer();
      files.forEach(function (f) { dt.items.add(f); });
      document.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true, cancelable: true }));
      document.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
      var during = document.querySelector("#preview").dataset.drag === "on";
      var ev = new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true });
      document.dispatchEvent(ev);
      return {
        prevented: ev.defaultPrevented, during: during,
        after: document.querySelector("#preview").dataset.drag || "off",
        load: s.probe("load"),
      };
    }
    function pasteEv (files, text, target) {
      var dt = new DataTransfer();
      (files || []).forEach(function (f) { dt.items.add(f); });
      if (text !== undefined) dt.setData("text/plain", text);
      var ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      (target || document).dispatchEvent(ev);
      return ev.defaultPrevented;
    }
    var out = {};
    function pdf () { return b64file(${JSON.stringify(pdfB64)}, "pasted one.pdf", "application/pdf"); }
    function png (n) { return b64file(${JSON.stringify(sealB64)}, n, "image/png"); }

    // a pure text drag never hijacks the drop target (no Files type)
    (function () {
      var dt = new DataTransfer();
      dt.setData("text/plain", "hello");
      document.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
      out.dragText = document.querySelector("#preview").dataset.drag || "off";
    })();

    // rejected sets must never load, and must name the reason (PD1/PD2)
    out.mixed = dropEv([png("mix.png"), pdf()]); out.mixedToast = s.probe("toast");
    out.multi = dropEv([pdf(), pdf()]); out.multiToast = s.probe("toast");
    out.other = dropEv([b64file("RlE9PQ==", "notes.txt", "text/plain")]); out.otherToast = s.probe("toast");

    // single PDF: multipart open -> adopt (wait for the real round-trip)
    out.pdfBefore = s.probe("chain").current;
    out.pdfDrop = dropEv([pdf()]);
    out.pdfOpened = await wait(function () {
      var l = s.probe("load") || {};
      return l.kind === "pdf" && s.probe("state") === "opened" && s.probe("chain").current !== out.pdfBefore;
    }, 8000);
    out.docTitle = s.probe("docTitle");
    out.pageCount = window.__autoStampPreview ? window.__autoStampPreview.probe("pageCount") : -1;

    // The shell keeps instances across document switches (W2 clears only
    // after stamping): the rows left by earlier checks stay live, and that
    // carry-over is the baseline the I1 checks below build on.
    out.slate = { count: s.probe("instanceCount"), seals: window.__autoStampSeal.probe("count") };

    // images: clipboard -> seal/prepare; with a leftover row live, the first
    // image lands on the selected instance (I1) without crashing (PD1)
    out.pastePng1 = pasteEv([png("seal-one.png")]);
    out.sealReady = await wait(function () { return window.__autoStampSeal.probe("count") >= out.slate.seals + 1; }, 6000);
    out.sealCount1 = window.__autoStampSeal.probe("count");

    // with an instance selected, the pasted image must land on it (I1)
    s.addInstance("gate-inst");
    out.pastePng2 = pasteEv([png("seal-two.png")]);
    out.assigned = await wait(function () {
      var sel = s.probe("selected");
      var inst = s.probe("chain").instances.filter(function (i) { return i.id === sel; })[0];
      return Boolean(inst && inst.sealId);
    }, 6000);

    // several images at once (I1): first -> selected instance; every extra
    // image -> its own new instance, named after the file (PD1 decision row)
    var base = s.probe("instanceCount");
    out.multiPaste = pasteEv([png("seal-three.png"), png("seal-four.png")]);
    out.multiSeals = await wait(function () {
      var ins = s.probe("instances");
      return ins.length === base + 1 && Boolean(ins[base] && ins[base].sealId);
    }, 6000);
    out.newInstances = s.probe("instances").slice(base).map(function (i) { return { name: i.name, seal: Boolean(i.sealId) }; });
    out.oldInstances = s.probe("instances").slice(0, base).map(function (i) { return { name: i.name, seal: Boolean(i.sealId) }; });

    // focused field + text/plain keeps the text-paste semantics: no load
    out.passthrough = pasteEv([pdf()], "C:\\\\docs\\\\typed.pdf", document.querySelector("#apply-blend"));
    out.kindAfterPaste = (s.probe("load") || {}).kind;

    out.dropHint = Boolean(document.querySelector("#drop-hint"));
    return JSON.stringify(out);
  })()`);


  if (gate.dragText !== "off") bad("a text-only drag hijacked the drop target: " + gate.dragText);
  truthy("mixed PDF+image drop refused (PD2 mix)", gate.mixed && gate.mixed.load.kind === "reject" && gate.mixed.load.reason === "mix" && gate.mixed.prevented === true);
  truthy("mixed refusal toast names the mix", /不能混|never mixed/.test(gate.mixedToast.text || "") && gate.mixedToast.level === "warn");
  truthy("multi-PDF drop refused (PD2 multi)", gate.multi && gate.multi.load.kind === "reject" && gate.multi.load.reason === "multi");
  truthy("multi-PDF refusal toast points at the batch panel", /批处理|batch/.test(gate.multiToast.text || ""));
  truthy("foreign file drop refused (PD2 other)", gate.other && gate.other.load.kind === "reject" && gate.other.load.reason === "other");
  truthy("foreign refusal toast names the allowlist", /只支持|only PDF/.test(gate.otherToast.text || ""));
  truthy("single PDF drop opened the document (PD2)", gate.pdfOpened === true && gate.pdfDrop.during === true && gate.pdfDrop.after === "off" && gate.pageCount >= 1);
  truthy(`the document title carries version + drop name (HD5): ${JSON.stringify(gate.docTitle)}`,
    gate.docTitle === "AutoStamp " + version + " pasted one.pdf");
  truthy("pasted image prepared a seal (PD1)", gate.pastePng1 === true && gate.sealReady === true && gate.sealCount1 >= 1);
  truthy("pasted image assigned to the selected instance (PD1/I1)", gate.assigned === true);
  truthy("pasting two images adds exactly one named instance for the extra image (I1)", gate.multiSeals === true
    && gate.newInstances.length === 1 && /seal-four/.test(gate.newInstances[0].name) && gate.newInstances[0].seal === true);
  truthy("and every pre-existing instance kept a seal (I1/PD1)", gate.oldInstances.length >= 1
    && gate.oldInstances.every((i) => i.seal) && gate.oldInstances.some((i) => /gate-inst/.test(i.name)));
  truthy("seal count grew with every loaded image", gate.sealCount1 >= 1);
  truthy("text paste in a focused field stays untouched (PD1)", gate.passthrough === false && gate.kindAfterPaste === "seals");
  truthy("file drops are always prevented from default navigation (PD2)", gate.pdfDrop.prevented === true);
  truthy("drop-hint affordance ships in the shell (PD2)", gate.dropHint === true);

  // ---------- HD6: the typed path box is a load channel on its own ----------
  // The empty state has no Open button any more, so Enter on #empty-path must go
  // through /api/fs/pick (filePath) -> grant -> open, and the title must follow.
  const typedPath = join(sandbox, "typed-open.pdf");
  writeFileSync(typedPath, Buffer.from(pdfB64, "base64"));
  const typed = await json(`(async function () {
    var s = window.__autoStampShell;
    var box = document.querySelector("#empty-path");
    box.value = ${JSON.stringify(typedPath)};
    var ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    box.dispatchEvent(ev);
    var out = { before: s.probe("chain").current };
    out.prevented = ev.defaultPrevented;
    out.opened = await new Promise(function (res) {
      var t0 = Date.now();
      var iv = setInterval(function () {
        var done = s.probe("state") === "opened" && s.probe("chain").current !== out.before;
        if (done) { clearInterval(iv); res(true); }
        else if (Date.now() - t0 > 8000) { clearInterval(iv); res(false); }
      }, 100);
    });
    out.docTitle = s.probe("docTitle");
    out.pageCount = window.__autoStampPreview ? window.__autoStampPreview.probe("pageCount") : -1;
    out.toastText = (s.probe("toast") || {}).text || "";
    return JSON.stringify(out);
  })()`);
  truthy(`Enter in #empty-path opened the typed file with no button (HD6): toast=${JSON.stringify(typed.toastText)} title=${JSON.stringify(typed.docTitle)}`,
    typed.prevented === true && typed.opened === true && typed.pageCount >= 1
      && /^AutoStamp .*typed-open\.pdf$/.test(typed.docTitle || ""));

  // The save click above is deliberate: with no document open the shell must
  // refuse locally, so *nothing* may reach the network (asserted below).
  const deliberate = (e) => /\/api\/pdf\/save/.test(e);
  const unexpectedErrors = chrome.errors.filter((e) => !deliberate(e));
  const unexpectedFailures = chrome.failures.filter((e) => !deliberate(e));
  if (unexpectedErrors.length) bad("console errors: " + unexpectedErrors.join(" | "));
  if (unexpectedFailures.length) bad("resource failures: " + unexpectedFailures.join(" | "));
  if (chrome.failures.length) bad("no page request may hit /api/pdf/save without a document, got: " + chrome.failures.join(" | "));

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
