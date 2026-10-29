// Copyright 2026 AutoStamp Authors. SPDX-License-Identifier: Apache-2.0
// app-api.js — HTTP wrapper for the /api/* contract (AGENTS §6).
//
// JSON in, JSON out. A non-2xx response is thrown as an ApiError carrying the
// server's {code, message} so the shell can show both in one toast. Settings
// writes are PATCH-style merges (config.Patch), so a partial body is correct
// and never round-trips the whole document.
(() => {
  "use strict";

  class ApiError extends Error {
    constructor(status, code, message) {
      super(message || code || `HTTP ${status}`);
      this.name = "ApiError";
      this.status = status;
      this.code = code || "http_error";
    }
  }

  async function request(path, opts) {
    const o = opts || {};
    const init = { method: o.method || "GET", headers: {}, credentials: "same-origin" };
    if (o.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(o.body);
    }
    let res;
    try {
      res = await fetch(path, init);
    } catch (e) {
      throw new ApiError(0, "network", `${path}: ${e.message}`);
    }
    let data = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (e) {
        // A 2xx body that is not JSON is a bug in our own handler; a non-2xx
        // reply with no JSON body came from the router itself (405 for a verb
        // that route does not implement, 404 from the static handler). Report
        // the status, never a parse error: the toast must show what happened.
        if (res.ok) throw new ApiError(res.status, "bad_json", `${path}: 响应不是 JSON (${res.status})`);
        throw new ApiError(res.status, `http_${res.status}`, `${path}: ${res.status} ${res.statusText || "no response body"}`);
      }
    }
    // webx.Envelope: {ok, data, code, error}. Both the HTTP status and ok are
    // checked so a 200-with-error body never looks like a success.
    if (!data || typeof data.ok !== "boolean") {
      // A router reply (empty body, non-JSON) carries the status, not a code.
      if (!res.ok) throw new ApiError(res.status, `http_${res.status}`, `${path}: ${res.status} ${res.statusText || "no response body"}`);
      throw new ApiError(res.status, "bad_envelope", `${path}: 响应缺少 ok 字段 (${res.status})`);
    }
    if (!res.ok || !data.ok) {
      throw new ApiError(res.status, data.code || `http_${res.status}`, data.error || `${path}: HTTP ${res.status}`);
    }
    return data.data;
  }

  window.__autoStampApi = {
    ApiError,
    request,
    // health reports name/version so the shell can refuse to talk to a foreign
    // loopback app that grabbed the same port.
    health: () => request("/api/health"),
    settings: () => request("/api/settings"),
    // patchSettings sends only the changed groups (pointer merge). The server
    // clamps out-of-range values instead of rejecting them, and reports which
    // value it fixed in `warning`.
    patchSettings: (patch) => request("/api/settings", { method: "POST", body: { patch } }),
  };
})();
