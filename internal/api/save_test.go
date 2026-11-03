package api

// P4 save-route contract tests (AGENTS §6 POST /api/pdf/save). The route owns
// three things: picking exactly one of the three target channels, refusing to
// write where it would destroy the copy it is streaming, and landing bytes
// through fsx.AtomicWriteFunc (AGENTS §4: 一律原子写).

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"autostamp/internal/webx"
)

// pickTypedPath runs the typed-path channel of /api/fs/pick (no dialog) and
// returns the pathGrantId plus the picked path, exactly as the UI sees it.
func pickTypedPath(t *testing.T, mux http.Handler, session, path string) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/fs/pick",
		bytes.NewReader([]byte(`{"filePath":`+jsonEscape(path)+`}`)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(webx.SessionHeader, session)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("pick %s = %d: %s", path, rec.Code, rec.Body.String())
	}
	picks, _ := dataOf(t, rec)["picks"].([]any)
	if len(picks) != 1 {
		t.Fatalf("picks = %v, want one entry", dataOf(t, rec)["picks"])
	}
	id, _ := picks[0].(map[string]any)["pathGrantId"].(string)
	if id == "" {
		t.Fatalf("no pathGrantId in the pick answer")
	}
	return id
}

// jsonEscape quotes a Windows path for the JSON body (backslashes and all).
func jsonEscape(s string) string {
	raw, err := json.Marshal(s)
	if err != nil {
		panic(err)
	}
	return string(raw)
}

func saveJSON(t *testing.T, mux http.Handler, body map[string]any, session string) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/pdf/save", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	if session != "" {
		req.Header.Set(webx.SessionHeader, session)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

// openDiskPDF opens a disk document through the grant channel; that is the path
// that records an origin, so it is what the replace-original tests need.
func openDiskPDF(t *testing.T, mux http.Handler, session, path string) string {
	t.Helper()
	grant := pickTypedPath(t, mux, session, path)
	raw, err := json.Marshal(map[string]any{"pathGrantId": grant})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/pdf/open", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(webx.SessionHeader, session)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("open %s = %d: %s", path, rec.Code, rec.Body.String())
	}
	id, _ := dataOf(t, rec)["assetId"].(string)
	if id == "" {
		t.Fatalf("open answer has no assetId")
	}
	return id
}

// A save to an explicit targetPath lands the bytes in the user's directory and
// answers the honest size, without touching the session copy.
func TestSaveWritesTargetPathAtomically(t *testing.T) {
	mux, _, assets := newTestMux(t)
	session := newSession(t)
	original := threePageA4(t)
	src := openUploadedPDF(t, mux, session, original)

	target := filepath.Join(t.TempDir(), "saved out.pdf") // a space tests the write path
	rec := saveJSON(t, mux, map[string]any{"assetId": src, "targetPath": target}, session)
	if rec.Code != http.StatusOK {
		t.Fatalf("save = %d: %s", rec.Code, rec.Body.String())
	}
	data := dataOf(t, rec)
	if data["path"] != target && data["path"] != filepath.Clean(target) {
		t.Errorf("path = %v, want %s", data["path"], target)
	}
	if data["replaceOriginal"] != false {
		t.Errorf("replaceOriginal = %v, want false for a targetPath save", data["replaceOriginal"])
	}
	if msg, _ := data["message"].(string); msg == "" {
		t.Error("the save answer must carry a message for the UI to show")
	}
	written, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(written, original) {
		t.Errorf("saved bytes differ from the source document (%d vs %d bytes)", len(written), len(original))
	}
	if size, _ := data["size"].(float64); int64(size) != int64(len(original)) {
		t.Errorf("size = %v, want %d", data["size"], len(original))
	}
	// No temporary leftovers beside the target (fsx.AtomicWriteFunc renames).
	st, err := os.ReadDir(filepath.Dir(target))
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range st {
		if name := e.Name(); name != filepath.Base(target) {
			t.Errorf("the save left %q behind next to the target", name)
		}
	}
	if _, err := assets.Get(src, session); err != nil {
		t.Error("saving must not consume the session asset")
	}
}

// 替换原文件: pick -> open -> apply -> save(replaceOriginal) must write the
// *stamped* document back onto the picked file, because the origin carries
// through intermediate assets (tmpstore.Asset.Origin).
func TestSaveReplaceOriginalAfterApply(t *testing.T) {
	mux, _, _ := newTestMux(t)
	session := newSession(t)

	dir := t.TempDir()
	path := filepath.Join(dir, "contract.pdf")
	original := threePageA4(t)
	if err := os.WriteFile(path, original, 0o644); err != nil {
		t.Fatal(err)
	}
	asset := openDiskPDF(t, mux, session, path)
	seal := preparedSeal(t, mux, session)

	arec := applyOne(t, mux, session, asset, seal, map[string]any{"pages": "2"})
	if arec.Code != http.StatusCreated {
		t.Fatalf("apply = %d: %s", arec.Code, arec.Body.String())
	}
	stampedID := dataOf(t, arec)["assetId"].(string)

	rec := saveJSON(t, mux, map[string]any{"assetId": stampedID, "replaceOriginal": true}, session)
	if rec.Code != http.StatusOK {
		t.Fatalf("save replaceOriginal = %d: %s", rec.Code, rec.Body.String())
	}
	data := dataOf(t, rec)
	if data["replaceOriginal"] != true {
		t.Errorf("replaceOriginal = %v, want true", data["replaceOriginal"])
	}
	if got, _ := data["path"].(string); filepath.Clean(got) != filepath.Clean(path) {
		t.Errorf("path = %q, want the picked file %s", got, path)
	}
	onDisk, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(onDisk, original) {
		t.Fatal("replaceOriginal rewrote the untouched original: the stamped bytes never reached disk")
	}
	if !bytes.Contains(onDisk, []byte("Watermark")) {
		t.Error("the file on disk does not contain the stamped content layer")
	}
}

