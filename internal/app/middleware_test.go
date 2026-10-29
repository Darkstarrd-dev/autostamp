package app

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"
	"time"

	"autostamp/internal/console"
	"autostamp/internal/webx"
)

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		webx.OK(w, map[string]string{"path": r.URL.Path})
	})
}

func TestMiddlewareRejectsForeignHost(t *testing.T) {
	h := middleware(okHandler(), console.New(io.Discard, false), loopbackHosts(8765), false)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8765/api/health", nil)
	req.Host = "evil.example.com"
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusMisdirectedRequest {
		t.Fatalf("status = %d, want 421", rec.Code)
	}
	var env webx.Envelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatal(err)
	}
	if env.OK || env.Code != "bad_host" {
		t.Errorf("envelope = %+v, want code bad_host", env)
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Error("error responses must still set nosniff")
	}
}

func TestMiddlewareAcceptsLoopbackHosts(t *testing.T) {
	h := middleware(okHandler(), console.New(io.Discard, false), loopbackHosts(8765), true)
	for _, host := range []string{"127.0.0.1:8765", "localhost:8765", "127.0.0.1", "LOCALHOST"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8765/api/health", nil)
		req.Host = host
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Errorf("host %s: status = %d, want 200 (%s)", host, rec.Code, rec.Body.String())
		}
	}
}

func TestMiddlewareOriginSwitch(t *testing.T) {
	// strict=false (the P0 default): Host is verified, Origin is not enforced.
	loose := middleware(okHandler(), console.New(io.Discard, false), []string{"127.0.0.1:8765"}, false)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8765/api/pdf/apply", nil)
	req.Host = "127.0.0.1:8765"
	req.Header.Set("Origin", "http://evil.example.com")
	loose.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("strict=off POST: status = %d, want 200", rec.Code)
	}

	// strict=true: the same request is refused, and a loopback Origin passes.
	strict := middleware(okHandler(), console.New(io.Discard, false), []string{"127.0.0.1:8765"}, true)
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8765/api/pdf/apply", nil)
	req.Host = "127.0.0.1:8765"
	req.Header.Set("Origin", "http://evil.example.com")
	strict.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("strict=on POST: status = %d, want 403", rec.Code)
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8765/api/pdf/apply", nil)
	req.Host = "127.0.0.1:8765"
	req.Header.Set("Origin", "http://127.0.0.1:8765")
	strict.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("strict=on loopback origin: status = %d, want 200", rec.Code)
	}
	// A cross-site GET is a read; the CSRF risk lives in the write verbs.
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8765/api/health", nil)
	req.Host = "127.0.0.1:8765"
	req.Header.Set("Origin", "http://evil.example.com")
	strict.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("strict=on GET: status = %d, want 200", rec.Code)
	}
}

func TestMiddlewareGzipOnlyForTextTypes(t *testing.T) {
	body := bytes.Repeat([]byte("data, "), 400)
	h := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, ".json") {
			w.Header().Set("Content-Type", "application/json")
		} else {
			w.Header().Set("Content-Type", http.DetectContentType(body))
		}
		_, _ = w.Write(body)
	}), console.New(io.Discard, false), []string{"127.0.0.1"}, false)

	for _, tc := range []struct {
		path     string
		wantGzip bool
	}{
		{"/index.html", true},
		{"/app-shell.js", true},
		{"/vendor/pdfjs/build/pdf.min.mjs", true},
		{"/style.css", true},
		{"/vendor/pdfjs/cmaps/UniGB-UCS2-H.bcmap", false},
		{"/vendor/pdfjs/wasm/openjpeg.wasm", false},
		{"/seal.png", false},
		{"/api/pdf/raw?id=x", false},
	} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1"+tc.path, nil)
		req.Header.Set("Accept-Encoding", "gzip")
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d", tc.path, rec.Code)
		}
		gzipped := rec.Header().Get("Content-Encoding") == "gzip"
		if gzipped != tc.wantGzip {
			t.Errorf("%s: gzip = %v, want %v", tc.path, gzipped, tc.wantGzip)
			continue
		}
		if !gzipped {
			continue
		}
		zr, err := gzip.NewReader(bytes.NewReader(rec.Body.Bytes()))
		if err != nil {
			t.Errorf("%s: gzip body unreadable: %v", tc.path, err)
			continue
		}
		out, err := io.ReadAll(zr)
		if err != nil {
			t.Errorf("%s: inflate: %v", tc.path, err)
			continue
		}
		if !bytes.Equal(out, body) {
			t.Errorf("%s: inflated body mismatch (%d bytes)", tc.path, len(out))
		}
	}

	// No Accept-Encoding header means the body must arrive untouched.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/index.html", nil)
	h.ServeHTTP(rec, req)
	if rec.Header().Get("Content-Encoding") == "gzip" {
		t.Error("gzip must not be forced without Accept-Encoding")
	}
	if !bytes.Equal(rec.Body.Bytes(), body) {
		t.Error("identity encoding mismatch")
	}
}

func TestMiddlewareRecoversFromPanic(t *testing.T) {
	h := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("boom")
	}), console.New(io.Discard, false), []string{"127.0.0.1"}, false)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/pdf/open", nil))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	var env webx.Envelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatal(err)
	}
	if env.OK || env.Code != "internal_error" {
		t.Errorf("envelope = %+v, want internal_error", env)
	}
}

