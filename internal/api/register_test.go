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
	"autostamp/internal/presetstore"
	"autostamp/internal/tmpstore"
	"autostamp/internal/webx"
)

// testKit is the real route set plus the stores it is wired with, so a route test
// can inspect what the handlers actually wrote to disk.
type testKit struct {
	mux      *http.ServeMux
	settings *config.Store
	assets   *tmpstore.Store
	presets  *presetstore.Store
}

// newTestKit builds Deps the way main does (AGENTS §3): settings, the session
// store, and the seal preset library, all under one temp dir.
func newTestKit(t *testing.T) *testKit {
	t.Helper()
	dir := t.TempDir()
	settings, err := config.Load(filepath.Join(dir, "settings.json"))
	if err != nil {
		t.Fatalf("settings load: %v", err)
	}
	log := console.New(io.Discard, false)
	assets, err := tmpstore.New(filepath.Join(dir, "session"), tmpstore.Limits{
		TTL:      time.Hour,
		MaxFile:  1 << 20,
		MaxTotal: 4 << 20,
	}, log)
	if err != nil {
		t.Fatalf("tmpstore: %v", err)
	}
	t.Cleanup(func() { _ = assets.Close() })
	presets := presetstore.New(filepath.Join(dir, "seals"), log)
	return &testKit{
		mux: NewMux(Deps{
			Version:  app.BuildInfo{Version: "9.9.9", Commit: "dead123", GoVersion: "go1.26.5", GOOS: "windows", Arch: "amd66"},
			Log:      log,
			Settings: settings,
			Assets:   assets,
			Presets:  presets,
		}),
		settings: settings,
		assets:   assets,
		presets:  presets,
	}
}

// newTestMux is the 3-value form the older route tests use.
func newTestMux(t *testing.T) (*http.ServeMux, *config.Store, *tmpstore.Store) {
	t.Helper()
	kit := newTestKit(t)
	return kit.mux, kit.settings, kit.assets
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

// TestSettingsPatchReplacesRecentSeals is the HD8 fallback contract: the
// drop-down drops stale records by replacing the whole recentSeals group.
func TestSettingsPatchReplacesRecentSeals(t *testing.T) {
	mux, store, _ := newTestMux(t)
	store.SetRecentSeal(`C:\seals\keep.png`)
	store.SetRecentSeal(`C:\seals\gone.png`)

	body := `{"patch":{"recentSeals":[{"path":"C:\\seals\\keep.png","openedAt":"2026-11-04T00:00:00Z"}]}}`
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/settings", strings.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH = %d %s", rec.Code, rec.Body.String())
	}
	list := store.Snapshot().RecentSeals
	if len(list) != 1 {
		t.Fatalf("recentSeals = %+v, want the group replaced with 1 entry", list)
	}
	if list[0].Path != `C:\seals\keep.png` {
		t.Errorf("recentSeals[0] = %+v, want keep.png", list[0])
	}

	// HD12: the scale ceiling widened for drag-overshoot; 3.0 stays, 9 clamps.
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/settings", strings.NewReader(`{"patch":{"apply":{"scale":3}}}`)))
	if settingsPayloadOf(t, rec).Warning != "" {
		t.Error("scale 3: warning not empty")
	}
	if store.Snapshot().Apply.Scale != 3 {
		t.Errorf("scale = %v, want 3", store.Snapshot().Apply.Scale)
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/settings", strings.NewReader(`{"patch":{"apply":{"scale":9}}}`)))
	if w := settingsPayloadOf(t, rec).Warning; !strings.Contains(w, "scale") {
		t.Errorf("scale 9 warning = %q, want it to mention scale", w)
	}
	if got := store.Snapshot().Apply.Scale; got != 5 {
		t.Errorf("scale = %v, want clamped 5", got)
	}
}

// settingsPayloadOf decodes the data section of a settings response.
func settingsPayloadOf(t *testing.T, rec *httptest.ResponseRecorder) settingsPayload {
	t.Helper()
	env := decodeEnvelope(t, rec)
	raw, err := json.Marshal(env.Data)
	if err != nil {
		t.Fatal(err)
	}
	var p settingsPayload
	if err := json.Unmarshal(raw, &p); err != nil {
		t.Fatal(err)
	}
	return p
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
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPatch, "/api/seal/preset", strings.NewReader(`{}`)))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405 from the static pattern", rec.Code)
	}
	if body := rec.Body.String(); body == "" {
		t.Error("the router should say Method Not Allowed, not reply silently")
	} else if strings.Contains(body, `"ok"`) {
		t.Errorf("the router 405 must not look like our envelope: %q", body)
	}

	rec = httptest.NewRecorder()
	// The preset routes are exact patterns, so a sub-path still falls through to the
	// static handler and answers 404 (AGENTS §6: no /api/ catch-all).
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/seal/preset/save", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("GET on an unregistered sub-path = %d, want 404", rec.Code)
	}
}
