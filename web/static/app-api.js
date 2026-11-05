// Copyright 2026 AutoStamp Authors. SPDX-License-Identifier: Apache-2.0
// app-api.js — HTTP wrapper for the /api/* contract (AGENTS §6).
//
// JSON in, JSON out. A non-2xx response is thrown as an ApiError carrying the
// server's {code, message} so the shell can show both in one toast. Settings
// writes are PATCH-style merges (config.Patch), so a partial body is correct
// and never round-trips the whole document.
(() => {
  "use strict";

  // ---------- session owner token ----------
  //
  // internal/webx/session.go: the token *is* the capability that scopes every
  // asset and every path grant in the session store. It is minted here (128
  // random bits, 32 hex chars) and echoed on every /api request.
  //
  // sessionStorage rather than localStorage: a reload must keep the open
  // document addressable, while a fresh tab/window must not silently inherit
  // another window's assets (AGENTS §5.11).
  const SESSION_HEADER = "X-AutoStamp-Session";
  const SESSION_KEY = "autostamp.session";

  function sessionToken() {
    let tok = "";
    try {
      tok = sessionStorage.getItem(SESSION_KEY) || "";
    } catch (e) {
      // A disabled storage backend (private mode, blocked cookies) still gets a
      // token for this document; the worst case is that a reload re-opens.
    }
    if (/^[0-9a-f]{32}$/.test(tok)) return tok;
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    tok = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
    try {
      sessionStorage.setItem(SESSION_KEY, tok);
    } catch (e) { /* see above */ }
    return tok;
  }

  class ApiError extends Error {
    constructor(status, code, message) {
      super(message || code || `HTTP ${status}`);
      this.name = "ApiError";
      this.status = status;
      this.code = code || "http_error";
    }
  }

  // envelopeOf unwraps webx.Envelope: {ok, data, code, error}. Both the HTTP
  // status and ok are checked so a 200-with-error body never looks like a
  // success.
  async function envelopeOf(res, path) {
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

  async function request(path, opts) {
    const o = opts || {};
    const init = { method: o.method || "GET", headers: {}, credentials: "same-origin" };
    if (o.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(o.body);
    }
    // Every /api route needs the owner token; the static asset handler ignores
    // it, so sending it unconditionally is harmless and hard to forget.
    init.headers[SESSION_HEADER] = sessionToken();
    let res;
    try {
      res = await fetch(path, init);
    } catch (e) {
      throw new ApiError(0, "network", `${path}: ${e.message}`);
    }
    return envelopeOf(res, path);
  }

  // uploadMultipart is the single multipart channel every upload route shares:
  // any number of string fields plus file parts (name, blob, filename). It is
  // the place the session header, the same-origin credentials and the envelope
  // unwrapping live — every other upload route is a shape over it, so an upload
  // cannot fork a second copy of the error handling.
  async function uploadMultipart(path, fields, files) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields || {})) fd.append(k, String(v));
    for (const f of files || []) fd.append(f.name, f.blob, f.filename || f.name);
    const init = {
      method: "POST",
      body: fd,
      credentials: "same-origin",
      headers: { [SESSION_HEADER]: sessionToken() },
    };
    let res;
    try {
      res = await fetch(path, init);
    } catch (e) {
      throw new ApiError(0, "network", `${path}: ${e.message}`);
    }
    return envelopeOf(res, path);
  }

  // uploadPDF is the drag/drop and paste channel: multipart/form-data with
  // a `file` field. The route is wrapped in MaxBytesHandler (256 MiB,
  // AGENTS §5.11), so an oversized drop is refused before it ever lands.
  async function uploadPDF(file, pw) {
    const fields = {};
    if (pw) fields.pw = pw;
    return uploadMultipart("/api/pdf/open", fields, [{ name: "file", blob: file, filename: file.name }]);
  }

  // uploadPOST is the single-`file` multipart shape the seal route speaks
  // (a `file` field plus the option fields it understands).
  async function uploadPOST(path, file, fields) {
    return uploadMultipart(path, fields, [{ name: "file", blob: file, filename: file.name }]);
  }
  // sealPrepareGrant posts the JSON shape of /api/pdf/seal/prepare (HD8): the
  // native picker's grant instead of a multipart file. The server reads the
  // file itself (path + extension whitelist) and records the recent-seal
  // entry, so the caller never touches the bytes.
  async function sealPrepareGrant(pathGrantId, fields) {
    return request("/api/pdf/seal/prepare", {
      method: "POST",
      body: Object.assign({ pathGrantId }, fields || {}),
    });
  }


  window.__autoStampApi = {
    ApiError,
    request,
    session: sessionToken,
    // sessionHeader is the header *name* pdf.js has to be given: it issues its own
    // fetch for /api/pdf/raw, so the token cannot ride app-api's fetch wrapper.
    sessionHeader: SESSION_HEADER,
    // health reports name/version so the shell can refuse to talk to a foreign
    // loopback app that grabbed the same port.
    health: () => request("/api/health"),
    settings: () => request("/api/settings"),
    // patchSettings sends only the changed groups (pointer merge). The server
    // clamps out-of-range values instead of rejecting them, and reports which
    // value it fixed in `warning`.
    patchSettings: (patch) => request("/api/settings", { method: "POST", body: { patch } }),
    // HD16: the log tail (ring-backed); poll while the panel is visible and
    // pass the previous "next" back as "since" so no line is re-sent.
    logs: (since) => request(`/api/logs?since=${Number(since) || 0}`),

    sealPrepareGrant,

    // --- P1: the local-file channel (AGENTS §6) ---

    // pick shows the native dialog (filePath set = typed-path channel, which
    // grants what is already on disk). Cancelled = {cancelled: true, picks: []}.
    pick: (body) => request("/api/fs/pick", { method: "POST", body: body || {} }),
    openGrant: (pathGrantId, opts) =>
      request("/api/pdf/open", {
        method: "POST",
        body: {
          pathGrantId,
          pw: (opts && opts.pw) || "",
          name: (opts && opts.name) || "",
        },
      }),
    uploadPDF,
    // rawURL is what pdf.js fetches; Range/ETag come from http.ServeContent.
    rawURL: (assetId) => `/api/pdf/raw?id=${encodeURIComponent(assetId)}`,

    // --- P2: the seal image channel (AGENTS §6) ---

    // sealPrepare uploads the PNG/JPEG and asks the server to key/trim/resample
    // it; the response carries sealId + the alpha metadata the panel shows.
    sealPrepare: (file, options) => uploadPOST("/api/pdf/seal/prepare", file, options || {}),
    uploadPOST,
    uploadMultipart,
    // sealURL is the prepared byte channel. The session token cannot ride an
    // <img>, so app-seal.js fetches it as a blob and keeps an ImageBitmap.
    sealURL: (sealId) => `/api/pdf/seal/raw?id=${encodeURIComponent(sealId)}`,
    // bitmapOf fetches with the session header and turns the body into an
    // ImageBitmap (createImageBitmap never touches CSP, unlike <img src>).
    bitmapOf: async (url) => {
      const res = await fetch(url, { credentials: "same-origin", headers: { [SESSION_HEADER]: sessionToken() } });
      if (!res.ok) throw new ApiError(res.status, `http_${res.status}`, `${url}: ${res.statusText}`);
      return createImageBitmap(await res.blob());
    },

    // --- P6: the seal preset library + the batch render channel ---

    // The preset routes are plain JSON (AGENTS §6): the library stores the
    // seal IMAGE server-side, so save/load/delete never re-upload bitmap bytes.
    presetList: () => request("/api/seal/preset"),
    presetSave: (body) => request("/api/seal/preset", { method: "POST", body }),
    presetDelete: (name) =>
      request(`/api/seal/preset?name=${encodeURIComponent(name)}`, { method: "DELETE" }),
    presetRawURL: (name) => `/api/seal/preset/raw?id=${encodeURIComponent(name)}`,

    // rawBytes fetches a stored byte stream (a preset's PNG or a session
    // asset's PDF) with the owner token. The batch re-prepares the preset
    // image through seal/prepare and re-renders the stamped document through
    // pdf.js, so both consumers want the bytes, not a URL.
    rawBytes: async (url) => {
      const res = await fetch(url, { credentials: "same-origin", headers: { [SESSION_HEADER]: sessionToken() } });
      if (!res.ok) throw new ApiError(res.status, `http_${res.status}`, `${url}: ${res.statusText}`);
      return res.arrayBuffer();
    },
  };
})();
