package web

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"autostamp/internal/console"
)

func TestEmbeddedShellFiles(t *testing.T) {
	site := Static()
	for _, name := range []string{
		"index.html", "style.css", "app-i18n.js", "app-api.js",
		// The shell module group (split from app-shell.js 2026-11-05): the
		// boot order in index.html is kernel -> ... -> verify.
		"app-shell-kernel.js", "app-shell-instances.js", "app-shell-seals.js",
		"app-shell-export.js", "app-shell-docops.js", "app-shell-chrome.js",
		"app-shell-verify.js",
		"favicon.svg",
		// The pdf.js entry points: if these disappear the preview is dead,
		// and a 404 in the browser is harder to trace than this failure.
		"vendor/pdfjs/build/pdf.min.mjs", "vendor/pdfjs/build/pdf.worker.min.mjs",
		"vendor/pdfjs/cmaps/UniGB-UTF8-H.bcmap",
		"vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf",
		"vendor/pdfjs/wasm/jbig2.wasm",
		"vendor/pdfjs/LICENSE", "vendor/pdfjs/SHA256.txt", "vendor/pdfjs/README.md",
	} {
		if _, err := fs.Stat(site, name); err != nil {
			t.Errorf("embedded site must contain %s: %v", name, err)
		}
	}
	// The mock is a design artifact (AGENTS §9): it must never be embedded.
	if _, err := fs.Stat(site, "mockup.html"); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("docs/ui/mockup.html leaked into the bundle: %v", err)
	}
	if _, err := fs.Stat(site, "fixtures/seal.png"); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("mock fixtures leaked into the bundle: %v", err)
	}
}

func TestStaticServesShellAtRoot(t *testing.T) {
	mux := http.NewServeMux()
	RegisterStatic(mux, Static(), console.New(io.Discard, false))

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://127.0.0.1/", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET / = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "<html") || !strings.Contains(body, `data-app="autostamp"`) {
		t.Error("GET / did not return the app shell")
	}
	// The shell must not carry inline scripts: the CSP forbids them, so an
	// inline handler would be silently dead (and mask a real bug).
	if strings.Contains(body, "<script>") {
		t.Error("index.html contains an inline <script>, which the CSP rejects")
	}
	csp := rec.Header().Get("Content-Security-Policy")
	// Directive-scoped on purpose: style-src carries 'unsafe-inline' because the
	// shell drives layout through CSSOM style writes (blocked without it,
	// docs/FACTS.md §1.5), while script-src must stay exactly 'self'.
	directives := map[string]string{}
	for _, d := range strings.Split(csp, ";") {
		d = strings.TrimSpace(d)
		if d == "" {
			continue
		}
		key, value, _ := strings.Cut(d, " ")
		directives[key] = strings.TrimSpace(value)
	}
	for directive, want := range map[string]string{
		"default-src": "'self'",
		"script-src":  "'self'",
		"style-src":   "'self' 'unsafe-inline'",
		"object-src":  "'none'",
		"base-uri":    "'none'",
	} {
		if directives[directive] != want {
			t.Errorf("%s = %q, want %s (full CSP: %s)", directive, directives[directive], want, csp)
		}
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("Cache-Control = %q, want no-cache", got)
	}
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("X-Content-Type-Options = %q, want nosniff", got)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("Content-Type = %q", ct)
	}
}