func TestRequestLogLevels(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
	h := middleware(okHandler(), log, []string{"127.0.0.1"}, false)

	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/health", nil))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "http://127.0.0.1/style.css", nil))

	got := buf.String()
	if !strings.Contains(got, `path=/api/health`) || !strings.Contains(got, `path=/style.css`) {
		t.Fatalf("both requests must be logged, got:\n%s", got)
	}
	// The /api line is INFO; static assets are DEBUG-prefixed noise.
	apiLine := 0
	for _, l := range strings.Split(got, "\n") {
		if strings.Contains(l, "path=/api/health") {
			apiLine++
			if !strings.Contains(l, "level=INFO") {
				t.Errorf("api request should be INFO: %s", l)
			}
			if !strings.Contains(l, "status=200") || !strings.Contains(l, "method=GET") {
				t.Errorf("log line is missing method/status: %s", l)
			}
		}
	}
	if apiLine != 1 {
		t.Errorf("api request logged %d times, want exactly 1 line", apiLine)
	}
	quiet := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	h2 := middleware(okHandler(), quiet, []string{"127.0.0.1"}, false)
	_ = h2 // the Info-only logger must still be able to serve a request
	rec := httptest.NewRecorder()
	h2.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/health", nil))
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
}

func TestListenLoopbackIsV4AndFree(t *testing.T) {
	ln1, port1, err := ListenLoopback()
	if err != nil {
		t.Fatalf("ListenLoopback: %v", err)
	}
	defer ln1.Close()
	if port1 == 0 {
		t.Error("port must be the OS-assigned one")
	}
	host, _, err := net.SplitHostPort(ln1.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	if host != "127.0.0.1" {
		t.Errorf("bound host = %s, want 127.0.0.1 (AGENTS §5.11)", host)
	}
	ln2, port2, err := ListenLoopback()
	if err != nil {
		t.Fatal(err)
	}
	defer ln2.Close()
	if port2 == port1 {
		t.Errorf("two listeners got the same port %d", port1)
	}
	if LoopURL(port1) != fmt.Sprintf("http://127.0.0.1:%d", port1) {
		t.Errorf("LoopURL = %s", LoopURL(port1))
	}
}

func TestServeThenGracefulShutdown(t *testing.T) {
	ln, port, err := ListenLoopback()
	if err != nil {
		t.Fatal(err)
	}
	srv := NewServer(ln, okHandler(), console.New(io.Discard, false), port, false)

	done := make(chan error, 1)
	go func() { done <- srv.Serve() }()

	base := fmt.Sprintf("http://127.0.0.1:%d", srv.Port())
	resp, err := http.Get(base + "/api/health")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}
	// A foreign Host must be refused through the real chain.
	req, err := http.NewRequest(http.MethodGet, base+"/api/health", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Host = "evil.example"
	foreign, err := http.DefaultTransport.RoundTrip(req)
	if err != nil {
		t.Fatalf("foreign Host request: %v", err)
	}
	defer foreign.Body.Close()
	if foreign.StatusCode != http.StatusMisdirectedRequest {
		t.Errorf("foreign Host status = %d, want 421", foreign.StatusCode)
	}

	if err := srv.Graceful(2 * time.Second); err != nil {
		t.Errorf("Graceful: %v", err)
	}
	if err := <-done; err != nil {
		t.Errorf("Serve should end cleanly after Shutdown, got %v", err)
	}
	if _, err := http.Get(base + "/api/health"); err == nil {
		t.Error("the port must be closed after Graceful")
	}
}

func TestBuildInfoString(t *testing.T) {
	b := BuildInfo{Version: "1.2.3", GoVersion: "go1.26.5", GOOS: "windows", Arch: "amd64"}
	got := b.String()
	if !strings.Contains(got, "1.2.3") || !strings.Contains(got, "n/a") {
		t.Errorf("String = %q, want the version and an n/a commit", got)
	}
	// ReadBuild stores the commit already shortened; String just renders it.
	b.Commit = shorten("abcdef1234567890", 7)
	b.Modified = true
	got = b.String()
	if !strings.Contains(got, "abcdef1") || !strings.Contains(got, "(dirty)") {
		t.Errorf("String = %q, want the short commit plus (dirty)", got)
	}
	if strings.Contains(got, "abcdef1234567890") {
		t.Errorf("the full commit must not appear: %q", got)
	}
}

// shorten is what ReadBuild applies to vcs.revision, so a 40-character hash
// never reaches the banner or /api/health in full.
func TestShortenCommit(t *testing.T) {
	if got := shorten("0123456789abcdef", 7); got != "0123456" {
		t.Errorf("shorten = %q, want 0123456", got)
	}
	if got := shorten("abc", 7); got != "abc" {
		t.Errorf("shorten must keep a shorter value, got %q", got)
	}
}
func TestReadBuildHasUsableTriple(t *testing.T) {
	b := ReadBuild()
	if b.Version == "" || b.GoVersion == "" || b.GOOS == "" || b.Arch == "" {
		t.Errorf("ReadBuild incomplete: %+v", b)
	}
	if b.GOOS != runtime.GOOS {
		t.Errorf("GOOS = %s, want %s", b.GOOS, runtime.GOOS)
	}
	if b.String() == "" {
		t.Error("String must render the banner")
	}
}
