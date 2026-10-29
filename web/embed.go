// Package web embeds the standalone app front-end (AGENTS §3).
package web

import (
	"embed"
	"io/fs"
	"log/slog"
	"net/http"
	"path"
	"strings"
)

//go:embed all:static
var static embed.FS

// Static returns the embedded site rooted at web/static. The embed root keeps
// the literal "static/" prefix, so the returned FS is rooted at the site
// directory: index.html lives at the FS root.
func Static() fs.FS {
	sub, err := fs.Sub(static, "static")
	if err != nil {
		// Contract violation, checked at init time (AGENTS §7 allows panic only
		// for this kind of manifest failure).
		panic("web: fs.Sub(static): " + err.Error())
	}
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		panic("web: embedded site has no index.html: " + err.Error())
	}
	return sub
}

// RegisterStatic mounts the embedded site at "/" (GET/HEAD only).
//
// Everything is served with no-cache: this is a loopback desktop app, a restart
// is the cache flush. The 404 path logs on purpose, because the tools/verify
// scripts treat an unexpected 404 as a failure (AGENTS §8) -- that is how a
// missing vendor asset surfaces instead of hiding as a blank page.
func RegisterStatic(mux *http.ServeMux, site fs.FS, log *slog.Logger) {
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name == "" || name == "." {
			name = "index.html"
		}
		if _, err := fs.Stat(site, name); err != nil {
			log.Warn("static 404", "path", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		// CSP is deliberately narrow: same-origin scripts/styles only, no
		// inline JS. blob: is needed for pdf.js worker/chunk URLs (FACTS §1.1),
		// data: for the tiny image probes the front-end draws. Everything the
		// app fetches is on this same loopback origin, so connect-src stays self.
		//
		// style-src needs 'unsafe-inline' because the shell drives layout with
		// CSSOM style writes (panel width, preview transform); Chromium blocks
		// those without it (measured 2026-10-29, FACTS §1.6). The XSS surface
		// that matters — script-src — stays 'self' only.
		w.Header().Set("Content-Security-Policy",
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; "+
				"worker-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; "+
				"base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
		http.ServeFileFS(w, r, site, name)
	})
}
