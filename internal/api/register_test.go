package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"autostamp/internal/app"
	"autostamp/internal/config"
	"autostamp/internal/console"
	"autostamp/internal/tmpstore"
	"autostamp/internal/webx"
)

// newTestMux builds the real route set with both stores in temp directories,
// so every test exercises the same wiring main installs.
func newTestMux(t *testing.T) (*http.ServeMux, *config.Store, *tmpstore.Store) {
	t.Helper()
	dir := t.TempDir()
	settings, err := config.Load(filepath.Join(dir, "settings.json"))
	if err != nil {
		t.Fatalf("settings load: %v", err)
	}
	assets, err := tmpstore.New(filepath.Join(dir, "session"), tmpstore.Limits{
		TTL:      time.Hour,
		MaxFile:  1 << 20,
		MaxTotal: 4 << 20,
	}, console.New(io.Discard, false))
	if err != nil {
		t.Fatalf("tmpstore: %v", err)
	}
	t.Cleanup(func() { _ = assets.Close() })
	mux := NewMux(Deps{
		Version:  app.BuildInfo{Version: "9.9.9", Commit: "dead123", GoVersion: "go1.26.5", GOOS: "windows", Arch: "amd64"},
		Log:      console.New(io.Discard, false),
		Settings: settings,
		Assets:   assets,
	})
	return mux, settings, assets
}

func decodeEnvelope(t *testing.T, rec *httptest.ResponseRecorder) webx.Envelope {
	t.Helper()
	var env webx.Envelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("body is not an envelope: %v\n%s", err, rec.Body.String())
	}
	return env
}

func TestHealthReportsTheBuildTriple(t *testing.T) {
	mux, _, _ := newTestMux(t)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/health", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	env := decodeEnvelope(t, rec)
	if !env.OK {
		t.Fatalf("ok = false (%s)", env.Error)
	}
	var data struct {
		Status  string `json:"status"`
		Name    string `json:"name"`
		Version string `json:"version"`
		Commit  string `json:"commit"`
		Go      string `json:"go"`
	}
	raw, _ := json.Marshal(env.Data)
	if err := json.Unmarshal(raw, &data); err != nil {
		t.Fatal(err)
	}
	if data.Status != "ok" || data.Name != "autostamp" {
		t.Errorf("payload = %+v", data)
	}
	if data.Version != "9.9.9" || data.Commit != "dead123" || data.Go != "go1.26.5" {
		t.Errorf("version triple not reported: %+v", data)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("Content-Type = %q", ct)
	}
}

func TestHealthOnlyAnswersGET(t *testing.T) {
	mux, _, _ := newTestMux(t)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/health", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST /api/health = %d, want 405", rec.Code)
	}
}

func TestSettingsGetReturnsDefaults(t *testing.T) {
	mux, _, _ := newTestMux(t)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/settings", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	env := decodeEnvelope(t, rec)
	var body settingsPayload
	raw, _ := json.Marshal(env.Data)
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatal(err)
	}
	if body.Settings.Version != config.SchemaVersion {
		t.Errorf("settings.version = %d, want %d", body.Settings.Version, config.SchemaVersion)
	}
	if body.Settings.Apply.Blend != "multiply" || body.Settings.Export.Mode != "vector" {
		t.Errorf("defaults missing from the response: %+v", body.Settings)
	}
	if body.Warning != "" {
		t.Errorf("a clean GET must not report a warning, got %q", body.Warning)
	}
}

