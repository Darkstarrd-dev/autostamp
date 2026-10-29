#!/usr/bin/env node
// tools/verify/ui-smoke.mjs — headless behavioural check of docs/ui/mockup.html (P0.5).
//
// Drives a dedicated headless Chrome over CDP (no third-party deps):
//   * console must stay at 0 error, and no resource may 404/finish with an error
//   * fixtures must load (canvas rendering is driven by them)
//   * every UI_SPEC state must be reachable through setState
//   * 1280x720 and 1440x900 must not produce horizontal overflow
//   * every data-i18n key must resolve to non-empty en+cn text
//   * slider↔number pairing and segmented controls must actually write the field
//
// Usage: node tools/verify/ui-smoke.mjs [--keep-profile]
// Exit: 0 = pass.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(join(fileURLToPath(import.meta.url)), "..", "..", "..");
const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Chromium/Chrome/Application/chrome.exe",
];
const chromePath = CHROME.find((p) => existsSync(p)) || null;

const PORT = Number(process.env.UI_SMOKE_PORT || 9333);
const mockUrl = pathToFileURL(join(root, "docs", "ui", "mockup.html")).href;

const fails = [];
const bad = (msg) => fails.push(msg);

let ws;
let seq = 0;
const send = (method, params = {}) =>
  new Promise((ok, no) => {
    const id = ++seq;
    ws.send(JSON.stringify({ id, method, params }));
    const wait = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      ws.removeEventListener("message", wait);
      if (m.error) no(new Error(`${method}: ${JSON.stringify(m.error)}`));
      else ok(m.result);
    };
    ws.addEventListener("message", wait);
  });

const evaluate = async (expression, awaitPromise = false) => {
  const r = await send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    includeCommandLineAPI: false,
  });
  if (r.exceptionDetails) throw new Error("page eval: " + JSON.stringify(r.exceptionDetails.exception));
  return r.result.value;
};

const consoleLines = [];
const netFailures = [];
let chromeProc = null;
let profile = null;

async function waitForDebugger(maxMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page");
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("chrome devtools endpoint never came up");
}
const pageDiag = async () => {
  const r = await send("Runtime.evaluate", {
    expression: "document.readyState + '|' + location.href.slice(-28) + '|' + (window.__autoStampMock ? 'mock' : 'nomock')",
    returnByValue: true,
  });
  return r.result && r.result.value;
};
async function boot() {
  if (!chromePath) throw new Error("Chrome not found (needed for ui-smoke)");
  profile = mkdtempSync(join(tmpdir(), "autostamp-ui-smoke-"));
  chromeProc = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "--window-size=1440,900",
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  const url = await waitForDebugger();
  await new Promise((ok, no) => {
    ws = new WebSocket(url);
    ws.addEventListener("open", ok);
    ws.addEventListener("error", () => no(new Error("cdp connect failed")));
  });
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id === undefined) return void handleEvent(m);
  });
  const handleEvent = (m) => {
    if (m.method === "Runtime.consoleAPICalled") {
      const e = m.params;
      if (e.type === "error" || e.type === "assert") {
        consoleLines.push("console." + e.type + ": " + (e.args || []).map((a) => a.value ?? a.description ?? a.type).join(" "));
      }
    }
    if (m.method === "Log.entryAdded") {
      const e = m.params.entry;
      if (e.level === "error") consoleLines.push("log.error: " + e.text + " " + (e.url || ""));
    }
    if (m.method === "Network.loadingFailed") netFailures.push(m.params.errorText + " " + (m.params.url || ""));
    if (m.method === "Network.responseReceived") {
      const r = m.params.response;
      if (r.status >= 400) netFailures.push(r.status + " " + r.url);
    }
  };
  await send("Network.enable");
  await send("Log.enable");
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: mockUrl });
  // wait for the mock to boot
  const t0 = Date.now();
  let lastErr = "";
  for (;;) {
    try {
      const r = await send("Runtime.evaluate", {
        expression: "!!(window.__autoStampMock && window.__autoStampMock.STATES)",
        returnByValue: true,
      });
      if (r.result && r.result.value === true) break;
      lastErr = "value=" + JSON.stringify(r.result && r.result.value) + " page=" + JSON.stringify(await pageDiag());
    } catch (e) {
      lastErr = String(e && e.message);
    }
    if (Date.now() - t0 > 15000) throw new Error("mock did not boot: " + lastErr);
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function viewport(w, h) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await evaluate("window.__autoStampMock.qa('#preview-stage canvas').forEach(function(c){}); void 0");
}

