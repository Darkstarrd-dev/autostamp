#!/usr/bin/env node
// tools/verify/ui-contract.mjs — three-way UI contract check (P0.5;常驻回归).
//
// Checks that docs/ui/mockup.html, docs/UI_SPEC.md and AGENTS.md §6 agree:
//   mock data-field  <->  UI_SPEC §2 field table  <->  AGENTS §6 route prefixes
// plus state names, i18n keys (UI_SPEC §4: the mock plus web/static/index.html),
// the DOM id contract (UI_SPEC §6), fixture presence, and structural guards
// (no pdf.js annotation-save channel).
//
// Usage: node tools/verify/ui-contract.mjs
// Exit: 0 = pass, 1 = failures (each printed with a CODE tag).

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const mockPath = "docs/ui/mockup.html";
const specPath = "docs/UI_SPEC.md";

const fails = [];
const notes = [];
const bad = (code, msg) => fails.push(`${code}: ${msg}`);

// ---------- 1. mock ----------
if (!existsSync(join(root, mockPath)) || !existsSync(join(root, specPath))) {
  console.error("FATAL: mockup.html or docs/UI_SPEC.md missing");
  process.exit(1);
}
const mock = read(mockPath);
const all = (re) => {
  const out = [];
  for (const m of mock.matchAll(re)) out.push(m[1]);
  return out;
};
const mockFieldsRaw = [...new Set(all(/data-field="([^"]+)"/g))];
const mockFields = mockFieldsRaw.filter((f) => /^(api|ui|decision)\.[A-Za-z0-9_.]+$/.test(f));
const mockI18nKeys = [...new Set(all(/data-i18n(?:-title)?="([^"]+)"(?!-)/g))];
const mockPlaceholders = [...new Set(all(/data-i18n-placeholder="([^"]+)"/g))];
const mockIds = [...new Set(all(/\sid="([^"]+)"/g))];
const initState = (mock.match(/<html[^>]*data-state="([^"]+)"/) || [])[1];
const statesBlock = (mock.match(/var STATES = \[([\s\S]*?)\];/) || [])[1] || "";
const mockStates = [...new Set([...statesBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]))];

for (const f of ["fixtures/page.png", "fixtures/seal.png"]) {
  if (!existsSync(join(root, "docs/ui", f))) bad("E-FIX", `fixture missing: docs/ui/${f}`);
}
if (!mock.startsWith("<!doctype html>")) bad("E-DOC", "mockup.html must start with <!doctype html>");
// AGENTS §5.9/§9: the pdf.js annotation-save channel must never appear.
for (const forb of ["annotationStorage", "saveDocument", "AnnotationEditorType"]) {
  if (mock.includes(forb)) bad("E-PDFJS", `mock references forbidden pdf.js api: ${forb}`);
}
// design artifact must stay out of the app shell
if (/web\/static/.test(mock)) bad("E-PATH", "mock must not reference the app shell path");

// ---------- 2. UI_SPEC ----------
const spec = read(specPath);
const fence = (lang) => {
  const m = spec.match(new RegExp("```" + lang + "\\n([\\s\\S]*?)```"));
  return m ? m[1] : "";
};
const block = (lang, required) => {
  const body = fence(lang);
  if (!body.trim()) bad("E-SPEC", `UI_SPEC \`\`\`${lang} block is empty`);
  return body;
};
const fieldLines = block("ui-fields", 1).split("\n").filter((l) => l.trim() && !l.startsWith("#"));
const stateLines = block("ui-states", 1).split("\n").filter((l) => l.trim() && !l.startsWith("#"));
const idLines = block("ui-ids", 1).split(/\s+/).filter((l) => l.trim() && !l.startsWith("#"));

const kv = (line) => {
  const o = {};
  for (const tok of line.trim().split(/\s+/)) {
    const i = tok.indexOf("=");
    if (i > 0) o[tok.slice(0, i)] = tok.slice(i + 1);
  }
  return o;
};
const fields = fieldLines.map(kv);
const fieldNames = fields.map((f) => f.field).filter(Boolean);
const fieldMap = new Map(fields.map((f) => [f.field, f]));
const states = stateLines.map((l) => l.trim().split(/\s+/)[0]);
const i18n = [...spec.matchAll(/^\|([A-Za-z0-9_.]+)\|([^|\n]+)\|([^|\n]+)\|$/gm)]
  .filter((m) => !/^key$|^编号$/.test(m[1]))
  .map((m) => ({ key: m[1], en: m[2].trim(), cn: m[3].trim() }));
const ids = idLines.map((l) => l.trim().split(/\s+/)[0]);

// ---------- 3. AGENTS §6 ----------
const agents = read("AGENTS.md");
const sec = agents.split(/^## /m).find((s) => s.startsWith("6. HTTP"));
if (!sec) {
  console.error("FATAL: AGENTS.md §6 not found");
  process.exit(1);
}
const routes = {};
for (const m of sec.matchAll(/`(GET|POST) (\/api\/[A-Za-z/]+)[^`]*`/g)) routes[m[2]] = true;
if (!Object.keys(routes).length) bad("E-SPEC", "AGENTS §6 has no routes");

// UI_SPEC §2 field prefix -> AGENTS §6 route (the frozen vocabulary).
const PREFIX = {
  "fs.pick": "/api/fs/pick",
  open: "/api/pdf/open",
  split: "/api/pdf/split",
  "seal.prepare": "/api/pdf/seal/prepare",
  apply: "/api/pdf/apply",
  export: "/api/pdf/export",
  // batch has no server-side job route (BM1: the front-end walks
  // fs/pick -> pdf/open -> split -> apply -> export -> save itself), so the
  // vocabulary maps onto the /api/pdf family those steps exercise.
  batch: "/api/pdf",
  save: "/api/pdf/save",
  "seal.preset": "/api/seal/preset",
};
const prefixOf = (name) => {
  const bare = name.replace(/^api\./, "");
  if (!name.startsWith("api.")) return null;
  for (const key of Object.keys(PREFIX)) if (bare.startsWith(key + ".")) return key;
  const head = bare.split(".")[0];
  return head;
};

// ---------- 4. cross checks ----------
const i18nSet = new Set(i18n.map((i) => i.key));
const specSet = new Set(fieldNames);
// dynamic i18n keys: dataset.i18n* assignments, toast(key, …) and action arrays.
const dynKeys = (() => {
  const out = new Set();
  for (const line of mock.split(String.fromCharCode(10))) {
    const m = line.match(/dataset\.i18n\w*\s*=\s*(.*)$/);
    if (!m) continue;
    for (const q of m[1].matchAll(/"([a-z][A-Za-z0-9_.]*)"/g)) out.add(q[1]);
  }
  for (const m of mock.matchAll(/toast\("([a-z][A-Za-z0-9_.]*)"/g)) out.add(m[1]);
  for (const m of mock.matchAll(/, *"([a-z][A-Za-z0-9_.]*)", *"[^"]*"]/g)) out.add(m[1]);
  for (const m of mock.matchAll(/"([a-z][A-Za-z0-9_.]*\.(?:btn|hint|on|ok|note|count|last|saved|ext))"/g)) out.add(m[1]);
  for (const junk of ["se", "export", "set", "key", "text", "k", "k."]) out.delete(junk);
  return [...out];
})();
const seenPrefix = new Set();
for (const f of mockFields) {
  if (!/^(api|ui|decision)\.[A-Za-z0-9_.]+$/.test(f)) { notes.push("ignored mock data-field literal: " + JSON.stringify(f)); continue; }
  if (!specSet.has(f)) bad("E-MOCK-FIELD", `mock data-field "${f}" is not declared in UI_SPEC §2`);
  const p = prefixOf(f);
  if (p === null) continue;
  seenPrefix.add(p);
  if (!PREFIX[p]) bad("E-ROUTE", `data-field "${f}" has unknown prefix "${p}" (UI_SPEC §2 vocabulary)`);
  else if (!Object.keys(routes).some((r) => r === PREFIX[p] || r.startsWith(PREFIX[p] + "/")))
    bad("E-ROUTE", `prefix "${p}" maps to ${PREFIX[p]} which is absent from AGENTS §6`);
}
for (const [prefix, url] of Object.entries(PREFIX)) {
  if (!Object.keys(routes).some((r) => r === url || r.startsWith(url + "/")))
    bad("E-ROUTE6", `UI_SPEC §2 prefix "${prefix}" -> ${url} is not in AGENTS §6 (sub-path routes count)`);
}
for (const f of fieldNames) {
  const ent = fieldMap.get(f);
  if (ent.ctl === "no") continue;
  if (!mockFields.includes(f)) bad("E-NO-CTRL", `UI_SPEC field "${f}" declares ctl but has no mock control`);
  if (!/^(api|ui|decision)\.[A-Za-z0-9_.]+$/.test(f))
    bad("E-NAME", `UI_SPEC field "${f}" is not a valid contract name`);
  const api = ent.api;
  if (api && api !== "-" && "api." + api !== f)
    bad("E-API-MAP", `field "${f}" api="${api}" must mirror the field name`);
  if (api && api !== "-" && !seenPrefix.has(prefixOf(f)))
    bad("E-API-ROUTE", `field "${f}" api="${api}" has no §6 route vocabulary entry`);
  const ctl = ent.i18nkey;
  if (ent.ctl === "yes" && (!ctl || ctl === "-")) bad("E-NO-I18N", `field "${f}" has ctl=yes but no i18n key`);
  if (ctl && ctl !== "-" && !i18nSet.has(ctl))
    bad("E-I18N-DECL", `field "${f}" i18n key "${ctl}" missing from the §4 block`);
}

// i18n keys: every mock key declared in §4, every §4 key used in the mock,
// and the control convention <field-minus-api.>.ctl/hint for api.* fields.
for (const k of mockI18nKeys) if (!i18nSet.has(k)) bad("E-I18N-MOCK", `mock key "${k}" missing from UI_SPEC §4`);
// web/static/index.html is the other half of the same vocabulary: a key the real
// shell binds (the path hint that #save-source / #confirm-path show when no file
// is open) is in use even when the design artifact no longer hosts it.
const shellMarkup = read("web/static/index.html");
const shellI18nKeys = [...new Set([...shellMarkup.matchAll(/data-i18n(?:-title|-placeholder)?="([^"]+)"/g)].map((m) => m[1]))];
const usedKeys = new Set([...mockI18nKeys, ...mockPlaceholders, ...dynKeys, ...shellI18nKeys]);
for (const i of i18n) {
  if (!i.en || !i.cn) bad("E-I18N-EMPTY", `UI_SPEC §4 key "${i.key}" has empty en/cn`);
  if (!usedKeys.has(i.key)) bad("E-I18N-UNUSED", `UI_SPEC §4 key "${i.key}" not used in mock`);
}

// HD6: the empty state keeps exactly one load entry, and the two deleted buttons'
// keys must stay out of the vocabulary.
const pickBtn = i18n.find((i) => i.key === "empty.pick.btn");
if (!pickBtn || pickBtn.en !== "Open file" || pickBtn.cn !== "打开文件")
  bad("E-I18N-PICK", `empty.pick.btn must be "Open file"/"打开文件", got ${JSON.stringify(pickBtn)}`);
for (const k of ["empty.open.btn", "empty.upload.btn"])
  if (i18nSet.has(k)) bad("E-I18N-GONE", `dropped key "${k}" is back in UI_SPEC §4`);
// top.file.hint survives as the save/confirm path hint, bound on both elements.
const hintRows = [...shellMarkup.matchAll(/id="(save-source|confirm-path)"[^>]*data-i18n="([^"]+)"/g)];
if (hintRows.length !== 2 || hintRows.some((m) => m[2] !== "top.file.hint"))
  bad("E-I18N-HINT", `#save-source / #confirm-path must both bind top.file.hint, got ${JSON.stringify(hintRows.map((m) => [m[1], m[2]]))}`);
for (const k of dynKeys) if (!i18nSet.has(k)) bad("E-I18N-DYN", `dynamic mock key "${k}" missing from UI_SPEC §4`);
for (const m of mock.matchAll(/data-i18n-cn="([^"]*)"/g)) if (!m[1].trim()) bad("E-I18N-CN", "empty data-i18n-cn in mock");
for (const m of mock.matchAll(/data-i18n-cn-placeholder="([^"]*)"/g)) if (!m[1].trim()) bad("E-I18N-CN", "empty data-i18n-cn-placeholder");
for (const m of mock.matchAll(/data-i18n-title-cn="([^"]*)"/g)) if (!m[1].trim()) bad("E-I18N-CN", "empty data-i18n-title-cn");
for (const f of fieldNames) {
  if (!f.startsWith("api.")) continue;
  const base = f.replace(/^api\./, "");
  for (const suffix of [".ctl", ".hint"]) {
    const key = base + suffix;
    if (!i18nSet.has(key) && !mockI18nKeys.includes(key)) continue;
    if (!mockI18nKeys.includes(key)) bad("E-I18N-CONV", `mock lacks control key "${key}" for field "${f}"`);
    if (!i18nSet.has(key)) bad("E-I18N-CONV", `UI_SPEC §4 lacks control key "${key}" for field "${f}"`);
  }
}

// states
const stateSet = new Set(states);
for (const s of mockStates) if (!stateSet.has(s)) bad("E-STATE-MOCK", `mock state "${s}" missing from UI_SPEC §1`);
for (const s of states) if (!mockStates.includes(s)) bad("E-STATE-SPEC", `UI_SPEC state "${s}" absent from mock STATES`);
if (!mockStates.includes(initState)) bad("E-STATE-INIT", `html data-state="${initState}" is not a declared state`);
for (const s of mockStates) {
  if (!new RegExp(`setState\\("${s}"\\)|case "${s}"`).test(mock) && s !== "empty")
    bad("E-STATE-IMPL", `mock state "${s}" has no setState handling`);
}

// ids
for (const id of ids) if (!mockIds.includes(id)) bad("E-ID-MISS", `contract id "#${id}" not found in mock`);
const dup = ids.filter((id) => (mock.match(new RegExp(`id="${id}"`, "g")) || []).length > 1);
if (dup.length) bad("E-ID-DUP", `duplicate ids in mock: ${dup.join(", ")}`);
// HD5/HD6 deleted these ids: neither the design artifact nor the shell may revive
// them (the §6 block above already proves they are not contract ids).
for (const [where, html] of [["mock", mock], ["web/static/index.html", shellMarkup]]) {
  for (const id of ["top-file", "empty-upload", "empty-open", "file-input"]) {
    if (html.includes(`id="${id}"`)) bad("E-ID-GONE", `deleted id "#${id}" is still in ${where}`);
  }
}

// decision table: rows must carry a confirmation record or an explicit pending marker
const decisionRows = spec.match(/^\|D[0-9]+\|.*$/gm) || [];
if (!decisionRows.length) bad("E-SPEC", "UI_SPEC has no decision rows (D1..D6)");
for (const d of decisionRows) if (/TODO/.test(d)) notes.push("decision row has TODO: " + d.slice(0, 70));

console.log(
  `ui-contract: mock fields=${mockFields.length} spec fields=${fieldNames.length} i18n=${i18n.length} ` +
    `states=${states.length} ids=${ids.length} routes=${Object.keys(routes).length}`
);
if (notes.length) {
  console.log("--- soft notes (not blocking) ---");
  notes.slice(0, 30).forEach((n) => console.log("  * " + n));
}
if (fails.length) {
  console.error("--- FAILURES ---");
  fails.forEach((f) => console.error("  " + f));
  console.error(`ui-contract: ${fails.length} failure(s)`);
  process.exit(1);
}
console.log("ui-contract: OK");
