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
//   * the layout is single-col (SP5, 2026-11-06: no density control anywhere and
//     no 380 px panel), the topbar is icon-only with no text at all (HD5), and
//     dropped ids never come back (deep-link states #crosspage and ?lang=cn stay
//     checked)
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
      out[f] = { pair: els.length, mid: mid, forward: forward, backward: Number(range.value) === mid + step, min: Number(range.min), max: Number(range.max), step: step };
    });
    return JSON.stringify(out);
  })()`);
  for (const [f, v] of Object.entries(pairsData || {})) {
    if (v.pair !== 2) bad(`${f}: slider+number pair count = ${v.pair}`);
    if (!v.forward || !v.backward) bad(`${f}: slider/number are not two-way bound (${JSON.stringify(v)})`);
  }
  console.log("  ok slider/number two-way bound =", Object.keys(pairsData || {}).join(","));
  // UI4-N4 (2026-11-09): the startOffset pair is a PERCENT control now - the
  // slider (and the number box beside it) carry min 0 / max 100, so the field
  // can never be driven past the page. The old 0..200 pt range is gone.
  const offPair = (pairsData || {})["api.apply.startOffset"];
  if (!offPair || offPair.min !== 0 || offPair.max !== 100) {
    bad(`api.apply.startOffset slider bounds: want min 0 / max 100 (percent), got ${JSON.stringify(offPair)}`);
  } else {
    console.log(`  ok startOffset slider range = 0..${offPair.max}% step ${offPair.step}`);
  }

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

  // ---------- SP5 single-col layout + i18n + theme ----------
  // The right sidebar is dead: #preview bleeds to both window edges, so its rect
  // width equals #app-main's client width; the density attribute stays retired.
  const widths = await json(`(function(){
    var main = document.querySelector("#app-main");
    return JSON.stringify({
      sidebar: Boolean(document.querySelector("#right-sidebar")),
      preview: Math.round(document.querySelector("#preview").getBoundingClientRect().width),
      main: main.clientWidth,
      densityAttr: main.hasAttribute("data-density"),
    });
  })()`);
  if (widths.sidebar) bad("the right sidebar is back: the layout is single-col (SP5): " + JSON.stringify(widths));
  if (Math.abs(widths.preview - widths.main) > 1) bad("the preview column does not fill the window: " + JSON.stringify(widths));
  if (widths.densityAttr) bad("#app-main still carries a data-density attribute");
  console.log("  SP5 layout:", JSON.stringify(widths));

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
        else if ("${lang}" === "cn") want = el.getAttribute('data-i18n-cn');
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
  // UI4-N2 (2026-11-09): the static option explanations ride the [data-i18n-
  // title] channel (title + aria-label), never a visible text node, so the en
  // twin has to answer on exactly that channel too.
  const enTipWrong = await pageErr(`(function(){
    var cat = window.__autoStampI18n.CATALOG;
    var out = [];
    document.querySelectorAll('[data-i18n-title]').forEach(function(el){
      var k = el.getAttribute('data-i18n-title');
      var e = cat[k];
      if (!e) return;
      if (el.getAttribute('title') !== e.en) out.push(k + " title=" + JSON.stringify(el.getAttribute('title')));
      if (el.getAttribute('aria-label') !== e.en) out.push(k + " aria-label=" + JSON.stringify(el.getAttribute('aria-label')));
    });
    return out;
  })()`);
  if (enTipWrong && enTipWrong.length) bad("en tooltip not restored to title/aria-label: " + enTipWrong.slice(0, 8).join(" | "));
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

  // UI6 (2026-11-10): the styled tooltip replaces the native title tip on the
  // [data-i18n-title] channel. The accessible name never leaves aria-label;
  // the title attribute (the N2 channel asserted just above) is detached only
  // while the custom tip owns the hover/focus and restored on leave. The tip
  // is token-inverted (bg = the theme's --fg) so it flips with either theme,
  // and its text follows the current language.
  const tip = await json(`(function(){
    var s = window.__autoStampShell;
    s.applyTheme("dark");
    var el = document.querySelector("#btn-open");
    var pair = window.__autoStampI18n.CATALOG["app.open.btn"];
    var want = s.state.lang === "cn" ? pair.cn : pair.en;
    el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    var t = document.querySelector(".app-tooltip");
    var cs = t ? getComputedStyle(t) : null;
    var inv = document.createElement("span");
    inv.style.color = getComputedStyle(document.documentElement).getPropertyValue("--fg").trim();
    document.body.appendChild(inv);
    var invFg = getComputedStyle(inv).color;
    inv.remove();
    var during = {
      shown: !!t && t.dataset.show === "true",
      text: t ? t.textContent : null,
      title: el.getAttribute("title"),
      aria: el.getAttribute("aria-label"),
      bg: cs && cs.backgroundColor,
      invFg: invFg,
      radius: cs && cs.borderTopLeftRadius,
      fs: cs && cs.fontSize
    };
    el.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
    var after = { shown: t ? t.dataset.show : null, title: el.getAttribute("title"), aria: el.getAttribute("aria-label") };
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    var focusShown = t.dataset.show === "true" && el.getAttribute("title") === null;
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    var focusHidden = t.dataset.show === "false" && el.getAttribute("title") === want;
    s.applyTheme("light");
    return JSON.stringify({ want: want, during: during, after: after, focusShown: focusShown, focusHidden: focusHidden });
  })()`);
  if (!(tip.during.shown && tip.during.text === tip.want)) bad("styled tooltip did not show with the current-language text: " + JSON.stringify(tip.during));
  if (tip.during.title !== null) bad("native title not suppressed while the custom tip owns the hover: " + JSON.stringify(tip.during.title));
  if (tip.during.aria !== tip.want || tip.after.aria !== tip.want) bad("aria-label moved during tooltip hover: " + JSON.stringify([tip.during.aria, tip.after.aria]));
  if (tip.during.bg !== tip.during.invFg) bad(`tooltip bg is not the inverted theme fg: ${tip.during.bg} vs ${tip.during.invFg}`);
  if (tip.during.radius !== "8px" || tip.during.fs !== "12.5px") bad("tooltip styling contract (8px radius / 12.5px text) not applied: " + JSON.stringify([tip.during.radius, tip.during.fs]));
  if (tip.after.title !== tip.want) bad("title attribute not restored after pointerout: " + JSON.stringify(tip.after.title));
  if (tip.after.shown !== "false") bad("custom tip still visible after pointerout: " + tip.after.shown);
  if (!tip.focusShown || !tip.focusHidden) bad("focusin/focusout does not drive the tooltip: " + JSON.stringify([tip.focusShown, tip.focusHidden]));

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

  // SP1/SP4 (2026-11-05): the binding segment lives inside the floating panel
  // and answers to the *selected* instance (the sidebar section is gone). With
  // no instance selected the click only warns; the global default stays put —
  // D2's "none" is a per-instance demotion now, not a global clear.
  const cp = await json(`(function(){
    var s = window.__autoStampShell;
    s.setParams({"api.apply.crossPage": true});
    document.querySelector("#crosspage-binding button[data-value='none']").click();
    var f = s.fields();
    return JSON.stringify({ cross: f["api.apply.crossPage"], binding: f["ui.crosspage.binding"], state: s.probe("state") });
  })()`);
  cmp("binding seg with no instance selected leaves the default alone", cp, { binding: "none", state: "opened" });
  if ("cross" in cp) bad("no control backs apply.crossPage any more: " + JSON.stringify(cp));
  const fixedToast = await json("window.__autoStampShell.probe('toast')");
  if (!fixedToast.open || fixedToast.level !== "warn") bad("binding seg with no selection must warn, got " + JSON.stringify(fixedToast));

  // instance list (decision I1) - HD17 (2026-11-05): boot seeds nothing, and
  // deletion goes all the way to zero (the old last-instance guard is gone).
  const inst = await pageErr(`(function(){
    var s = window.__autoStampShell;
    var boot = s.probe("instanceCount");
    var before = boot;
    s.addInstance("A");
    s.duplicateSelected();
    var mid = s.probe("instanceCount");
    var selected = s.probe("selected");
    s.deleteSelected();
    var afterDel = s.probe("instanceCount");
    while (s.probe("instanceCount") > 1) s.deleteSelected();
    var lastDelete = s.deleteSelected();
    return JSON.stringify({ boot: boot, before: before, mid: mid, afterDel: afterDel, lastDelete: lastDelete, zero: s.probe("instanceCount"), selNull: s.probe("selected") === null, state: s.probe("state"), names: s.probe("instances").map(function(i){return i.name;}) });
  })()`);
  const instData = JSON.parse(inst);
  if (instData.boot !== 0) bad("boot must not seed a default instance (HD17): " + inst);
  if (instData.mid !== instData.before + 2) bad("instance add/duplicate: " + inst);
  if (instData.afterDel !== instData.mid - 1) bad("instance delete: " + inst);
  if (instData.lastDelete === null || instData.lastDelete === undefined) bad("deleting the last instance must succeed (HD17), got " + inst);
  if (instData.zero !== 0 || !instData.selNull || instData.state !== "opened") bad("last instance must delete to zero/opened: " + inst);

  // ---------- a wired route must not fake success ----------
  // /api/pdf/save is implemented (P4). Two separate truths:
  //  * the shell refuses to save when no document is open (client-side guard,
  //    err.apply.noDoc) — it must not send a request with no assetId, and it
  //    must not pretend it succeeded; the SV1 dialog never opens;
  //  * a request that *does* reach the server without an assetId answers the
  //  JSON envelope error (bad_body), not the old router 405 text.
  const saveFail = await pageErr(`(function(){
    var s = window.__autoStampShell;
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
  // SV1 (2026-11-10, user ask decision): the save modal shows ONE read-only
  // row — the save-dest chip — and the native save-as dialog owns the path
  // choice. No targetPath input, no replace switch, no picker button remain;
  // the drive channels (saveToPath/submitReplace/saveViaDialog) exist for
  // verify and §7. A headless run must never click #save-confirm with a
  // document open: fs/pick{save:true} would raise a real modal dialog.
  const sv1 = await json(`(function(){
    var s = window.__autoStampShell;
    var el = document.querySelector("#save-dest");
    var cat = window.__autoStampI18n.CATALOG["save.dest.none"];
    var want = s.state.lang === "cn" ? cat.cn : cat.en;
    return {
      dest: el ? el.textContent : "(missing)",
      destOk: Boolean(el) && el.textContent === want && el.getAttribute("data-i18n") === "save.dest.none",
      destTitle: el && el.closest(".field").getAttribute("data-i18n-title"),
      input: Boolean(document.querySelector('input[data-field="api.save.targetPath"]')),
      switch: Boolean(document.querySelector('input[data-field="api.save.replaceOriginal"]')),
      pick: Boolean(document.querySelector("#save-pick")),
      funcs: [s.saveToPath, s.submitReplace, s.saveViaDialog].map(function (f) { return typeof f; }),
    };
  })()`);
  if (!sv1.destOk) bad("save-dest chip must carry save.dest.none per the active lang, got: " + sv1.dest);
  if (sv1.destTitle !== "save.dest.hint") bad("save-dest row must own the SV1 tooltip (N2 semantics): " + sv1.destTitle);
  if (sv1.input || sv1.switch || sv1.pick) bad("SV1: targetPath input / replaceOriginal switch / #save-pick must be gone from the DOM");
  cmp("SV1 drive channels exist", sv1.funcs, ["function", "function", "function"]);
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

  // SM1/SM2 (2026-11-10, user dialogue directive): F1/F2 toggle the two
  // placement modes (the setters keep them mutually exclusive), and Esc or a
  // right-click cancels whichever mode is active. Keyboard route = the
  // synthetic KeyboardEvent pattern this script already uses; the right-click
  // rides a real contextmenu event.
  const smodes = await pageErr(`(function(){
    var s = window.__autoStampShell;
    function press(key) {
      document.dispatchEvent(new KeyboardEvent("keydown", {key: key, bubbles: true, cancelable: true}));
    }
    var out = {};
    s.setAddMode(false); s.setCrosspageAdd(false);
    press("F1");
    out.f1on = { add: s.probe("addMode"), cross: s.probe("crosspageAdd").on,
      addBtn: document.querySelector("#btn-seal-add").getAttribute("aria-pressed") };
    press("F1");
    out.f1off = s.probe("addMode");
    press("F2");
    out.f2on = { cross: s.probe("crosspageAdd").on, add: s.probe("addMode"),
      crossBtn: document.querySelector("#btn-crosspage-add").getAttribute("aria-pressed") };
    press("F1"); // mutual exclusion: arming F1 disarms the cross-page mode
    out.f1excl = { add: s.probe("addMode"), cross: s.probe("crosspageAdd").on };
    press("Escape"); // SM2: Esc cancels the active mode (no modal is open here)
    out.esc = { add: s.probe("addMode"), cross: s.probe("crosspageAdd").on };
    press("F2");
    document.dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, cancelable: true}));
    out.rclick = { add: s.probe("addMode"), cross: s.probe("crosspageAdd").on,
      crossBtn: document.querySelector("#btn-crosspage-add").getAttribute("aria-pressed") };
    return out;
  })()`);
  cmp("F1 arms the add-seal mode (SM1)", smodes.f1on, { add: true, cross: false, addBtn: "true" });
  cmp("F1 again disarms it (SM1)", smodes.f1off, false);
  cmp("F2 arms the cross-page mode (SM1)", smodes.f2on, { cross: true, add: false, crossBtn: "true" });
  cmp("F1 turns the cross-page mode off (SM1 mutual exclusion)", smodes.f1excl, { add: true, cross: false });
  cmp("Esc cancels the active placement mode (SM2)", smodes.esc, { add: false, cross: false });
  cmp("right-click cancels the active placement mode (SM2)", smodes.rclick, { add: false, cross: false, crossBtn: "false" });

  // SP5 (2026-11-06): the save dialog is the last home of the export vocabulary -
  // #panel-export + #export-mode + #estimate-* now live inside #save-modal, while
  // the sidebar's own #panel-actions / #save-open opener must stay dead.
  const saveVocab = await json(`(function(){
    var s = window.__autoStampShell;
    s.setModal("save-modal");
    var out = {
      exportSection: Boolean(document.querySelector("#save-modal #panel-export")),
      exportMode: Boolean(document.querySelector("#save-modal #export-mode")),
      estimateTotal: Boolean(document.querySelector("#save-modal #estimate-total")),
      panelActions: Boolean(document.querySelector("#panel-actions")),
      saveOpen: Boolean(document.querySelector("#save-open")),
    };
    s.setModal(null);
    return JSON.stringify(out);
  })()`);
  cmp("save dialog hosts the export vocabulary (SP5)", saveVocab, {
    exportSection: true, exportMode: true, estimateTotal: true, panelActions: false, saveOpen: false,
  });

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
  const dropped = ["app-version", "density-seg", "btn-upload", "btn-export", "recent-open", "recent-menu", "recent-clear", "empty-recent", "app-logo", "app-title", "top-file", "empty-upload", "empty-open", "file-input",
    // SP1 (2026-11-05): sidebar sections + assetId readout + strip panel must stay gone.
    "asset-hooks", "panel-seal", "panel-instances", "panel-split", "panel-batch", "panel-crosspage", "strip-previews", "instance-add", "instance-duplicate", "instance-delete", "batch-start", "split-apply", "split-veto", "apply-write", "apply-undo",
    // SP5 (2026-11-06): the right sidebar died with its form #panel, the action
    // block #panel-actions and the #save-open opener (#save-modal is the opener).
    "right-sidebar", "panel", "panel-actions", "save-open",
    // HD19 (2026-11-06): the empty state is one centered #empty-pick button +
    // the paste/drag hint. The path box, the multi/filter chips and the
    // grant readout inside the empty state are gone for good.
    "empty-path", "empty-pick-multi", "empty-pick-filter",
    // UI4-N3 (2026-11-09): the 骑缝切片 mode segment (#crosspage-slicemode) is
    // deleted with its whole .field; 随机 is the only slice channel now, so the
    // id must never come back.
    "crosspage-slicemode"];
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
      if (el.tagName === "BUTTON" || el.tagName === "SELECT" || el.matches(".seg, .spacer")) return;
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
      upload: r("#btn-seal-upload"), recent: r("#seal-recent-select"), addmode: r("#btn-seal-add"),
      xpage: r("#btn-crosspage-add"),
      console: r("#btn-console"),
      lang: r("#lang-seg"), theme: r("#theme-seg")
    });
  })()`);
  if (bar.open.x >= 30) bad(`#btn-open is not at the left edge: ${JSON.stringify(bar.open)}`);
  if (bar.save.x > bar.right / 2) bad(`#btn-save is not in the left half of the topbar: ${JSON.stringify([bar.save.x, bar.right])}`);
  // HD8 (UI_SPEC 8): the left cluster is one continuous icon row:
  // open -> upload seal -> recent seals -> add-seal mode -> cross-page mode
  // (SP4) -> save.
  for (const [a, b] of [["open", "upload"], ["upload", "recent"], ["recent", "addmode"], ["addmode", "xpage"], ["xpage", "save"]]) {
    if (!(bar[b].x > bar[a].right)) bad(`#${a} -> #${b} are not consecutive: ${JSON.stringify([bar[a].right, bar[b].x])}`);
    if (bar[b].x - bar[a].right >= 24) bad(`#${a} -> #${b} gap too large (${bar[b].x - bar[a].right})`);
  }
  const rows = [bar.lang.cy, bar.theme.cy, bar.console.cy, bar.shortcuts.cy];
  if (Math.max(...rows) - Math.min(...rows) > 4) bad(`the right cluster is not one row: ${JSON.stringify(rows)}`);
  if (!(bar.console.x > bar.theme.right)) bad(`#btn-console is not right of the theme switch: ${JSON.stringify([bar.theme.right, bar.console.x])}`);
  if (!(bar.shortcuts.x > bar.console.right)) bad(`#btn-shortcuts is not right of the backend-log toggle: ${JSON.stringify([bar.console.right, bar.shortcuts.x])}`);
  if (bar.right - bar.shortcuts.right >= 24) bad(`#btn-shortcuts is not the rightmost control (topbar right ${bar.right}, button right ${bar.shortcuts.right})`);
  for (const k of ["open", "upload", "addmode", "xpage", "save", "console", "shortcuts"]) {
    if (bar[k].icons !== 1) bad(`#btn-${k} must hold exactly one inline svg icon: ${JSON.stringify(bar[k])}`);
    if (bar[k].text !== 0) bad(`#btn-${k} must be icon-only, found ${bar[k].text} text chars`);
    if (bar[k].w < 24 || bar[k].h < 24) bad(`icon button too small: ${k} ${JSON.stringify(bar[k])}`);
  }
  // HD15 (2026-11-05): every topbar control shares one height (icon buttons,
  // the recent-seal select, the language/theme segments) == 34px.
  const hs = [bar.open, bar.upload, bar.recent, bar.addmode, bar.xpage, bar.save, bar.lang, bar.theme, bar.console, bar.shortcuts].map((o) => o.h);
  if (hs.some((h) => h !== hs[0])) bad(`topbar controls are not one height: ${JSON.stringify(hs)}`);
  if (hs[0] !== 34) bad(`topbar control height = ${hs[0]}, want 34`);
  truthy(`the language switch shows two text choices (中/EN): ${JSON.stringify([bar.lang.text, bar.lang.icons])}`, bar.lang.text > 0 && bar.lang.icons === 0);
  if (bar.theme.icons !== 2) bad(`the theme switch must be two svg icons (sun/moon): ${JSON.stringify(bar.theme)}`);
  console.log("  topbar:", JSON.stringify({ right: bar.right, open: bar.open.x, save: bar.save.x, lang: bar.lang.x, theme: bar.theme.x, console: bar.console.x, shortcuts: bar.shortcuts.right, icons: [bar.open.icons, bar.save.icons, bar.shortcuts.icons, bar.theme.icons, bar.console.icons] }));

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
    // after stamping): the rows left by earlier checks stay live.
    out.slate = { count: s.probe("instanceCount"), seals: window.__autoStampSeal.probe("count") };

    // HD17 (2026-11-05): images paste/drag ONLY prepare the seal + set the
    // current seal - instances never change through the load channel.
    out.pastePng1 = pasteEv([png("seal-one.png")]);
    out.sealReady = await wait(function () { return window.__autoStampSeal.probe("count") >= out.slate.seals + 1; }, 6000);
    out.sealCount1 = window.__autoStampSeal.probe("count");
    out.afterPaste1 = { count: s.probe("instanceCount"), curSeal: s.probe("currentSeal") !== null };

    // "Add instance" snapshots the current seal at creation time (HD17).
    s.addInstance("gate-inst");
    out.snapSealed = (function () {
      var sel = s.probe("selected");
      var ins = s.probe("chain").instances.filter(function (i) { return i.id === sel; })[0];
      return Boolean(ins && ins.sealId);
    })();

    // several images at once: still load-only - every image prepares, no new
    // instances are created (HD17 supersedes the old I1 multi-image rows).
    var base = s.probe("instanceCount");
    out.multiPaste = pasteEv([png("seal-three.png"), png("seal-four.png")]);
    out.multiSeals = await wait(function () { return window.__autoStampSeal.probe("count") >= out.sealCount1 + 2; }, 6000);
    out.multiSame = s.probe("instanceCount") === base;
    out.currentLast = s.probe("currentSeal") !== null;

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
  truthy("multi-PDF refusal toast names the one-at-a-time rule", /一次只打开|one PDF/i.test(gate.multiToast.text || ""));
  truthy("foreign file drop refused (PD2 other)", gate.other && gate.other.load.kind === "reject" && gate.other.load.reason === "other");
  truthy("foreign refusal toast names the allowlist", /只支持|only PDF/.test(gate.otherToast.text || ""));
  truthy("single PDF drop opened the document (PD2)", gate.pdfOpened === true && gate.pdfDrop.during === true && gate.pdfDrop.after === "off" && gate.pageCount >= 1);
  truthy(`the document title carries version + drop name (HD5): ${JSON.stringify(gate.docTitle)}`,
    gate.docTitle === "AutoStamp " + version + " pasted one.pdf");
  truthy(
    `pasted image prepared a seal (PD1) without touching instances (HD17) [paste=${gate.pastePng1} ready=${gate.sealReady} n1=${gate.sealCount1} slate=${JSON.stringify(gate.slate && gate.slate.count)} after=${JSON.stringify(gate.afterPaste1)}]`,
    gate.pastePng1 === true && gate.sealReady === true && gate.sealCount1 >= 1 &&
      gate.afterPaste1.count === gate.slate.count && gate.afterPaste1.curSeal === true,
  );
  truthy("Add-instance snapshots the current seal (HD17)", gate.snapSealed === true);
  truthy(`pasting two images prepares both but creates no instance (HD17): ${JSON.stringify({ base: gate.multiSeals, same: gate.multiSame })}`,
    gate.multiSeals === true && gate.multiSame === true && gate.currentLast === true);
  truthy("seal count grew with every loaded image", gate.sealCount1 >= 1);
  truthy("text paste in a focused field stays untouched (PD1)", gate.passthrough === false && gate.kindAfterPaste === "seals");
  truthy("file drops are always prevented from default navigation (PD2)", gate.pdfDrop.prevented === true);
  truthy("drop-hint affordance ships in the shell (PD2)", gate.dropHint === true);

  // ---------- HD19: openByPath(path) is the §7 drive open channel ----------
  // The path box is gone from the empty state (HD6's typed-path UI half died
  // with HD19): the drive channel takes the path as an argument and must go
  // through /api/fs/pick (filePath) -> grant -> open, and the title must follow.
  const typedPath = join(sandbox, "typed-open.pdf");
  writeFileSync(typedPath, Buffer.from(pdfB64, "base64"));
  const typed = await json(`(async function () {
    var s = window.__autoStampShell;
    var out = { before: s.probe("chain").current };
    s.openByPath(${JSON.stringify(typedPath)});
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
  truthy(`openByPath(path) opened the typed file with no box/button (HD19): toast=${JSON.stringify(typed.toastText)} title=${JSON.stringify(typed.docTitle)}`,
    typed.opened === true && typed.pageCount >= 1
      && /^AutoStamp .*typed-open\.pdf$/.test(typed.docTitle || ""));

  // HD19 shape guard: the empty state is ONE centered large rounded-square
  // button (#empty-pick, 156x156 / radius 16) plus the paste/drag hint — and
  // nothing else (the path box / option chips never come back).
  const emptyShape = await json(`(function(){
    window.__autoStampShell.applyLang("en"); // deterministic labels (settings may be cn)
    var es = document.querySelector("#empty-state");
    var kids = Array.prototype.map.call(es.children, function (el) {
      return el.tagName + (el.id ? "#" + el.id : "." + String(el.className).split(" ")[0]);
    });
    var cs = getComputedStyle(document.querySelector("#empty-pick"));
    var eb = document.querySelector("#empty-state").getBoundingClientRect();
    var pb = document.querySelector("#empty-pick").getBoundingClientRect();
    return JSON.stringify({
      kids: kids,
      label: document.querySelector("#empty-pick").textContent.trim(),
      centered: Math.abs((pb.left + pb.right) / 2 - (eb.left + eb.right) / 2) <= 2 &&
                Math.abs((pb.top + pb.bottom) / 2 - (eb.top + eb.bottom) / 2) <= 45,
      w: cs.width, h: cs.height, radius: cs.borderTopLeftRadius,
      box: Boolean(document.querySelector("#empty-path")),
      multi: Boolean(document.querySelector("#empty-pick-multi")),
      filter: Boolean(document.querySelector("#empty-pick-filter"))
    });
  })()`);
  cmp("HD19 empty state = one big square-rounded centered button + hint (no box/chips)",
    [emptyShape.kids.join("|"), emptyShape.label, emptyShape.w, emptyShape.h, emptyShape.radius, emptyShape.centered,
      [emptyShape.box, emptyShape.multi, emptyShape.filter].join(",")],
    ["BUTTON#empty-pick|DIV.hint", "Open file", "156px", "156px", "16px", true, "false,false,false"]);

  // ---------- HD8-HD12: recent seals + add-seal mode + floating panel ----------
  // Same /api round-trips the header controls wire: the recent-seal record is
  // server-side settings.recentSeals (GET back proves it), the stale entry
  // drops itself, the toggle turns a page click into a stamped instance on the
  // *current page only*, and the panel/preview are the surfaces under test.
  const hdSealPath = join(sandbox, "company seal.png");
  writeFileSync(hdSealPath, readFileSync(join(root, "docs", "ui", "fixtures", "seal.png")));
  const ghostSealPath = join(sandbox, "deleted seal.png");
  const hd = await json(`(async function () {
    var s = window.__autoStampShell;
    function wait(fn, ms) {
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
    var out = {};
    try {
      // HD17: the boot/gate state carries no auto instances; record the entry count.
      out.countAtStart = s.state.instances.length;
      // 1) HD8: a grant-opened seal is recorded server-side; menu labels drop the extension
      out.opened = await s.openRecentSeal(${JSON.stringify(hdSealPath)});
      await wait(function () { return s.probe("recentSeals").paths.length >= 1; }, 5000);
      out.recent1 = s.probe("recentSeals");
      // HD17: opening a seal through the dropdown never touches the instance list
      out.countAfterOpen = s.state.instances.length;
      out.serverRecord = await window.__autoStampApi.request("/api/settings").then(function (r) {
        return ((r.settings || {}).recentSeals || []).map(function (x) { return { path: x.path }; });
      });
      // 2) HD8 fallback: a deleted file drops the entry from menu + settings
      out.stale = await s.openRecentSeal(${JSON.stringify(ghostSealPath)});
      await wait(function () { return s.probe("recentSeals").paths.length === 1; }, 4000);
      out.recentAfterStale = s.probe("recentSeals").paths.length;
      out.staleToast = s.probe("toast") || {};
      // the recorded entry still replays through the same channel
      out.replayed = await s.openRecentSeal(${JSON.stringify(hdSealPath)});
      // HD14: the opened seal is the drop-down's current option...
      out.selectedAfter = s.probe("recentSeals").selected;
      // HD13: ...and the preview card is an overlay in the bottom-left corner,
      // floating above the pager rail instead of reserving a strip.
      out.overlay = (function () {
        var pv = document.querySelector("#preview").getBoundingClientRect();
        var cardEl = document.querySelector("#seal-preview");
        var card = cardEl.getBoundingClientRect();
        var pager = document.querySelector("#page-pager").getBoundingClientRect();
        return { dx: Math.round(card.left - pv.left), gapAbovePager: Math.round(pager.top - card.bottom), visible: !cardEl.hidden };
      })();
      // 3) HD9: the bottom-left card shows the current seal, painted
      out.preview = (function () {
        var card = document.querySelector("#seal-preview");
        var cv = document.querySelector("#seal-preview-canvas");
        var nm = document.querySelector("#seal-preview-name");
        var paint = 0;
        try {
          var d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
          for (var i = 3; i < d.length; i += 4) if (d[i] > 0) paint++;
        } catch (e) { paint = -1; }
        return {
          visible: Boolean(card && !card.hidden), paintedPixels: paint,
          name: nm ? nm.textContent : "",
        };
      })();
      // 4) HD10: the header toggle + a click on empty page space stamps the seal
      var btn = document.querySelector("#btn-seal-add");
      btn.click();
      out.toggleOn = s.probe("addMode") === true && btn.getAttribute("aria-pressed") === "true";
      out.cursor = getComputedStyle(document.querySelector("#preview-stage")).cursor;
      out.countBefore = s.state.instances.length;
      var cr = document.querySelector("canvas.page-canvas").getBoundingClientRect();
      document.querySelector("#preview-stage").dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true, cancelable: true, button: 0, isPrimary: true,
        clientX: cr.left + 20, clientY: cr.top + 20,
      }));
      var sel = s.selectedInstance();
      out.idAfterClick = sel ? sel.id : null;
      out.countAfterClick = s.state.instances.length;
      out.newInstSealed = Boolean(sel && sel.sealId);
      out.newInstPages = sel ? String(sel.params["api.apply.pages"]) : null;
      out.placedScale = sel ? sel.params["api.apply.scale"] : null;
      out.autoScaleRef = s.autoScale();
      out.pageW = (function () {
        var pg = (s.state.file && s.state.file.pages || [])[0] || {};
        var w = Number(pg.width) || 0, h = Number(pg.height) || 0;
        if (Math.abs(Number(pg.rotation) || 0) % 180 === 90) { var t = w; w = h; h = t; }
        return w;
      })();
      out.page = String(window.__autoStampPreview.probe("page"));
      // 5) HD18 + HD12/IP1: the panel is collapsed by default (gear fab), the
      // fab opens it, and the panel is DOCKED at the right edge of #preview
      // (IP1, 2026-11-09: no more instance-box anchoring — the dock rect is
      // fixed by CSS; read it from the preview column).
      out.panel0 = s.probe("instancePanel");
      document.querySelector("#instance-fab").click();
      out.panel = s.probe("instancePanel");
      (function () {
        var pr = document.querySelector("#preview").getBoundingClientRect();
        var q = document.querySelector("#instance-panel").getBoundingClientRect();
        out.dock = {
          rightGap: Math.round(pr.right - q.right),
          topGap: Math.round(q.top - pr.top),
          bottomGap: Math.round(pr.bottom - q.bottom),
          w: Math.round(q.width),
        };
      })();
      // 6) HD12: reset restores the snapshot defaults, remove drops the row
      var inst = s.state.instances.filter(function (i) { return i.id === out.idAfterClick; })[0];
      inst.params["api.apply.scale"] = 9;
      inst.params["api.apply.rotation"] = 44;
      document.querySelector("#instance-reset").click();
      out.resetScale = inst.params["api.apply.scale"];
      out.defaultScale = (s.probe("defaults") || {})["api.apply.scale"];
      out.autoScaleNow = s.autoScale();
      document.querySelector("#instance-remove").click();
      out.countAfterRemove = s.state.instances.length;
      out.selAfterRemove = s.state.selected;
      out.panelAfterRemove = s.probe("instancePanel");
      // HD18: the gear fab re-opens the panel, the minimize button collapses it
      document.querySelector("#instance-fab").click();
      out.panelReopened = s.probe("instancePanel");
      document.querySelector("#instance-collapse").click();
      out.panelRecollapsed = s.probe("instancePanel");
      // 7) SP4 (2026-11-05): cross-page placement mode. Mutual exclusion with
      // the add-seal toggle; a page click drops a strip instance whose
      // startOffset percent rides the click height (UI4-N4); the panel's cp
      // group shows only for that selection; binding none demotes it back to a
      // page stamp.
      var xbtn = document.querySelector("#btn-crosspage-add");
      s.setAddMode(true);
      xbtn.click();
      out.excl = { add: s.probe("addMode"), xOn: xbtn.getAttribute("aria-pressed") === "true" };
      var cbefore = s.state.instances.length;
      var cr2 = document.querySelector("canvas.page-canvas").getBoundingClientRect();
      document.querySelector("#preview-stage").dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true, cancelable: true, button: 0, isPrimary: true,
        clientX: cr2.left + 30, clientY: cr2.top + 160,
      }));
      var xsel = s.selectedInstance();
      out.xPlaced = {
        kept: s.state.instances.length === cbefore + 1,
        cross: xsel ? xsel.crossPage === true : false,
        pages: xsel ? String(xsel.params["api.apply.pages"]) : null,
        start: xsel && xsel.params ? xsel.params["api.apply.startOffset"] : null,
        scale: xsel && xsel.params ? xsel.params["api.apply.scale"] : null,
      };
      (function () {
        var ov = window.__autoStampOverlay;
        var cvr = ov.probe("canvasRect");
        if (!cvr || xsel === null) { out.xPctOk = false; return; }
        // UI4-N4: the click height becomes a percent of the strip's travel:
        //   pct = clamp((1 - pt.y / (pageH - h)) x 100, 0, 100)
        // with h = the whole strip box height (the probe rect's own h) and
        // pageH = the page's display height. The same formula gives the box
        // top; the percent is rounded to one decimal (0.1 % of the travel), so
        // the box top is compared with room for that rounding (+/-2 pt).
        var want = (cr2.top + 160 - cvr.top) / ov.state.scale; // click y in page points
        var mm = ov.state.meta || {};
        var boxR = ov.state.rects.get(xsel.id) || {};
        var travel = (mm.height || 0) - (boxR.h || 0);
        out.xGeom = {
          clickY: Math.round(want * 10) / 10,
          pageH: mm.height,
          boxH: Math.round((boxR.h || 0) * 10) / 10,
          travel: Math.round(travel * 10) / 10,
          boxY: Math.round((boxR.y || 0) * 10) / 10,
          start: out.xPlaced.start,
        };
        var pctWant = travel > 0 ? Math.round((1 - want / travel) * 1000) / 10 : 0;
        pctWant = Math.max(0, Math.min(100, pctWant));
        out.xPctOk = travel > 0 && Math.abs(out.xPlaced.start - pctWant) <= 1;
        out.xPctRange = out.xPlaced.start >= 0 && out.xPlaced.start <= 100;
        out.xBoxOk = travel > 0 && Math.abs((boxR.y || 0) - want) <= 2;
      })();
      // Z3 (2026-11-09, user fix): the placed strip answers the same
      // affordance as any normal stamp - selection box + five handles - and a
      // bare press+release click (no move, no hold) selects it again. The old
      // CSS hid the strip's sel-box, so nothing appeared until you pressed and
      // held.
      out.xAffordance = (function () {
        var el = document.querySelector('#stamp-layer .instance[data-mode="crosspage"]');
        if (!el) return { selected: false, boxRects: 0, handles: 0 };
        var sb = el.querySelector(".sel-box");
        return {
          selected: el.getAttribute("data-selected") === "true",
          boxRects: sb ? sb.getClientRects().length : 0,
          handles: el.querySelectorAll(".handle[data-handle]").length,
        };
      })();
      out.xClick = (function () {
        var sel0 = s.selectedInstance();
        if (!sel0) return { selected: false, boxVisible: false };
        s.selectInstance(null);
        var ov = window.__autoStampOverlay;
        var cvr = ov.probe("canvasRect");
        var boxR = ov.state.rects.get(sel0.id);
        if (!cvr || !boxR) return { selected: false, boxVisible: false };
        // single click on the strip box centre (page-space -> client via the
        // canvas rect + view scale), then the doc-level pointerup closes a
        // zero-move drag.
        var cx = cvr.left + (boxR.x + boxR.w / 2) * ov.state.scale;
        var cy = cvr.top + (boxR.y + boxR.h / 2) * ov.state.scale;
        var cv = document.querySelector("canvas.page-canvas");
        cv.dispatchEvent(new PointerEvent("pointerdown", {
          bubbles: true, cancelable: true, button: 0, isPrimary: true, pointerId: 11,
          clientX: cx, clientY: cy,
        }));
        document.dispatchEvent(new PointerEvent("pointerup", {
          bubbles: true, cancelable: true, button: 0, isPrimary: true, pointerId: 11,
          clientX: cx, clientY: cy,
        }));
        var sel = s.selectedInstance();
        var sb2 = document.querySelector('#stamp-layer .instance[data-mode="crosspage"] .sel-box');
        return {
          selected: Boolean(sel && sel.crossPage === true && sel.id === sel0.id),
          boxVisible: Boolean(sb2 && sb2.getClientRects().length > 0),
          state: s.probe("state"),
        };
      })();
      document.querySelector("#instance-fab").click(); // expand the panel to read the cp group
      out.cpProbe = s.probe("crosspageAdd");
      (function () {
        var pr = s.probe("strips");
        out.stripCount = pr.count;
        out.stripEdge = pr.strips[0] ? pr.strips[0].edge : null;
        out.stripIndex = pr.strips[0] ? pr.strips[0].index : null;
      })();
      // UI5-B1: the cross-page selection frame = whole-seal outline - the DOM
      // box width equals the full seal width (strip.w/ow ratio), and the
      // outline hugs the binding edge: ox + ow == pageW (right binding).
      out.xOutline = (function () {
        var pr = s.probe("strips");
        var st0 = pr.strips && pr.strips[0];
        var ov = window.__autoStampOverlay;
        var el = document.querySelector('#stamp-layer .instance[data-mode="crosspage"]');
        var sb = el ? el.querySelector(".sel-box") : null;
        var sbR = sb ? sb.getBoundingClientRect() : null;
        var metaW = ov.state ? ov.state.meta.width : 0;
        var sc = ov.state.scale;
        return {
          ow: st0 ? st0.ow : null,
          edgeOk: Boolean(st0) && Math.abs(st0.ox + st0.ow - metaW) <= 2,
          boxWOk: Boolean(sbR && st0) && Math.abs(sbR.width - st0.ow * sc) <= 3,
        };
      })();
      // Z5 (2026-11-09): 随机-only slice simulation (UI4-N3 deleted the 平均
      // branch and its mode segment). The deterministic core checks pin the
      // user's mechanism (cover rounds the covered middle; first 25..50 / last
      // 20..30; Σ=1; a smooth trend — adjacent shares may never zig-zag), then
      // the live retry/cover chain runs on the placed strip instance, which
      // already carries a random draw from the moment it was placed.
      out.z5 = (function () {
        var o = {};
        function lcg(seed) {
          var x = seed;
          return function () { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
        }
        var f = s.randomCrossFractions(12, 60, lcg(20261109));
        var mid = f.slice(1, 11);
        var covList = mid.filter(function (v) { return v > 0; });
        var maxAdj = 0;
        for (var zi = 1; zi < covList.length; zi += 1) maxAdj = Math.max(maxAdj, Math.abs(covList[zi] - covList[zi - 1]));
        o.det = {
          len: f.length,
          sum: +f.reduce(function (a, v) { return a + v; }, 0).toFixed(6),
          covered: covList.length, // round(60% x 10 middle pages) = 6
          first: f[0], last: f[11],
          smoothAdj: maxAdj,
        };
        var f2 = s.randomCrossFractions(2, 60, lcg(7));
        o.det2 = Math.abs(f2[0] + f2[1] - 1) < 1e-3 && f2[0] >= 0.25 && f2[0] <= 0.5;
        var f1 = s.randomCrossFractions(1, 60, lcg(7));
        o.det1 = f1.length === 1 && f1[0] === 1;
        // live chain on the placed instance: UI4-N3 made the random draw the
        // only channel, so the placement itself rolled the fractions and there
        // is no mode segment to click any more.
        var n = s.state.file.pageCount || 1;
        var sl = (xsel.params || {})["api.apply.slices"] || null;
        o.rolled = Array.isArray(sl) && sl.length === n;
        // UI4-N3: the mode control is gone for good, and cover + retry now sit
        // in the cp group like every other cp field - they show for every
        // cross-page selection, no "only random" visibility state any more.
        (function () {
          var groups = [].slice.call(document.querySelectorAll("#instance-panel .cp-group"));
          var coverCtl = document.querySelector('[data-field="ui.crosspage.cover"]');
          var retryBtn = document.querySelector("#crosspage-retry");
          var coverGroup = coverCtl ? groups.filter(function (g) { return g.contains(coverCtl); })[0] : null;
          var retryGroup = retryBtn ? groups.filter(function (g) { return g.contains(retryBtn); })[0] : null;
          o.cpGroups = groups.length;
          o.cpAllVisible = groups.length === 4 && groups.every(function (g) { return !g.hidden; });
          o.coverVisible = Boolean(coverCtl && coverGroup && !coverGroup.hidden);
          o.retryVisible = Boolean(retryBtn && retryGroup && !retryGroup.hidden);
          o.cpRandGone = !document.querySelector("#instance-panel .cp-rand");
          o.slicemodeGone = !document.querySelector("#crosspage-slicemode") &&
            !document.querySelector('[data-field="ui.crosspage.sliceMode"]');
        })();
        var before = sl ? sl.join(",") : "";
        document.querySelector("#crosspage-retry").click();
        var after = (xsel.params || {})["api.apply.slices"] || [];
        // a 1-page doc always re-rolls to the same single slot; only assert the
        // values actually change where a change is physically possible.
        o.retryOk = n >= 3 ? after.join(",") !== before : true;
        s.setParams({ "ui.crosspage.cover": 60 });
        var cov = ((xsel.params || {})["api.apply.slices"] || []).slice(1, n - 1)
          .filter(function (v) { return v > 0; }).length;
        var mm = Math.max(0, n - 2);
        o.coverOk = mm === 0 || cov === Math.round(0.6 * mm);
        o.prUneven = s.probe("strips");
        return o;
      })();
      document.querySelector("#crosspage-binding button[data-value='none']").click();
      out.demoted = { crossPage: xsel.crossPage, pages: String(xsel.params["api.apply.pages"]) };
      out.cpFieldsAfterDemote = s.probe("crosspageAdd").cpFields;
      document.querySelector("#crosspage-binding button[data-value='right']").click();
      out.respan = { cross: xsel.crossPage, pages: String(xsel.params["api.apply.pages"]) };
      s.setCrosspageAdd(false); // never leak the mode into later checks
      // HD17: deletion goes to zero - no guard toast, state back to opened
      while (s.state.selected !== null) s.deleteSelected();
      out.zero = { count: s.state.instances.length, selNull: s.probe("selected") === null,
        state: s.probe("state"), bothHidden: !s.probe("instancePanel").visible && !s.probe("instancePanel").fabVisible };
      s.setAddMode(false); // never leak the mode into later checks
      // HD14: a path-less current seal (paste/drag channel) shows the marker
      // option, and picking the marker is a no-op in the change handler.
      var cur = s.probe("currentSeal");
      s.setCurrentSeal(cur.sealId, "pasted.png", "");
      var mk = s.probe("recentSeals");
      out.markerSel = mk.selected;
      out.markerLabel = mk.optionNames.indexOf("pasted.png") >= 0;
      s.setCurrentSeal(cur.sealId, "company seal", ${JSON.stringify(hdSealPath)});
      out.restored = s.probe("recentSeals").selected;
    } catch (e) { out.crash = String((e && e.stack) || e); }
    return JSON.stringify(out);
  })()`);
  if (!hd || hd.crash) bad("HD block crashed: " + (hd && hd.crash ? String(hd.crash).slice(0, 200) : "null"));
  truthy(`HD8: the seal opened by grant is recorded in settings.recentSeals: ${JSON.stringify(hd.recent1)}`,
    hd.recent1 && hd.recent1.paths.some((p) => p.toLowerCase() === hdSealPath.toLowerCase()) &&
      hd.recent1.names.some((n) => n === "company seal") &&
      hd.recent1.optionNames.some((n) => n === "company seal") &&
      !hd.recent1.names.some((n) => /\.(png|jpe?g)$/i.test(n)));
  truthy("HD8: the backend settings record holds exactly the opened path once",
    hd.serverRecord && hd.serverRecord.length === 1 &&
      hd.serverRecord[0].path.toLowerCase() === hdSealPath.toLowerCase());
  truthy("HD8: a stale entry removes the option, the settings record and reports via toast",
    hd.stale === null && hd.recentAfterStale === 1 && hd.staleToast.level === "warn" &&
      /no longer exists|不存在/.test(hd.staleToast.text || ""));
  truthy("HD9: the bottom-left preview card painted the current seal",
    hd.preview && hd.preview.visible && hd.preview.paintedPixels > 200 &&
      /company seal/.test(hd.preview.name || ""));
  truthy("HD10: the toggle turns on with a copy cursor, and clicking empty page space stamps the seal",
    hd.toggleOn === true && hd.cursor === "copy" && hd.countAfterClick === hd.countBefore + 1 &&
      hd.newInstSealed === true && hd.idAfterClick !== null);
  truthy(`HD11: the clicked instance belongs to the page on screen only (pages=${JSON.stringify(hd.newInstPages)})`,
    String(hd.newInstPages) === String(hd.page));
  truthy(`Z2: placement scale = 42 mm / page width (display width=${hd.pageW} pt): placed=${hd.placedScale} auto=${hd.autoScaleRef}`,
    hd.placedScale != null && Math.abs(hd.placedScale - hd.autoScaleRef) < 1e-9 &&
      Math.abs(hd.placedScale * hd.pageW - (42 * 72) / 25.4) < 0.05);
  truthy(`IP1: the parameter panel is docked at the right edge of #preview (fixed rect, not anchored beside the instance box): ${JSON.stringify(hd.dock)}`,
    hd.panel && hd.panel.visible === true && hd.dock && hd.dock.w === 236 &&
      hd.dock.rightGap >= 8 && hd.dock.rightGap <= 12 &&
      hd.dock.topGap >= 8 && hd.dock.topGap <= 12 &&
      hd.dock.bottomGap >= 8 && hd.dock.bottomGap <= 12);
  truthy(`HD12+Z2: reset restores the defaults + page-derived scale, remove drops the row (selection moves; the panel follows the selection, not the painted box): ${JSON.stringify({ resetScale: hd.resetScale, defaultScale: hd.defaultScale, autoScaleNow: hd.autoScaleNow, counts: [hd.countBefore, hd.countAfterClick, hd.countAfterRemove], panel: hd.panelAfterRemove })}`,
    hd.resetScale === hd.autoScaleNow && hd.countAfterRemove === hd.countAfterClick - 1 &&
      hd.selAfterRemove !== hd.idAfterClick &&
      hd.panelAfterRemove.visible === (hd.countAfterRemove > 0 && hd.selAfterRemove !== null));
  truthy(`HD17: opening a seal through the dropdown never changes the instance list (${JSON.stringify([hd.countAtStart, hd.countAfterOpen])})`,
    hd.countAfterOpen === hd.countAtStart);
  truthy(`HD18: the panel starts collapsed (gear fab) and the fab opens it for the pinning check`,
    hd.panel0 && hd.panel0.visible === false && hd.panel0.collapsed === true && hd.panel0.fabVisible === true);
  truthy(`HD18: gear fab re-opens, minimize collapses again: ${JSON.stringify({ r: hd.panelReopened, c: hd.panelRecollapsed })}`,
    hd.panelReopened.visible === true && hd.panelRecollapsed.visible === false &&
      hd.panelRecollapsed.collapsed === true && hd.panelRecollapsed.fabVisible === true);

  // IP2 (2026-11-09): the docked panel scrolls when its contents exceed the
  // preview height. Force that condition with a short viewport, scroll the
  // docked panel to its clamped maximum, then restore the normal viewport —
  // and leave the panel collapsed again for the later checks.
  await chrome.setViewport(1440, 430);
  const ipscroll = await json(`(function () {
    // No instance survives from the earlier checks (HD17 deleted to zero), and
    // the panel only exists for a selection - place one, drive the scroll on
    // the docked panel, then remove it again so later checks see the same
    // empty-instance state as before.
    var s = window.__autoStampShell;
    var placed = false;
    if (!s.state.selected) { s.addInstanceAt({ x: 300, y: 400 }); placed = true; }
    var panel = document.querySelector("#instance-panel");
    if (panel.hidden) document.querySelector("#instance-fab").click();
    var cs = getComputedStyle(panel);
    var scrollable = panel.scrollHeight > panel.clientHeight;
    panel.scrollTop = 99999;
    var maxScroll = panel.scrollTop;
    panel.scrollTop = 0;
    document.querySelector("#instance-collapse").click();
    if (placed) s.deleteSelected();
    return { overflow: cs.overflowY, scrollable: scrollable, maxScroll: maxScroll,
      collapsed: window.__autoStampShell.probe("instancePanel").collapsed };
  })()`);
  await chrome.setViewport(1440, 900);
  truthy(`IP2: the docked panel scrolls when its content exceeds the preview height: ${JSON.stringify(ipscroll)}`,
    ipscroll && ipscroll.overflow === "auto" && ipscroll.scrollable === true &&
      ipscroll.maxScroll > 0 && ipscroll.collapsed === true);
  truthy("SP4: the cross-page toggle is mutually exclusive with the add-seal mode",
    hd.excl && hd.excl.add === false && hd.excl.xOn === true);
  truthy(`SP4: the page click drops a cross-page strip instance and its percent lands on the click height (start=${hd.xPlaced && hd.xPlaced.start}, geom=${JSON.stringify(hd.xGeom)}): ${JSON.stringify(hd.xPlaced)}`,
    hd.xPlaced && hd.xPlaced.kept && hd.xPlaced.cross === true &&
      hd.xPlaced.pages === "all" && hd.xPctOk === true && hd.xPctRange === true && hd.xBoxOk === true &&
      Math.abs(hd.xPlaced.scale - hd.autoScaleRef) < 1e-9);
  truthy(`Z3: the cross-page strip keeps its selection box + five handles: ${JSON.stringify(hd.xAffordance)}`,
    hd.xAffordance && hd.xAffordance.selected === true && hd.xAffordance.boxRects > 0 &&
      hd.xAffordance.handles === 5);
  truthy(`Z3: a bare click on the strip re-selects it and shows the box (no press-and-hold): ${JSON.stringify(hd.xClick)}`,
    hd.xClick && hd.xClick.selected === true && hd.xClick.boxVisible === true && hd.xClick.state === "stamp-selected");
  truthy(`UI5-B1: cross-page selection box = whole-seal outline (w=fullW, hugs the binding edge): ${JSON.stringify(hd.xOutline)}`,
    hd.xOutline && hd.xOutline.ow > 0 && hd.xOutline.edgeOk && hd.xOutline.boxWOk);
  truthy(`SP4: the panel cp group shows for the cross-page selection and echoes the vocabulary (startOffset back as 0..100 %): ${JSON.stringify(hd.cpProbe)}`,
    hd.cpProbe && hd.cpProbe.on === true && hd.cpProbe.cpFields === 4 &&
      hd.cpProbe.binding === "right" && hd.cpProbe.startOffset >= 0 && hd.cpProbe.startOffset <= 100 &&
      Math.abs(hd.cpProbe.startOffset - hd.xPlaced.start) <= 1);
  truthy(`SP4: one right-edge strip on the current page (count=${hd.stripCount} edge=${hd.stripEdge} index=${hd.stripIndex})`,
    hd.stripCount >= 1 && hd.stripEdge === "right" && hd.stripIndex === 0);
  truthy(`Z5: the deterministic draw honours cover + first/last ranges + Σ=1 + smooth trend: ${JSON.stringify(hd.z5 && hd.z5.det)}`,
    hd.z5 && hd.z5.det.len === 12 && hd.z5.det.covered === 6 &&
      hd.z5.det.first >= 0.25 && hd.z5.det.first <= 0.5 &&
      hd.z5.det.last >= 0.2 && hd.z5.det.last <= 0.3 &&
      Math.abs(hd.z5.det.sum - 1) <= 1e-3 && hd.z5.det.smoothAdj <= 0.35);
  truthy(`Z5: N=2 spans both pages (Σ=1, first in range) and N=1 takes the whole seal`,
    hd.z5 && hd.z5.det2 === true && hd.z5.det1 === true);
  truthy(`Z5: the live 重试/覆盖率 chain plus the N3 cp group (随机 恒生效, no slice-mode control): ${JSON.stringify(hd.z5 && {
    rolled: hd.z5.rolled, retry: hd.z5.retryOk, cover: hd.z5.coverOk, groups: hd.z5.cpGroups,
    all: hd.z5.cpAllVisible, coverCtl: hd.z5.coverVisible, retryCtl: hd.z5.retryVisible,
    mode: hd.z5.slicemodeGone, rand: hd.z5.cpRandGone,
  })}`,
    hd.z5 && hd.z5.rolled === true && hd.z5.retryOk === true && hd.z5.coverOk === true &&
      hd.z5.cpGroups === 4 && hd.z5.cpAllVisible === true && hd.z5.coverVisible === true &&
      hd.z5.retryVisible === true && hd.z5.slicemodeGone === true && hd.z5.cpRandGone === true);
  truthy(`SP4: binding=none demotes the selected instance to a current-page stamp: ${JSON.stringify(hd.demoted)}`,
    hd.demoted && hd.demoted.crossPage === false && String(hd.demoted.pages) === String(hd.page) &&
      hd.cpFieldsAfterDemote === 0);
  truthy(`SP4: binding=right spans the same instance across pages again: ${JSON.stringify(hd.respan)}`,
    hd.respan && hd.respan.cross === true && hd.respan.pages === "all");
  truthy(`HD17: instances delete down to zero without a guard, panel + fab hide: ${JSON.stringify(hd.zero)}`,
    hd.zero && hd.zero.count === 0 && hd.zero.selNull === true && hd.zero.state === "opened" &&
      hd.zero.bothHidden === true);
  truthy(`HD13: the preview card is an overlay at the bottom-left, above the pager rail: ${JSON.stringify(hd.overlay)}`,
    hd.overlay && hd.overlay.visible === true && hd.overlay.dx === 10 &&
      hd.overlay.gapAbovePager >= 0 && hd.overlay.gapAbovePager <= 90);
  truthy(`HD14: opened seal becomes the drop-down's current option, path-less seal shows the marker: ${JSON.stringify({ selected: hd.selectedAfter, marker: hd.markerSel })}`,
    String(hd.selectedAfter).toLowerCase() === hdSealPath.toLowerCase() &&
      hd.markerSel === "__current__" && hd.markerLabel === true &&
      String(hd.restored).toLowerCase() === hdSealPath.toLowerCase());

  // ---------- HD16: the backend-terminal toggle + the log tail ----------
  const hdlog = await json(`(async function () {
    var s = window.__autoStampShell;
    function wait(fn, ms) {
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
    var out = {};
    try {
      out.raw = await window.__autoStampApi.request("/api/logs?since=0");
      out.before = s.probe("console");
      document.querySelector("#btn-console").click();
      out.pollOk = await wait(function () {
        var p = s.probe("console");
        return p.visible && p.lines >= 1;
      }, 8000);
      out.opened = s.probe("console");
      out.serverVisible = (await window.__autoStampApi.request("/api/settings")).settings.ui.consoleVisible;
      document.querySelector("#btn-console").click();
      await wait(function () { return !s.probe("console").visible; }, 5000);
      out.closed = s.probe("console");
      out.serverHidden = (await window.__autoStampApi.request("/api/settings")).settings.ui.consoleVisible;
    } catch (e) { out.crash = String((e && e.stack) || e); }
    return JSON.stringify(out);
  })()`);
  if (!hdlog || hdlog.crash) bad("HD16 console block crashed: " + (hdlog && hdlog.crash ? String(hdlog.crash).slice(0, 200) : "null"));
  truthy(`HD16: GET /api/logs carries the startup lines (${JSON.stringify((hdlog.raw && hdlog.raw.lines || []).length)} lines)`,
    hdlog.raw && Array.isArray(hdlog.raw.lines) &&
      hdlog.raw.lines.some(function (l) { return /AutoStamp starting/.test(l.message); }));
  truthy("HD16: hidden by default; the toggle opens a painted panel and persists true",
    hdlog.before && hdlog.before.visible === false && hdlog.pollOk === true &&
      hdlog.opened.visible === true && hdlog.opened.pressed === "true" &&
      hdlog.opened.lines >= 1 && hdlog.serverVisible === true);
  truthy("HD16: the second click hides the panel and persists false",
    hdlog.closed.visible === false && hdlog.closed.pressed === "false" && hdlog.serverHidden === false);

  // The save click above is deliberate: with no document open the shell must
  // refuse locally, so *nothing* may reach the network (asserted below).
  // the HD block fires a deliberate fs/pick 400 (path_denied) for the stale entry
  const deliberate = (e) => /\/api\/pdf\/save|\/api\/fs\/pick/.test(e);
  const unexpectedErrors = chrome.errors.filter((e) => !deliberate(e));
  const unexpectedFailures = chrome.failures.filter((e) => !deliberate(e));
  if (unexpectedErrors.length) bad("console errors: " + unexpectedErrors.join(" | "));
  if (unexpectedFailures.length) bad("resource failures: " + unexpectedFailures.join(" | "));
  if (chrome.failures.some((e) => /\/api\/pdf\/save/.test(e))) bad("no page request may hit /api/pdf/save without a document, got: " + chrome.failures.join(" | "));

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