function cmp(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) bad(`${name}: got ${g} want ${w}`);
  else console.log("  ok " + name + " = " + g);
}
function truthy(name, v) {
  if (!v) bad(`${name}: falsy (${JSON.stringify(v)})`);
}

async function main() {
  await boot();

  const states = await evaluate("window.__autoStampMock.STATES");
  if (!Array.isArray(states) || !states.length) bad("STATES empty");

  // 1. fixtures + no console error at boot
  const imgs = await evaluate("window.__autoStampMock.probe('images')");
  cmp("fixtures loaded", imgs, { page: true, seal: true });
  if (consoleLines.length) bad("boot console errors: " + consoleLines.join(" | "));

  // 2. every state reachable, no error while switching
  for (const st of states) {
    const okState = await evaluate(`window.__autoStampMock.verifyState(${JSON.stringify(st)})`);
    if (!okState) bad(`state ${st}: setState did not land`);
    const cur = await evaluate("window.__autoStampMock.probe('state')");
    if (cur !== st) bad(`state ${st}: html data-state=${cur}`);
  }
  if (consoleLines.length) bad("state-switch console errors: " + consoleLines.join(" | "));
  if (netFailures.length) bad("resource failures: " + netFailures.join(" | "));

  // 2c. the inline stylesheet must parse whole (dropped rules = silent visual bugs),
  //     and overlays must stay display:none until the state machine opens them
  const cssSource = readFileSync(join(root, "docs", "ui", "mockup.html"), "utf8");
  const styleBlock = cssSource.slice(cssSource.indexOf("<style>") + 7, cssSource.indexOf("</style>"));
  const declared = (styleBlock.replace(/\/\*[\s\S]*?\*\//g, "").match(/\{/g) || []).length;
  const parsed = await evaluate("document.styleSheets[0].cssRules.length");
  if (parsed < declared) bad(`css dropped rules: parsed ${parsed} < declared ${declared} (an unclosed paren/bracket in the style block)`);

  const overlays = await evaluate(`
    (function () {
      var m = window.__autoStampMock;
      var d = function (sel) { return getComputedStyle(m.q(sel)).display; };
      m.setState("opened");
      var closed = { layer: d("#modal-layer"), save: d("#save-modal"), confirm: d("#confirm-modal"), shortcuts: d("#shortcuts-modal"), toast: d("#error-toast") };
      m.setState("save-confirm");
      var save = { save: d("#save-modal"), confirm: d("#confirm-modal"), layer: d("#modal-layer") };
      m.setState("replace-confirm");
      var repl = { save: d("#save-modal"), confirm: d("#confirm-modal") };
      m.setState("warn-no-text");
      var toast = d("#error-toast");
      m.setModal(null); m.clearToast();
      m.setState("opened");
      return { closed: closed, save: save, repl: repl, toast: toast, afterClose: d("#error-toast") };
    })()`);
  cmp("no overlay visible in plain opened state", overlays.closed,
    { layer: "none", save: "none", confirm: "none", shortcuts: "none", toast: "none" });
  cmp("save-confirm shows only the save dialog", overlays.save, { save: "flex", confirm: "none", layer: "block" });
  cmp("replace-confirm shows only the confirm dialog", overlays.repl, { save: "none", confirm: "flex" });
  cmp("warn state shows the toast", overlays.toast, "block");
  cmp("toast hidden again after clearToast", overlays.afterClose, "none");

  // 3. no horizontal overflow at the two contract viewports
  for (const [w, h] of [[1280, 720], [1440, 900]]) {
    await viewport(w, h);
    for (const st of ["empty", "opened", "stamp-selected", "split-preview", "crosspage", "export", "save-confirm", "password-error", "warn-large-page"]) {
      await evaluate(`window.__autoStampMock.setState(${JSON.stringify(st)})`);
      const over = await evaluate("window.__autoStampMock.probe('overflow')");
      if (over) bad(`${w}x${h}: horizontal overflow in state ${st}`);
    }
  }

  // 3b. the three densities (D-L1 vocabulary) each reflow without overflow
  const dens = await evaluate(`
    (function () {
      var m = window.__autoStampMock;
      var out = {};
      ["single-col", "collapsed", "two-col"].forEach(function (d) {
        m.setDensity(d);
        var sb = m.q("#right-sidebar").getBoundingClientRect();
        out[d] = {
          density: m.q("#app-main").dataset.density,
          field: m.S.p["ui.density"],
          sidebarW: Math.round(sb.width),
            overflow: m.probe("overflow"),
        };
      });
      return out;
    })()`);
  cmp("single-col spans the full width", [dens["single-col"].density, dens["single-col"].field, dens["single-col"].sidebarW === 1440, dens["single-col"].overflow], ["single-col", "single-col", true, false]);
  cmp("collapsed hides the panel", [dens["collapsed"].density, dens["collapsed"].sidebarW, dens["collapsed"].overflow], ["collapsed", 0, false]);
  cmp("two-col keeps a bounded panel", [dens["two-col"].sidebarW === 380, dens["two-col"].overflow], [true, false]);

  // 4. i18n coverage: every key resolves to non-empty en and cn
  await evaluate('window.__autoStampMock.applyLang("en")');
  const enSnapshot = await evaluate("JSON.stringify(window.__autoStampMock.i18n())").then((s) => JSON.parse(s));
  await evaluate('window.__autoStampMock.applyLang("cn")');
  const cnSnapshot = await evaluate("JSON.stringify(window.__autoStampMock.i18n())").then((s) => JSON.parse(s));
  await evaluate('window.__autoStampMock.applyLang("en")');
  let missing = 0;
  for (const [k, v] of Object.entries(cnSnapshot)) {
    const cn = (v.cn || "").trim();
    const en = (enSnapshot[k]?.en || "").trim();
    if (!cn || !en || cn === "undefined" || en === "undefined") {
      missing++;
      bad(`i18n key ${k}: en=${JSON.stringify(en)} cn=${JSON.stringify(cn)}`);
    }
  }
  if (!Object.keys(cnSnapshot).length) bad("i18n snapshot empty");

  // 4b. ui.lang really swaps the panel field labels (leaf-level i18n targets)
  const labels = await evaluate(`
    (function () {
      var m = window.__autoStampMock;
      var sel = ".field .flabel span[data-i18n]";
      var cjk = function () {
        return m.qa(sel).filter(function (e) { return /[\\u2e40-\\u9fff]/.test(e.textContent); }).length;
      };
      m.applyLang("cn");
      var cnCount = cjk(), total = m.qa(sel).length;
      var scaleLabel = m.qa('[data-i18n="api.apply.scale.ctl"]')[0].textContent;
      m.applyLang("en");
 var enCount = cjk();
      var enLabel = m.qa('[data-i18n="api.apply.scale.ctl"]')[0].textContent;
      return { total: total, cnCount: cnCount, enCount: enCount, cnText: scaleLabel, enText: enLabel };
    })()`);
  truthy("panel labels exist for every field group", labels.total >= 30);
  cmp("cn mode renders cjk labels, en mode does not", [labels.cnCount === labels.total, labels.enCount === 0], [true, true]);
  truthy("scale label differs between languages", labels.cnText !== labels.enText && labels.cnText.length > 0 && labels.enText.length > 0);

  // 5. controls write the model: slider↔number pairing, grouped select, segmented
  await evaluate('window.__autoStampMock.setState("opened")');
  const slider = await evaluate(`
    (function () {
      var m = window.__autoStampMock;
      var pair = m.qa('[data-field="api.apply.opacity"]');
      var range = pair.filter(function (n) { return n.type === "range"; })[0];
      var numIn = pair.filter(function (n) { return n.type === "number"; })[0];
      range.value = "0.35";
      range.dispatchEvent(new Event("input", { bubbles: true }));
      return { model: m.S.p["apply.opacity"], numSynced: Number(numIn.value), rangeCount: pair.length };
    })()`);
  cmp("opacity slider -> model + number box", slider, { model: 0.35, numSynced: 0.35, rangeCount: 2 });

  const blend = await evaluate(`
    (function () {
      var m = window.__autoStampMock;
      var sel = m.q('#apply-blend');
      sel.value = "color-dodge";
      sel.dispatchEvent(new Event("input", { bubbles: true }));
      var groups = m.qa("#apply-blend optgroup").length;
      var modes = m.qa("#apply-blend option").length;
      return { model: m.S.p["apply.blend"], groups: groups, modes: modes };
    })()`);
  cmp("blend grouped select", { model: blend.model, groups: blend.groups >= 6, modes: blend.modes === 16 }, { model: "color-dodge", groups: true, modes: true });

  const seg = await evaluate(`
    (function () {
      var m = window.__autoStampMock;
      m.setState("crosspage");
      var before = m.probe("strip");
      m.q('#crosspage-binding button[data-value="alternate"]').click();
      var pressed = m.q('#crosspage-binding button[data-value="alternate"]').getAttribute("aria-pressed");
      var after = m.probe("strip");
      return {
        model: m.S.p["ui.crosspage.binding"], pressed: pressed, probe: after,
        sideBefore: before.side, visible: getComputedStyle(m.q("#panel-crosspage .body")).display,
      };
    })()`);
  cmp("binding segmented writes model + aria", { model: seg.model, pressed: seg.pressed }, { model: "alternate", pressed: "true" });
  cmp("crosspage strips (10 pages, side right)", { strips: seg.probe.strips, side: seg.probe.side }, { strips: 10, side: "right" });
  truthy("crosspage body visible in crosspage state", seg.visible !== "none");

  // 5c. D2 vocabulary: right / alternate imply a cross-page stamp, none clears it
  const bind = await evaluate(`
    (function () {
      var m = window.__autoStampMock;
      m.setState("crosspage");
      var out = {};
      m.q('#crosspage-binding button[data-value="none"]').click();
      out.none = {
        model: m.S.p["ui.crosspage.binding"], cp: m.S.p["apply.crossPage"],
        strips: m.probe("strip").strips, side: m.probe("strip").side,
        cb: m.q('[data-field="api.apply.crossPage"]').checked,
      };
      m.q('#crosspage-binding button[data-value="right"]').click();
      out.right = {
        cp: m.S.p["apply.crossPage"], strips: m.probe("strip").strips,
        cb: m.q('[data-field="api.apply.crossPage"]').checked,
      };
      m.q('#crosspage-binding button[data-value="none"]').click();
      var cb = m.q('[data-field="api.apply.crossPage"]');
      cb.checked = true;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
      out.reopen = { binding: m.S.p["ui.crosspage.binding"], cp: m.S.p["apply.crossPage"] };
      return out;
    })()`);
  cmp("binding=none clears apply.crossPage and every strip preview", bind.none,
    { model: "none", cp: false, strips: 0, side: "none", cb: false });
  cmp("binding=right restores the stamp and one strip per page", bind.right,
    { cp: true, strips: 10, cb: true });
  cmp("checking crossPage repairs the none binding edge", bind.reopen, { binding: "right", cp: true });

  // 5b. state machine drives surfaces (UI_SPEC §1)
  const vis = await evaluate(`
    (function () {
      var m = window.__autoStampMock;
      var out = {};
      var disp = function (sel) { var e = m.q(sel); return e ? getComputedStyle(e).display : "missing"; };
      m.q('#split-mode button[data-value="off"]').click(); // plain pages: normal instances exist
      m.setState("stamp-selected");
      out.selBoxCount = document.querySelectorAll("#preview-stage .instance .sel-box").length;
      out.selBoxShown = disp("#preview-stage .instance .sel-box") !== "none";
      m.setState("opened");
      out.selBoxHiddenOpened = disp("#preview-stage .instance .sel-box") === "none";
      m.setState("empty");
      out.emptyShown = disp("#empty-state") !== "none" && disp("#preview-stage") === "none";
      m.setState("crosspage");
      out.crossBody = disp("#panel-crosspage .body") !== "none";
      m.setState("opened");
      out.crossBodyHidden = disp("#panel-crosspage .body") === "none";
      m.setState("crosspage");
      out.crossStrips = m.probe("strip").strips;
      m.setState("save-confirm");
      out.saveModalShown = disp("#save-modal") !== "none";
      m.setState("replace-confirm");
      out.replaceModalShown = disp("#confirm-modal") !== "none";
      m.setState("opened");
      out.emptyHidden = disp("#empty-state") === "none";
      return out;
    })()`);
  for (const [k, v] of Object.entries(vis)) truthy(`state visibility: ${k}`, v);

  // 6. geometry: a selected normal instance must clamp inside the page
  const geo = await evaluate(`
    (function () {
      var m = window.__autoStampMock;
      m.q('#split-mode button[data-value="off"]').click();  // D3: manual off -> plain pages
      m.setState("stamp-selected");
      var host = m.q("#preview-stage");
      m.setParams({ "api.apply.scale": 0.5, "api.apply.pos": "10,10", "api.apply.anchor": "center" });
      var r = m.q("#preview-stage canvas").getBoundingClientRect();
      var box = m.q("#preview-stage .instance .sel-box");
      m.setParams({ "api.apply.scale": 0.9 });
      var wide = { left: parseFloat(box.style.left), w: parseFloat(box.style.width), cw: r.width };
      m.setParams({ "api.apply.scale": 0.202, "api.apply.pos": "130,480", "api.apply.rotation": 90 });
      return {
        wide: wide, rot: m.S.p["apply.rotation"], scale: m.S.p["apply.scale"],
        splitAttr: host.dataset.split,
        selBoxes: m.qa("#preview-stage .instance .sel-box").length,
        instances: m.probe("instances"),
        pages: m.S.pages.length, splitOn: m.S.splitOn,
      };
    })()`);
  cmp("split off -> plain pages, selected instances in DOM",
    { splitAttr: geo.splitAttr, splitOn: geo.splitOn, pages: geo.pages, instances: geo.instances, boxes: geo.selBoxes >= 1 },
    { splitAttr: "off", splitOn: false, pages: 5, instances: 2, boxes: true });
  truthy("scale clamp keeps the handle inside the page", geo.wide.left >= 0 && geo.wide.left + geo.wide.w <= geo.wide.cw + 1);
  cmp("rotation field", geo.rot, 90);
  cmp("scale field", geo.scale, 0.202);

  // 7. split + crosspage probes
  const split = await evaluate(`
    (function () {
      var m = window.__autoStampMock;
      m.setState("split-preview");
      var pages = m.probe("split");
      m.setState("crosspage");
      return { pages: pages, strips: m.probe("strip"), state: m.probe("state") };
    })()`);
  cmp("2-up split geometry", { splitOn: split.pages.splitOn, pages: split.pages.pages, mode: split.pages.mode }, { splitOn: true, pages: 10, mode: "v2" });
  cmp("crosspage strips", { strips: split.strips.strips, side: split.strips.side }, { strips: 10, side: "right" });

  // 8. size estimate follows the export params
  const est = await evaluate(`
    (function () {
      var m = window.__autoStampMock;
      m.setState("export");
      m.setParams({ "api.export.mode": "raster", "api.export.dpi": "150", "api.export.quality": "75", "api.export.pages": "all" });
      var lo = m.probe("estimate");
      m.setParams({ "api.export.dpi": "300", "api.export.quality": "95" });
      var hi = m.probe("estimate");
      m.setParams({ "api.export.mode": "vector", "api.export.dpi": "300" });
      var vec = m.probe("estimate");
      return { lo: lo, hi: hi, vec: vec };
    })()`);
  const kb = (s) => Number(String(s).replace(/[^0-9.]+/g, "") || 0);
  truthy("raster estimate grows with dpi+quality", kb(est.hi) > kb(est.lo));
  truthy("vector estimate ignores dpi", kb(est.vec) > 0 && kb(est.vec) !== kb(est.hi));

  // 9. instances + error states surface toasts/modals (visual state, not text)
  const inst = await evaluate(`
    (function () {
      var m = window.__autoStampMock;
      m.setState("opened");
      var before = m.probe("instances");
      m.q("#instance-add").click();
      m.q("#instance-duplicate").click();
      return { before: before, after: m.probe("instances") };
    })()`);
  cmp("instance add + duplicate", inst, { before: 2, after: 4 });

  const errStates = await evaluate(`
    (function () {
      var m = window.__autoStampMock;
      var out = {};
      ["open-error", "password-error", "save-error", "warn-no-text", "warn-large-page"].forEach(function (s) {
        m.setState(s);
        out[s] = document.documentElement.getAttribute("data-toast") === "true" &&
          document.documentElement.getAttribute("data-toast") !== null &&
          !!m.q("#error-toast").textContent.trim();
      });
      m.setState("save-confirm");
      out.saveModal = document.documentElement.getAttribute("data-modal") === "save";
      m.setState("replace-confirm");
      out.replaceModal = document.documentElement.getAttribute("data-modal") === "confirm";
      m.setModal(null);
      return out;
    })()`);
  for (const [k, v] of Object.entries(errStates)) truthy(`state ${k} surfaces its toast/modal`, v);

  // 10. keyboard shortcuts registered by the mock (UI_SPEC §5)
 const keys = await evaluate(`
    (function () {
      var m = window.__autoStampMock;
      m.setState("stamp-selected");
      var out = { rows: m.qa("#shortcuts-table tr").length };
      var press = function (key, opt) {
        window.dispatchEvent(new KeyboardEvent("keydown", Object.assign({ key: key, bubbles: true, cancelable: true }, opt || {})));
      };
      var before = m.probe("instances");
      press("Delete");
      out.delInstances = m.probe("instances");
      out.before = before;
      m.setParams({ "api.apply.pos": "100,100" });
      var x0 = m.S.geo[m.S.selId].x;
      press("ArrowRight");
      var x1 = m.S.geo[m.S.selId].x;
      press("ArrowRight", { shiftKey: true });
      var x2 = m.S.geo[m.S.selId].x;
      out.nudge = { a: x1 - x0, b: x2 - x1 };
      var s0 = m.S.p["apply.scale"];
      press("+");
      out.scaleStep = Number((m.S.p["apply.scale"] - s0).toFixed(4));
      press("s", { ctrlKey: true });
      out.saveModal = document.documentElement.getAttribute("data-modal");
      press("Escape");
      out.afterEsc = document.documentElement.getAttribute("data-modal");
      press("?");
      out.shortcutsModal = document.documentElement.getAttribute("data-modal");
      press("Escape");
      m.setState("opened");
      return out;
    })()`);
  cmp("Del removes the selected instance", { before: keys.before, after: keys.delInstances }, { before: 4, after: 3 });
  cmp("arrows nudge 1pt / Shift 10pt", keys.nudge, { a: 1, b: 10 });
  cmp("+ bumps scale by 0.01", keys.scaleStep, 0.01);
  cmp("Ctrl+S opens the save dialog", keys.saveModal, "save");
  cmp("Esc closes it", keys.afterEsc, null);
  cmp("? opens the shortcut list", keys.shortcutsModal, "shortcuts");
  truthy("shortcut table rows match the registered keys", keys.rows >= 9);

  if (consoleLines.length) bad("final console errors: " + consoleLines.join(" | "));
  if (netFailures.length) bad("final resource failures: " + netFailures.join(" | "));

  console.log(`ui-smoke: states=${states.length} i18nKeys=${Object.keys(cnSnapshot).length} consoleErrors=${consoleLines.length}`);
  if (fails.length) {
    console.error("--- FAILURES ---");
    fails.forEach((f) => console.error("  " + f));
    console.error(`ui-smoke: ${fails.length} failure(s)`);
    return 1;
  }
  console.log("ui-smoke: OK");
  return 0;
}

async function cleanup() {
  try {
    if (ws && ws.readyState === 1) await send("Browser.close").catch(() => {});
  } catch {}
  if (ws) try { ws.close(); } catch {}
  if (chromeProc) chromeProc.kill();
  if (profile && process.argv.includes("--keep-profile")) console.log("profile kept:", profile);
  else if (profile) {
    for (let i = 0; i < 5; i++) {
      try {
        rmSync(profile, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }
}

let code = 0;
try {
  code = await main();
} catch (e) {
  console.error("ui-smoke: FATAL", e && e.message ? e.message : e);
  code = 1;
}
await cleanup();
process.exit(code);
