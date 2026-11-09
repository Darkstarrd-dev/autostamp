// tools/verify/cdp.mjs — shared headless-Chrome harness for the verify scripts
// (no third-party deps; Node 24 has global WebSocket + fetch).
//
// ui-smoke.mjs (mock) and shell-smoke.mjs (served app) both need the same CDP
// plumbing, so it lives here once. Chrome's stable channel and WebView2 share
// the same rendering family (docs/FACTS.md §1), which is what makes a headless
// check a fair substitute for the WebView2 window.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CHROME_PATHS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Chromium/Chrome/Application/chrome.exe",
];

export function findChrome() {
  return CHROME_PATHS.find((p) => existsSync(p)) || null;
}

export async function openChrome(opts) {
  const o = opts || {};
  const port = o.port || 9333;
  const chromePath = findChrome();
  if (!chromePath) throw new Error(`Chrome not found (checked: ${CHROME_PATHS.join(", ")})`);

  const profile = mkdtempSync(join(tmpdir(), "autostamp-cdp-"));
  const proc = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${o.width || 1440},${o.height || 900}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  const errors = [];
  const failures = [];
  let ws = null;
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

  // awaitPromise defaults to true: every verify expression that touches /api is an
  // async IIFE. With awaitPromise:false Chrome serialises the Promise itself to `{}`
  // (returnByValue has no objectId to hang on), which reads as an empty object and
  // would silently turn a real assertion into a pass — the failure mode we want.
  const evaluate = async (expression, awaitPromise = true) => {
    const r = await send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
    if (r.exceptionDetails) throw new Error("page eval: " + JSON.stringify(r.exceptionDetails.exception));
    return r.result.value;
  };

  // waitFor is a page-side predicate expression plus a diagnostic expression.
  async function waitForReady(expr, diag, maxMs) {
    const t0 = Date.now();
    let last = "";
    for (;;) {
      try {
        const v = await evaluate(expr);
        if (v === true) return;
        last = "value=" + JSON.stringify(v) + " diag=" + JSON.stringify(await evaluate(diag).catch(() => null));
      } catch (e) {
        last = String((e && e.message) || e);
      }
      if (Date.now() - t0 > maxMs) throw new Error(`page never ready: ${last}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  // DevTools targets appear a moment after launch; poll the JSON list instead
  // of --remote-debuging-ws (its output is unstable across Chrome versions).
  async function waitForDebugger(maxMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`);
        const list = await res.json();
        const page = list.find((t) => t.type === "page");
        if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
      } catch {}
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error("chrome devtools endpoint never came up");
  }

  const wsUrl = await waitForDebugger(15000);
  await new Promise((ok, no) => {
    ws = new WebSocket(wsUrl);
    ws.addEventListener("open", ok);
    ws.addEventListener("error", () => no(new Error("cdp connect failed")));
  });

  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id !== undefined) return;
    if (m.method === "Runtime.consoleAPICalled") {
      const e = m.params;
      if (e.type === "error" || e.type === "assert") {
        errors.push("console." + e.type + ": " + (e.args || []).map((a) => a.value ?? a.description ?? a.type).join(" "));
      }
    }
    if (m.method === "Log.entryAdded") {
      const e = m.params.entry;
      if (e.level === "error") errors.push("log.error: " + e.text + " " + (e.url || ""));
    }
    // uncaught script errors (e.g. a module that fails to parse) surface here,
    // not consoleAPICalled: without this the shell group could silently miss a
    // whole file and the checks below would still "pass" on stale hooks.
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      const desc = (d.exception && (d.exception.description || d.exception.value)) || d.text || "";
      errors.push("uncaught: " + desc + " @ " + (d.url || "?") + ":" + (d.lineNumber ?? "?"));
    }
    if (m.method === "Network.loadingFailed") failures.push(m.params.errorText + " " + (m.params.url || ""));
    if (m.method === "Network.responseReceived") {
      const r = m.params.response;
      if (r.status >= 400) failures.push(r.status + " " + r.url);
    }
  });

  await send("Network.enable");
  await send("Log.enable");
  await send("Runtime.enable");
  await send("Page.enable");
  if (o.url) {
    await send("Page.navigate", { url: o.url });
    if (o.waitFor) await waitForReady(o.waitFor, o.diag || "'n/a'", o.readyMs || 15000);
  }

  let closed = false;
  const api = {
    send,
    evaluate,
    errors,
    failures,
    setViewport: (w, h) =>
      send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }),
    navigate: (url) => send("Page.navigate", { url }),
    // responseHeaders returns the main-document response headers of the last
    // navigation (Network.getAllResponses is not a CDP command; the harness
    // re-fetches from the page instead).
    close: async (keepProfile) => {
      if (closed) return;
      closed = true;
      try {
        if (ws && ws.readyState === 1) await send("Browser.close").catch(() => {});
      } catch {}
      if (ws) try { ws.close(); } catch {}
      if (proc) proc.kill();
      if (keepProfile) console.log("profile kept:", profile);
      else {
        for (let i = 0; i < 5; i++) {
          try {
            rmSync(profile, { recursive: true, force: true });
            break;
          } catch {
            await new Promise((r) => setTimeout(r, 400));
          }
        }
      }
    },
  };
  return api;
}

// cmp/truthy keep the same terse reporting style the older scripts used.
export function makeReport(fails) {
  const bad = (msg) => fails.push(msg);
  const cmp = (name, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g !== w) bad(`${name}: got ${g} want ${w}`);
    else console.log("  ok " + name + " = " + g);
  };
  const truthy = (name, v) => {
    if (!v) bad(`${name}: falsy (${JSON.stringify(v)})`);
  };
  return { bad, cmp, truthy };
}
