package web

import (
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
		"index.html", "style.css", "app-i18n.js", "app-api.js", "app-shell.js",
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

func TestStaticServesScriptsAsJavaScript(t *testing.T) {
	mux := http.NewServeMux()
	RegisterStatic(mux, Static(), console.New(io.Discard, false))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://127.0.0.1/app-shell.js", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /app-shell.js = %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "javascript") {
		t.Errorf("Content-Type = %q, want a javascript type", ct)
	}
}