func TestStaticRejectsUnknownAndTraversal(t *testing.T) {
	mux := http.NewServeMux()
	RegisterStatic(mux, Static(), console.New(io.Discard, false))
	// ServeMux cleans the path first (301/307 to the cleaned form), so a
	// traversal attempt must never reach the handler with the raw path, and the
	// cleaned target must not exist in the embedded site either.
	for _, path := range []string{
		"/nope.js",
		"/../go.mod",
		"/%2e%2e/go.mod",
		"/..%2Fgo.mod",
		"/../../AGENTS.md",
		"/docs/UI_spec.md",
	} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://127.0.0.1"+path, nil))
		switch rec.Code {
		case http.StatusOK:
			t.Errorf("GET %s returned 200: the embedded site leaked outside itself", path)
		case http.StatusTemporaryRedirect, http.StatusMovedPermanently, http.StatusNotFound:
			if loc := rec.Header().Get("Location"); strings.Contains(loc, "..") {
				t.Errorf("GET %s redirected outside the root: %s", path, loc)
			}
			if rec.Code != http.StatusNotFound {
				// Follow one redirect hop: it must land on a 404, never a file.
				inner := httptest.NewRecorder()
				mux.ServeHTTP(inner, httptest.NewRequest(http.MethodGet, "http://127.0.0.1"+rec.Header().Get("Location"), nil))
				if inner.Code == http.StatusOK {
					t.Errorf("GET %s -> %s returned 200", path, rec.Header().Get("Location"))
				}
			}
		default:
			t.Errorf("GET %s = %d, want 404 or a cleaned redirect", path, rec.Code)
		}
	}
}

func TestStaticServesAssetsWithTruthfulTypes(t *testing.T) {
	mux := http.NewServeMux()
	RegisterStatic(mux, Static(), console.New(io.Discard, false))
	// Every entry here is a real embedded path: the point is that the vendored
	// pdf.js assets are served with the types the browser actually demands
	// (module scripts/workers need a JavaScript MIME type, FACTS §1.1).
	for _, tc := range []struct {
		path, want string
	}{
		{"/app-shell-kernel.js", "text/javascript"},
		{"/vendor/pdfjs/build/pdf.min.mjs", "text/javascript"},
		{"/vendor/pdfjs/build/pdf.worker.min.mjs", "text/javascript"},
		{"/vendor/pdfjs/image_decoders/pdf.image_decoders.min.mjs", "text/javascript"},
		{"/vendor/pdfjs/wasm/jbig2.wasm", "application/wasm"},
		{"/vendor/pdfjs/cmaps/UniGB-UTF8-H.bcmap", "application/octet-stream"},
		{"/vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf", "font/ttf"},
		{"/favicon.svg", "image/svg+xml"},
	} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://127.0.0.1"+tc.path, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s = %d, want 200 (asset missing from the embed?)", tc.path, rec.Code)
		}
		ct := rec.Header().Get("Content-Type")
		base, _, _ := strings.Cut(ct, ";")
		base = strings.TrimSpace(base)
		// JavaScript is the family the browser enforces (module scripts/workers
		// must be a JS MIME type); Go's stdlib answers application/javascript
		// for .js, so compare by family there and exactly elsewhere.
		if strings.Contains(tc.want, "javascript") {
			if !strings.Contains(base, "javascript") {
				t.Errorf("GET %s Content-Type = %q, want a javascript type", tc.path, ct)
			}
			continue
		}
		if base != tc.want {
			t.Errorf("GET %s Content-Type = %q, want %s", tc.path, ct, tc.want)
		}
	}
}

// TestVendorChecksums verifies the vendored pdf.js tree against its own
// SHA256 manifest: a byte that changed in the working tree (or a file that
// silently disappeared from the embed) fails here instead of showing up as a
// broken render later.
func TestVendorChecksums(t *testing.T) {
	site := Static()
	raw, err := fs.ReadFile(site, "vendor/pdfjs/SHA256.txt")
	if err != nil {
		t.Fatalf("read vendor/pdfjs/SHA256.txt: %v", err)
	}
	lines := strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n")
	checked := 0
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) != 2 || len(fields[0]) != 64 {
			t.Errorf("bad manifest line: %q", line)
			continue
		}
		want, name := strings.ToLower(fields[0]), strings.TrimPrefix(fields[1], "./")
		b, err := fs.ReadFile(site, "vendor/pdfjs/"+name)
		if err != nil {
			t.Errorf("manifest lists %s but the embed does not have it: %v", name, err)
			continue
		}
		sum := sha256.Sum256(b)
		if got := hex.EncodeToString(sum[:]); got != want {
			t.Errorf("%s: sha256 %s, manifest says %s", name, got, want)
			continue
		}
		checked++
	}
	if checked < 50 {
		t.Errorf("only %d vendor files checked, want the full manifest (204 files)", checked)
	}
}
