#!/usr/bin/env node
// tools/verify/webview-launch.mjs — P0/P7 acceptance check for the WebView2 build.
//
// It runs the real windowed binary (the console build is covered by
// shell-smoke.mjs) and waits for the "webview window opened" log line plus a
// served /api/health, then shuts the process down. The window appears on the
// desktop for a few seconds; that is the point of the check.
//
// Usage: node tools/verify/webview-launch.mjs [exe]
// Exit: 0 = window opened and the server answered.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(join(import.meta.dirname, "..", ".."));
const exe = process.argv[2] ? resolve(process.argv[2]) : join(root, "dist", "autostamp-webview.exe");
if (!existsSync(exe)) {
  console.error("webview-launch: missing build", exe, "- run build.ps1 first");
  process.exit(1);
}

const sandbox = mkdtempSync(join(tmpdir(), "autostamp-webview-launch-"));
const env = { ...process.env, APPDATA: join(sandbox, "Roaming"), LOCALAPPDATA: join(sandbox, "Local") };
const proc = spawn(exe, ["-verbose"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
let err = "";
proc.stderr.on("data", (d) => (err += d.toString()));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// clean removes the sandbox; WebView2 can hold the profile dir for a moment
// after the process dies, so this retries and then gives up quietly (Temp).
function clean(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
  } catch (e) {
    console.log("webview-launch: sandbox left behind (locked by WebView2):", dir, e.message);
  }
}
const deadline = Date.now() + 20000;
let url = null;
while (Date.now() < deadline) {
  const m = err.match(/url=(http:\/\/127\.0\.0\.1:\d+)/);
  if (m && /webview window opened/.test(err)) {
    url = m[1];
    break;
  }
  if (/webview window panic|webview window unavailable/.test(err)) break;
  await sleep(250);
}
if (!url) {
  console.error("webview-launch: the window never came up:\n" + err);
  proc.kill();
  clean(sandbox);
  process.exit(1);
}
const health = await fetch(url + "/api/health").then((r) => r.json());
console.log("webview-launch: window up,", health.data.name, health.data.version, "served at", url);
proc.kill();
clean(sandbox);
process.exit(0);
