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
//   * the empty state keeps one load entry (HD19: the centered big square-rounded
//     #empty-pick button + the paste/drag hint; the path box is dead),
//     with the left column bleeding to its edges (HD7)
//
// Usage: node tools/verify/ui-smoke.mjs [--keep-profile]
// Exit: 0 = pass.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openChrome } from "./cdp.mjs";

const root = resolve(join(fileURLToPath(import.meta.url)), "..", "..", "..");

const PORT = Number(process.env.UI_SMOKE_PORT || 9333);
const mockUrl = pathToFileURL(join(root, "docs", "ui", "mockup.html")).href;

const fails = [];
const bad = (msg) => fails.push(msg);

let cdp = null;
let consoleLines = [];
let netFailures = [];
const send = (m, p) => cdp.send(m, p);
const evaluate = (e, a) => cdp.evaluate(e, a);

async function boot() {
  cdp = await openChrome({
    port: PORT,
    url: mockUrl,
    waitFor: "!!(window.__autoStampMock && window.__autoStampMock.STATES)",
    diag: "document.readyState + '|' + location.href.slice(-28) + '|' + (window.__autoStampMock ? 'mock' : 'nomock')",
  });
  consoleLines = cdp.errors;
  netFailures = cdp.failures;
}

function viewport(w, h) {
  return cdp.setViewport(w, h);
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

  // 3b. SP5 (2026-11-06): the right sidebar is dead — #preview bleeds to both
  // window edges, so its width equals the app-main width at both contract
  // viewports (no density control may come back either).
  for (const [w, h] of [[1280, 720], [1440, 900]]) {
    await viewport(w, h);
    const fixed = await evaluate(`
      (function () {
        var m = window.__autoStampMock;
        var main = m.q("#app-main");
        return {
          sidebar: Boolean(document.querySelector("#right-sidebar")),
          previewW: Math.round(m.q("#preview").getBoundingClientRect().width),
          mainW: main.clientWidth,
          densityAttr: main.hasAttribute("data-density"),
          densityCtl: Boolean(m.q("#density-seg")),
          overflow: m.probe("overflow"),
        };
      })()`);
    cmp(`${w}x${h} SP5 single-col layout`, [fixed.sidebar, fixed.overflow], [false, false]);
    truthy(`${w}x${h}: #preview fills #app-main`, Math.abs(fixed.previewW - fixed.mainW) <= 1);
    console.log(`  ${w}x${h}: #preview ${fixed.previewW}px, #app-main client ${fixed.mainW}px`);
    if (fixed.sidebar) bad(`${w}x${h}: #right-sidebar is back — the layout is single-col (SP5)`);
    if (fixed.overflow) bad(`${w}x${h}: horizontal overflow in the SP5 single-col layout`);
    if (fixed.densityAttr || fixed.densityCtl) bad(`${w}x${h}: the density control/density attribute is still live`);
  }

  // 3c. the empty state is the load contract (HD19: one centered large
  // rounded-square button + the paste/drag hint; the path box is gone) and the
  // left column bleeds (HD7: no margin/rounding on the empty stage or the page
  // frames); the removed ids stay dead (HD5/HD6/HD19).
  const load = await evaluate(`
    (function () {
      var m = window.__autoStampMock;
      var cs = function (sel) { return getComputedStyle(m.q(sel)); };
      var out = {};
      out.deadIds = ["top-file", "empty-open", "empty-upload", "file-input",
        "empty-path", "empty-pick-multi", "empty-pick-filter"].filter(function (id) { return document.getElementById(id); });
      var bar = document.querySelector("#topbar");
      var stray = [];
      for (var n = bar.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3 && n.nodeValue.trim()) stray.push(n.nodeValue.trim());
      }
      Array.prototype.forEach.call(bar.children, function (el) {
        if (el.tagName === "BUTTON" || el.tagName === "SELECT" || el.matches(".seg, .spacer")) return;
        if (el.textContent.trim()) stray.push((el.id || el.className) + ": " + el.textContent.trim());
      });
      out.barStray = stray;
      m.setState("opened");
      out.bleed = {
        emptyMargin: cs("#empty-state").marginTop,
        emptyRadius: cs("#empty-state").borderTopLeftRadius,
        emptyBorder: cs("#empty-state").borderTopStyle,
        stagePadding: cs("#preview-stage").paddingLeft,
        frameRadius: cs(".page-frame").borderTopLeftRadius
      };
      m.setState("empty");
      // HD19: the empty state hosts exactly one centered large square-rounded
      // button (#empty-pick) + the paste/drag hint, and nothing else.
      var btn = m.q("#empty-pick");
      var kids = Array.prototype.map.call(m.q("#empty-state").children, function (el) {
        return el.tagName + (el.id ? "#" + el.id : "." + String(el.className).split(" ")[0]);
      });
      var bcs = cs("#empty-pick");
      out.shape = { kids: kids.join("|"), w: bcs.width, h: bcs.height, radius: bcs.borderTopLeftRadius };
      btn.click(); // the mock's pickAndOpen is the simulated native picker
      out.pickedState = m.probe("state");
      m.setState("empty");
      out.pickEn = m.q("#empty-pick .elabel").textContent.trim();
      m.applyLang("cn");
      out.pickCn = m.q("#empty-pick .elabel").textContent.trim();
      m.applyLang("en");
      return out;
    })()`);
  if (load.deadIds.length) bad("ids deleted by HD5/HD6/HD19 are back in the mock: " + load.deadIds.join(" "));
  if (load.barStray.length) bad("the mock topbar carries stray text (HD5): " + load.barStray.join(" | "));
  cmp("the only empty-state load entry is #empty-pick (Open file/打开文件)", [load.pickEn, load.pickCn], ["Open file", "打开文件"]);
  cmp("HD19: one 156 px square-rounded button + hint opens the mock picker on click",
    [load.shape.kids, load.shape.w, load.shape.h, load.shape.radius, load.pickedState],
    ["BUTTON#empty-pick|DIV.hint", "156px", "156px", "16px", "opened"]);
  cmp("HD7: empty stage bleeds into the column, dashed border kept",
    [load.bleed.emptyMargin, load.bleed.emptyRadius, load.bleed.emptyBorder, load.bleed.stagePadding, load.bleed.frameRadius],
    ["0px", "0px", "dashed", "0px", "0px"]);

  // the mock fixtures load over file://; the seal canvas needs the bytes first
  await evaluate(`new Promise(function (resolve) {
    var t = setInterval(function () {
      if (window.__autoStampMock.probe("images").seal) { clearInterval(t); resolve(true); }
    }, 50);
    setTimeout(function () { clearInterval(t); resolve(false); }, 4000);
  })`).then((v) => { if (!v) bad("mock fixtures never loaded"); });

  // 3d. HD8-HD12: the seal channel + floating panel live in the left column now.
  // Assert the header order, the dropdown content, the toggle, the stale-entry
  // fallback, and that the sidebar really lost the overlay/position sections.
  const seals = await evaluate(`
    (function () {
      var m = window.__autoStampMock;
      m.setState("stamp-selected");
      var out = {};
      out.barSeq = Array.prototype.map.call(
        document.querySelectorAll("#topbar button, #topbar select"),
        function (el) { return el.id; })
        .filter(function (id) { return id; }).join(",");
      out.dead = ["panel-overlay", "panel-position", "pos-center", "apply-pos",
        "apply-anchor", "apply-offset", "apply-pages"].filter(function (id) { return document.getElementById(id); });
      out.geoInputs = m.probe("geoInputs");
      out.addModeBefore = m.probe("addMode");
      m.q("#btn-seal-add").click();
      out.addModeAfter = m.probe("addMode");
      m.q("#btn-seal-add").click();
      out.addModeOff = m.probe("addMode");
      out.recent = m.probe("recentSeals");
      var sel = m.q("#seal-recent-select");
      sel.value = "C:\\\\seals\\\\不存在.png";
      sel.dispatchEvent(new Event("change"));
      var names = m.probe("recentSeals");
      out.staleRemoved = names.names.indexOf("被删的旧章") < 0 &&
        names.paths.indexOf("C:\\\\seals\\\\不存在.png") < 0;
      var tt = m.q("#error-toast");
      out.staleToast = document.documentElement.getAttribute("data-toast") === "true" &&
        (tt.textContent || "").indexOf("no longer exists") >= 0;
      m.clearToast();
      out.panel0 = m.probe("instancePanel");
      m.q("#instance-fab").click();
      out.panel = m.probe("instancePanel");
      m.q("#instance-collapse").click();
      out.panelBack = m.probe("instancePanel");
      out.preview = m.probe("sealPreview");
      out.consoleBefore = m.probe("console");
      m.q("#btn-console").click();
      out.consoleOpen = m.probe("console");
      m.q("#btn-console").click();
      out.consoleClosed = m.probe("console");
      out.h = [m.q("#btn-open"), m.q("#seal-recent-select"), m.q("#btn-console"), m.q("#btn-shortcuts")].map(function (e) { return Math.round(e.getBoundingClientRect().height); });
      return out;
    })()`);
  cmp("HD8: header carries open → seal upload → recent seals → add mode → cross-page add mode → save → backend log → shortcuts", seals.barSeq,
    "btn-open,btn-seal-upload,seal-recent-select,btn-seal-add,btn-crosspage-add,btn-save,btn-console,btn-shortcuts");
  if (seals.dead.length) bad("HD11/HD12 deleted ids are back in the mock: " + seals.dead.join(" "));
  cmp("HD11: no pos/anchor/offset/pages input inside the sidebar panel",
    [seals.geoInputs, seals.addModeBefore.on, seals.addModeAfter.on, seals.addModeAfter.cursor, seals.addModeOff.on],
    [0, false, true, true, false]);
  if (!seals.recent.names.length || !seals.recent.paths.length) bad("HD8: recent-seals dropdown is empty");
  if (seals.recent.names.some((n) => /\.(png|jpe?g)$/i.test(n)))
    bad("HD8: dropdown labels must drop the file extension: " + seals.recent.names.join(" | "));
  if (seals.recent.paths.some((p) => !/^[a-zA-Z]:\\/.test(p)))
    bad("HD8: dropdown values must carry the full path: " + seals.recent.paths.join(" | "));
  cmp("HD8: choosing a deleted file removes the entry + settings record",
    [seals.staleRemoved, seals.staleToast], [true, true]);
  cmp("HD18/HD12: gear fab opens the panel (params there), minimize collapses again",
    [seals.panel0.collapsed, seals.panel0.fabVisible, seals.panel0.visible,
      seals.panel.visible, seals.panel.hasControls,
      seals.panelBack.collapsed, seals.panelBack.visible],
    [true, true, false, true, true, true, false]);
  cmp("HD9: bottom-left seal preview paints the current seal",
    [seals.preview.visible, seals.preview.painted, Boolean(seals.preview.name)], [true, true, true]);
  cmp("HD16: the mock toggle flips panel visibility with the aria-pressed pair",
    [seals.consoleBefore.visible, seals.consoleOpen.visible, seals.consoleOpen.pressed,
      seals.consoleClosed.visible, seals.consoleClosed.pressed],
    [false, true, "true", false, "false"]);
  cmp("HD15: the mock topbar controls share one 34px height",
    [new Set(seals.h).size, seals.h[0]], [1, 34]);
  await evaluate('window.__autoStampMock.setState("empty")');

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

  // 4b. icon tooltips: every [data-i18n-title] control carries a cn twin, and
  // applyLang must land it on title + aria-label (the accessible name).
  const tooltips = await evaluate(`
    (function () {
      var m = window.__autoStampMock;
      var read = function () {
        return m.qa("[data-i18n-title]").map(function (e) {
          return {
            key: e.getAttribute("data-i18n-title"),
            twin: e.getAttribute("data-i18n-title-cn"),
            title: e.getAttribute("title"),
            label: e.getAttribute("aria-label")
          };
        });
      };
      m.applyLang("cn");
      var cn = read();
      m.applyLang("en");
      var en = read();
      return { cn: cn, en: en };
    })()`);
  if (!tooltips.cn || !tooltips.cn.length) bad("the mock has no [data-i18n-title] control: every icon button needs a tooltip");
  const bareTwin = tooltips.cn.filter((t) => !(t.twin || "").trim());
  if (bareTwin.length) bad("tooltip keys without data-i18n-title-cn: " + bareTwin.map((t) => `${t.key}(${JSON.stringify(t.twin)})`).join(" "));
  const enTitle = (tooltips.en || []).filter((t) => /[一-鿿]/.test(t.title || ""));
  if (enTitle.length) bad("cn tooltip left over in en mode: " + enTitle.map((t) => `${t.key}(${JSON.stringify(t.title)})`).join(" "));
  const enLabel = (tooltips.en || []).filter((t) => !(t.label || "").trim());
  if (enLabel.length) bad("icon control without aria-label in en mode: " + enLabel.map((t) => t.key).join(" "));
  const cnMismatch = (tooltips.cn || []).filter((t) => t.title !== t.twin || t.label !== t.twin);
  if (cnMismatch.length) bad("cn tooltip not on title/aria-label: " + cnMismatch.map((t) => `${t.key}(title=${JSON.stringify(t.title)},label=${JSON.stringify(t.label)})`).join(" "));

  // 4c. ui.lang really swaps the panel field labels (leaf-level i18n targets)
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
  truthy("panel labels exist for every field group (18 after Z5)", labels.total >= 17 && labels.total <= 18);
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
      m.setState("crosspage");               // SP4: the placed strip instance
      var placed = m.probe("crosspageAdd");
      var before = m.probe("strip");
      m.q('#crosspage-binding button[data-value="alternate"]').click();
      var pressed = m.q('#crosspage-binding button[data-value="alternate"]').getAttribute("aria-pressed");
      var after = m.probe("strip");
      // UI4 N4: the placement click rides the percent channel - the mock's
      // crosspage driver clicks at y = 60 on the A4 page model (595.3 x 841.9),
      // so pct = clamp(round1((1 - pt.y / (pageH - h)) x 100), 0, 100) with
      // h = apply.scale x page width (the aspect-1 seal fixture).
      var pctScale = Number(m.S.p["apply.scale"]);
      var pctTravel = 841.9 - pctScale * 595.3;
      var pctWant = Math.max(0, Math.min(100, Math.round((1 - 60 / pctTravel) * 1000) / 10));
      return {
        model: m.S.p["ui.crosspage.binding"], pressed: pressed, probe: after,
        placedMode: placed.mode, placedOn: placed.on, placedCp: placed.cpFields,
        placedOffset: placed.startOffset, pctWant: pctWant, sideBefore: before.side,
        cpVisible: getComputedStyle(m.q("#crosspage-binding")).display !== "none",
      };
    })()`);
  cmp("SP4 placement: mode button + cp group + placed strip instance",
    { on: seg.placedOn, cpFields: seg.placedCp, mode: seg.placedMode },
    { on: true, cpFields: true, mode: "crosspage" });
  truthy(`the placed strip echoes the click-height PERCENT exactly (startOffset=${seg.placedOffset}, want ${seg.pctWant}, 0..100)`,
    seg.placedOffset >= 0 && seg.placedOffset <= 100 && Math.abs(seg.placedOffset - seg.pctWant) < 0.05);
  cmp("binding segmented writes model + aria (selected strip)", { model: seg.model, pressed: seg.pressed }, { model: "alternate", pressed: "true" });
  cmp("crosspage strips (5-page demo doc, one strip per page)", { strips: seg.probe.strips, side: seg.sideBefore }, { strips: 5, side: "right" });
  truthy("cp group visible on the floating panel (SP4)", seg.cpVisible);

  // 5b. state machine drives surfaces (UI_SPEC §1)
  const vis = await evaluate(`
    (function () {
      var m = window.__autoStampMock;
      var out = {};
      var disp = function (sel) { var e = m.q(sel); return e ? getComputedStyle(e).display : "missing"; };
      m.setState("stamp-selected");
      m.drive("addInstance", {}); // plain instances exist from the add drivers
      out.selBoxCount = document.querySelectorAll("#preview-stage .instance .sel-box").length;
      out.selBoxShown = disp("#preview-stage .instance .sel-box") !== "none";
      m.setState("opened");
      out.selBoxHidden = m.probe("instances") === 0 &&
        document.querySelectorAll("#preview-stage .instance .sel-box").length === 0;
      m.setState("empty");
      out.emptyShown = disp("#empty-state") !== "none" && disp("#preview-stage") === "none";
      m.setState("opened");
      out.crossHidden = !m.probe("cpGroup").visible;
      m.setState("crosspage");
      out.crossGroup = m.probe("cpGroup").visible;
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
      m.drive("runSplit", { splitMode: "unsplit" });      // D3: plain pages via the drive API
      m.setState("stamp-selected");                        // openFile resets instances, then place
      var base = m.probe("instances");
      m.drive("addInstance", { name: "A" });
      m.drive("addInstance", { name: "B" });
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
        instances: m.probe("instances") - base,
        pages: m.S.pages.length, splitOn: m.S.splitOn,
      };
    })()`);
  cmp("split off -> plain pages, selected instances in DOM",
    { splitAttr: geo.splitAttr, splitOn: geo.splitOn, pages: geo.pages, instances: geo.instances, boxes: geo.selBoxes >= geo.instances },
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
  cmp("crosspage strips (split 10-page doc, one strip per page)", { strips: split.strips.strips, side: split.strips.side }, { strips: 10, side: "right" });

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
      m.drive("addInstance", { name: "A" });
      m.drive("duplicateInstance");
      return { delta: m.probe("instances") - before };
    })()`);
  cmp("instance add + duplicate", inst, { delta: 2 });

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
      m.drive("addInstance", { name: "K" }); // keyboard targets placed instances
      m.drive("addInstance", { name: "L" }); // Del keeps the selection (HD17 zero-OK)
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
  cmp("Del removes the selected instance", { delta: keys.delInstances - keys.before }, { delta: -1 });
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
  if (cdp) await cdp.close(process.argv.includes("--keep-profile"));
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