// An upload has no disk original, so the route must say so instead of guessing
// a path the user never chose.
func TestSaveReplaceOriginalNeedsAnOrigin(t *testing.T) {
	mux, _, _ := newTestMux(t)
	session := newSession(t)
	upload := openUploadedPDF(t, mux, session, threePageA4(t))

	rec := saveJSON(t, mux, map[string]any{"assetId": upload, "replaceOriginal": true}, session)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
	}
	if code := errorCode(t, rec); code != "bad_body" {
		t.Errorf("code = %q, want bad_body", code)
	}
}

// Exactly one target channel may be set. Two are ambiguity, none is nothing.
func TestSaveNeedsOneTargetChannel(t *testing.T) {
	mux, _, _ := newTestMux(t)
	session := newSession(t)
	asset := openUploadedPDF(t, mux, session, threePageA4(t))
	target := filepath.Join(t.TempDir(), "x.pdf")
	foreign := filepath.Join(t.TempDir(), "foreign.pdf")
	if err := os.WriteFile(foreign, threePageA4(t), 0o644); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name string
		body map[string]any
		code string
	}{
		{"two channels", map[string]any{"assetId": asset, "targetPath": target, "replaceOriginal": true}, "bad_body"},
		{"no channel", map[string]any{"assetId": asset}, "bad_body"},
		{"relative path", map[string]any{"assetId": asset, "targetPath": "out.pdf"}, "bad_body"},
		{"missing directory", map[string]any{"assetId": asset, "targetPath": filepath.Join(t.TempDir(), "nope", "out.pdf")}, "bad_body"},
		{"not a pdf", map[string]any{"assetId": asset, "targetPath": filepath.Join(t.TempDir(), "out.txt")}, "not_pdf"},
		{"foreign grant", map[string]any{"assetId": asset, "pathGrantId": pickTypedPath(t, mux, newSession(t), foreign)}, "path_denied"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := saveJSON(t, mux, tc.body, session)
			if rec.Code == http.StatusOK {
				t.Fatalf("save accepted %s: %s", tc.name, rec.Body.String())
			}
			if code := errorCode(t, rec); code != tc.code {
				t.Errorf("code = %q, want %q (%s)", code, tc.code, rec.Body.String())
			}
		})
	}
}

// Writing into the session store would truncate the file being streamed from;
// an asset from another session must not be savable either.
func TestSaveRefusesSessionDirAndForeignAsset(t *testing.T) {
	mux, _, assets := newTestMux(t)
	session := newSession(t)
	asset := openUploadedPDF(t, mux, session, threePageA4(t))

	inside := filepath.Join(assets.Dir(), "escape.pdf")
	if rec := saveJSON(t, mux, map[string]any{"assetId": asset, "targetPath": inside}, session); errorCode(t, rec) != "bad_body" {
		t.Errorf("save into the session store = code %q, want bad_body", errorCode(t, rec))
	}
	if _, err := os.Stat(inside); !os.IsNotExist(err) {
		t.Error("the session store must not gain a file from a save request")
	}
	if rec := saveJSON(t, mux, map[string]any{"assetId": asset, "targetPath": filepath.Join(t.TempDir(), "x.pdf")}, newSession(t)); rec.Code != http.StatusNotFound {
		t.Errorf("foreign asset = %d, want 404", rec.Code)
	}
}

// The save route answers through the envelope like every other route, so the
// front-end's 已保存 toast can read the path it wrote.
func TestSaveAnswerShape(t *testing.T) {
	mux, _, _ := newTestMux(t)
	session := newSession(t)
	asset := openUploadedPDF(t, mux, session, threePageA4(t))
	target := filepath.Join(t.TempDir(), "shape.pdf")
	rec := saveJSON(t, mux, map[string]any{"assetId": asset, "targetPath": target}, session)
	data := dataOf(t, rec)
	for _, key := range []string{"assetId", "path", "size", "replaceOriginal", "message"} {
		if _, ok := data[key]; !ok {
			t.Errorf("the save answer is missing %q", key)
		}
	}
}

// The batch job (P6 需求 6) writes into a "_batch" folder it decides on, so the save
// route creates the parent only when mkdirs is set - and never when it is not.
func TestSaveMkdirsCreatesBatchFolder(t *testing.T) {
	mux, _, _ := newTestMux(t)
	session := newSession(t)
	asset := openUploadedPDF(t, mux, session, threePageA4(t))
	root := t.TempDir()
	missing := filepath.Join(root, "_batch", "章 · 甲.pdf")

	rec := saveJSON(t, mux, map[string]any{"assetId": asset, "targetPath": missing}, session)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("mkdirs off = %d, want 400: %s", rec.Code, rec.Body.String())
	}
	if code := errorCode(t, rec); code != "bad_body" {
		t.Errorf("code = %q, want bad_body", code)
	}
	if _, err := os.Stat(filepath.Dir(missing)); !os.IsNotExist(err) {
		t.Error("a rejected save must not create the folder")
	}

	rec = saveJSON(t, mux, map[string]any{"assetId": asset, "targetPath": missing, "mkdirs": true}, session)
	if rec.Code != http.StatusOK {
		t.Fatalf("mkdirs on = %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(missing); err != nil {
		t.Errorf("the batch file is not on disk: %v", err)
	}
}