// TestSettingsPatchMergesOnlyWhatItSends is the pointer-field contract in
// AGENTS §6: {"apply":{"opacity":0.42}} may not disturb any other group.
func TestSettingsPatchMergesOnlyWhatItSends(t *testing.T) {
	mux, store, _ := newTestMux(t)
	before := store.Snapshot()

	body := `{"patch":{"apply":{"opacity":0.42,"blend":"screen"}}}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/settings", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	env := decodeEnvelope(t, rec)
	var out settingsPayload
	raw, _ := json.Marshal(env.Data)
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	if out.Settings.Apply.Opacity != 0.42 || out.Settings.Apply.Blend != "screen" {
		t.Errorf("patch not applied: %+v", out.Settings.Apply)
	}
	got := store.Snapshot()
	if got.Export != before.Export || got.Split != before.Split || got.UI != before.UI {
		t.Errorf("an apply-only patch touched other groups")
	}
	if got.Apply.Pos != before.Apply.Pos || got.Apply.Scale != before.Apply.Scale {
		t.Errorf("sibling apply fields changed: %+v", got.Apply)
	}
	if out.Warning != "" {
		t.Errorf("in-range values must not warn, got %q", out.Warning)
	}
}

func TestSettingsPatchClampsAndWarns(t *testing.T) {
	mux, store, _ := newTestMux(t)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/settings", strings.NewReader(`{"patch":{"export":{"customDpi":9000}}}`))
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (a bad value is corrected, not rejected)", rec.Code)
	}
	env := decodeEnvelope(t, rec)
	var out settingsPayload
	raw, _ := json.Marshal(env.Data)
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	if out.Warning == "" {
		t.Fatal("a clamped value must report a warning")
	}
	if !strings.Contains(out.Warning, "customDpi") {
		t.Errorf("warning %q must name the offending field", out.Warning)
	}
	if out.Settings.Export.CustomDPI != 600 {
		t.Errorf("customDpi = %d, want 600", out.Settings.Export.CustomDPI)
	}
	// A blend typo is refused by the spec vocabulary: the stored value must be
	// the default, never the typo, and the warning must say so.
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/settings", strings.NewReader(`{"patch":{"apply":{"blend":"multiply-x"}}}`))
	mux.ServeHTTP(rec, req)
	env = decodeEnvelope(t, rec)
	raw, _ = json.Marshal(env.Data)
	json.Unmarshal(raw, &out)
	if out.Settings.Apply.Blend != "multiply" {
		t.Errorf("blend = %q, want the default", out.Settings.Apply.Blend)
	}
	if !strings.Contains(out.Warning, "blend") {
		t.Errorf("warning = %q, want it to mention blend", out.Warning)
	}
	if store.Snapshot().Apply.Blend != "multiply" {
		t.Error("the corrected value must be persisted, not just echoed")
	}
}

func TestSettingsRejectsBadBodies(t *testing.T) {
	mux, _, _ := newTestMux(t)
	for _, tc := range []struct {
		name string
		body string
	}{
		{"empty", ""},
		{"not json", "hello"},
		{"unknown key", `{"patchep":{"apply":{}}}`},
		{"wrong leaf type", `{"patch":{"apply":{"opacity":"opaque"}}`},
		{"half-open array", `{"patch":{"export":{"dpi":`},
	} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/settings", strings.NewReader(tc.body)))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400 (%s)", tc.name, rec.Code, rec.Body.String())
		}
		env := decodeEnvelope(t, rec)
		if env.OK || env.Code != "bad_body" {
			t.Errorf("%s: envelope = %+v, want code bad_body", tc.name, env)
		}
		if !strings.Contains(env.Error, "请求体") {
			t.Errorf("%s: message must be the fallback text the UI shows, got %q", tc.name, env.Error)
		}
	}
}

// The settings document on disk must survive an interrupted write: nothing may
// be readable as a partial JSON body.
func TestSettingsWriteIsAtomic(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	store, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	mux := NewMux(Deps{Log: console.New(io.Discard, false), Settings: store})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/settings", strings.NewReader(`{"patch":{"ui":{"theme":"dark"}}}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(data, []byte(`"theme": "dark"`)) {
		t.Errorf("theme not persisted: %s", data)
	}
	left, _ := filepath.Glob(filepath.Join(dir, ".tmp-*"))
	if len(left) != 0 {
		t.Errorf("temp files left behind: %v", left)
	}
}

// A route no stage has implemented still matches the static pattern, so the
// router's own reply is what reaches the front-end: 405 for a verb that path
// does not implement, 404 from the static handler. The client turns those into
// http_405 / http_404 (app-api.js), and the shell shows them verbatim.
func TestUnimplementedRouteKeepsRouterReply(t *testing.T) {
	mux, _, _ := newTestMux(t)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/pdf/export", strings.NewReader(`{"assetId":"a"}`)))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405 from the static pattern", rec.Code)
	}
	if body := rec.Body.String(); body == "" {
		t.Error("the router should say Method Not Allowed, not reply silently")
	} else if strings.Contains(body, `"ok"`) {
		t.Errorf("the router 405 must not look like our envelope: %q", body)
	}

	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/pdf/export", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("GET on the same path = %d, want 404", rec.Code)
	}
}
