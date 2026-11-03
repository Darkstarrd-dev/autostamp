package api

// The seal preset library routes (AGENTS §6, P6): the panel's 印章预设 段 and the
// batch job share one on-disk library, so these tests pin the round trip and the
// registered error codes rather than the store's own behaviour (that is tested in
// internal/presetstore).

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	"autostamp/internal/presetstore"
	"autostamp/internal/webx"
)

// presetSave posts a preset body; body is the frozen vocabulary shape.
func presetSave(t *testing.T, mux http.Handler, session, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/seal/preset", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(webx.SessionHeader, session)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func presetGet(t *testing.T, mux http.Handler, session, target string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	if session != "" {
		req.Header.Set(webx.SessionHeader, session)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func presetDelete(t *testing.T, mux http.Handler, session, target string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodDelete, target, nil)
	req.Header.Set(webx.SessionHeader, session)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

// uploadSeal runs the real /api/pdf/seal/prepare route and reports the asset id plus
// the prepared PNG bytes, which is what a preset must copy verbatim.
func uploadSeal(t *testing.T, mux http.Handler, session string) (string, []byte) {
	t.Helper()
	rec := prepareSeal(t, mux, session, stampPNG(t), nil)
	data := dataOf(t, rec)
	id, _ := data["sealId"].(string)
	if id == "" {
		t.Fatalf("no sealId in %v", data)
	}
	raw := presetGet(t, mux, session, "/api/pdf/seal/raw?id="+id)
	if raw.Code != http.StatusOK {
		t.Fatalf("seal raw = %d", raw.Code)
	}
	return id, raw.Body.Bytes()
}

func TestSealPresetRoundTrip(t *testing.T) {
	kit := newTestKit(t)
	session := newSession(t)
	sealID, png := uploadSeal(t, kit.mux, session)

	body := "{\"name\":\"公司章 · 红\"," + "\"sealId\":\"" + sealID + "\",\"params\":{\"blend\":\"multiply\",\"opacity\":0.6,\"scale\":0.4,\"anchor\":\"\",\"pages\":\"all\",\"crossPage\":false,\"rotation\":0,\"startOffset\":0,\"despill\":true,\"alphaTrim\":true,\"resampleDpi\":300}}"
	rec := presetSave(t, kit.mux, session, body)
	if rec.Code != http.StatusCreated {
		t.Fatalf("save = %d: %s", rec.Code, rec.Body.String())
	}
	saved := dataOf(t, rec)
	if saved["name"] != "公司章 · 红" {
		t.Fatalf("saved name = %v", saved["name"])
	}
	if saved["imageBytes"].(float64) != float64(len(png)) {
		t.Errorf("imageBytes = %v, want %d", saved["imageBytes"], len(png))
	}

	// The library holds a copy of the seal asset, not a reference into the session
	// store: the file must be readable behind the store's back.
	preset, path, err := kit.presets.ImageFile("公司章 · 红")
	if err != nil {
		t.Fatalf("preset not on disk: %v", err)
	}
	onDisk, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(onDisk) != string(png) {
		t.Errorf("stored image is %d bytes, want the %d prepared bytes", len(onDisk), len(png))
	}
	if preset.Params.Anchor != "center" {
		t.Errorf("anchor = %q, the validator must fill the UI_SPEC default", preset.Params.Anchor)
	}

	// The list echoes the params, so 预设列表 can show what loading would change.
	rec = presetGet(t, kit.mux, session, "/api/seal/preset")
	rows := dataOf(t, rec)
	list, _ := rows["presets"].([]any)
	if len(list) != 1 {
		t.Fatalf("presets = %v, want one row", rows["presets"])
	}
	row, _ := list[0].(map[string]any)
	params, _ := row["params"].(map[string]any)
	if params["opacity"] != 0.6 || params["blend"] != "multiply" || params["pages"] != "all" {
		t.Errorf("params echoed wrongly: %v", params)
	}

	// GET /api/seal/preset/raw?id= serves the stored bytes for the batch to re-upload.
	rec = presetGet(t, kit.mux, session, "/api/seal/preset/raw?id="+url.QueryEscape("公司章 · 红"))
	if rec.Code != http.StatusOK {
		t.Fatalf("preset raw = %d: %s", rec.Code, rec.Body.String())
	}
	if rec.Body.String() != string(png) {
		t.Errorf("raw preset bytes = %d, want %d", rec.Body.Len(), len(png))
	}

	// 同名 = 覆盖 (PR2): a second save under the same name replaces the entry.
	rec = presetSave(t, kit.mux, session, "{\"name\":\"公司章 · 红\",\"sealId\":\""+sealID+"\",\"params\":{\"blend\":\"normal\",\"opacity\":1,\"scale\":0.5,\"pages\":\"all\"}}")
	if rec.Code != http.StatusCreated {
		t.Fatalf("overwrite = %d: %s", rec.Code, rec.Body.String())
	}
	rows = dataOf(t, presetGet(t, kit.mux, session, "/api/seal/preset"))
	list, _ = rows["presets"].([]any)
	if len(list) != 1 {
		t.Fatalf("同名必须覆盖, got %v", rows["presets"])
	}
	row, _ = list[0].(map[string]any)
	params, _ = row["params"].(map[string]any)
	if params["blend"] != "normal" {
		t.Errorf("overwrite did not replace the params: %v", params)
	}

	// DELETE drops the entry and its image file.
	rec = presetDelete(t, kit.mux, session, "/api/seal/preset?name="+url.QueryEscape("公司章 · 红"))
	if rec.Code != http.StatusOK {
		t.Fatalf("delete = %d: %s", rec.Code, rec.Body.String())
	}
	if _, _, err := kit.presets.ImageFile("公司章 · 红"); err == nil {
		t.Error("the preset must be gone after DELETE (index and image file)")
	}
	rows = dataOf(t, presetGet(t, kit.mux, session, "/api/seal/preset"))
	if list, _ := rows["presets"].([]any); len(list) != 0 {
		t.Errorf("presets survived the delete: %v", rows["presets"])
	}
}

func TestSealPresetErrorCodes(t *testing.T) {
	kit := newTestKit(t)
	session := newSession(t)
	sealID, _ := uploadSeal(t, kit.mux, session)

	cases := []struct {
		name string
		body string
		want int
		code string
	}{
		{
			name: "bad name",
			body: "{\"name\":\"a/b\",\"sealId\":\"" + sealID + "\",\"params\":{\"blend\":\"multiply\",\"opacity\":1,\"scale\":1}}",
			want: http.StatusBadRequest,
			code: "preset_bad_name",
		},
		{
			name: "bad blend",
			body: "{\"name\":\"章\",\"sealId\":\"" + sealID + "\",\"params\":{\"blend\":\"nope\",\"opacity\":1,\"scale\":1}}",
			want: http.StatusBadRequest,
			code: "bad_body",
		},
		{
			name: "opacity out of range",
			body: "{\"name\":\"章\",\"sealId\":\"" + sealID + "\",\"params\":{\"blend\":\"multiply\",\"opacity\":1.5,\"scale\":1}}",
			want: http.StatusBadRequest,
			code: "bad_body",
		},
		{
			name: "missing seal",
			body: "{\"name\":\"章\",\"sealId\":\"nope\",\"params\":{\"blend\":\"multiply\",\"opacity\":1,\"scale\":1}}",
			want: http.StatusNotFound,
			code: "not_found",
		},
		{
			name: "sealId is not a seal",
			body: "{\"name\":\"章\",\"sealId\":\"" + "doc1\"}",
			want: http.StatusNotFound,
			code: "not_found",
		},
		{
			name: "empty body",
			body: "{\"name\":\"\",\"sealId\":\"\",\"params\":{}}",
			want: http.StatusBadRequest,
			code: "bad_body",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			env := decodeEnvelope(t, presetSave(t, kit.mux, session, tc.body))
			if env.OK {
				t.Fatalf("save %q should have failed: %v", tc.name, env)
			}
			if env.Code != tc.code {
				t.Errorf("code = %q, want %q (%s)", env.Code, tc.code, env.Error)
			}
		})
	}

	// A preset that is not there is 404 with the registered code, for raw and DELETE.
	env := decodeEnvelope(t, presetGet(t, kit.mux, session, "/api/seal/preset/raw?id=missing"))
	if env.Code != "preset_not_found" {
		t.Errorf("raw code = %q, want preset_not_found", env.Code)
	}
	if rec := presetGet(t, kit.mux, session, "/api/seal/preset/raw?id="); rec.Code != http.StatusBadRequest {
		t.Errorf("empty id = %d, want 400", rec.Code)
	}
	if rec := presetDelete(t, kit.mux, session, "/api/seal/preset?name=missing"); rec.Code != http.StatusNotFound {
		t.Errorf("delete missing = %d, want 404", rec.Code)
	}

	// The library is not a public endpoint: no session, no list.
	if rec := presetGet(t, kit.mux, "", "/api/seal/preset"); rec.Code != http.StatusBadRequest {
		t.Errorf("no session = %d, want 400", rec.Code)
	}
}

func TestSealPresetCrossPageBindingNormalized(t *testing.T) {
	kit := newTestKit(t)
	session := newSession(t)
	sealID, _ := uploadSeal(t, kit.mux, session)

	// crossPage without an explicit binding stores the confirmed D2 default (right),
	// because the batch feeds the preset straight into /api/pdf/apply.
	body := "{\"name\":\"骑缝章\",\"sealId\":\"" + sealID + "\",\"params\":{\"blend\":\"multiply\",\"opacity\":1,\"scale\":1,\"crossPage\":true,\"pages\":\"all\"}}"
	if rec := presetSave(t, kit.mux, session, body); rec.Code != http.StatusCreated {
		t.Fatalf("save = %d: %s", rec.Code, rec.Body.String())
	}
	preset, _, err := kit.presets.ImageFile("骑缝章")
	if err != nil {
		t.Fatal(err)
	}
	if preset.Params.Binding != "right" {
		t.Errorf("binding = %q, want the D2 default right", preset.Params.Binding)
	}
	if !preset.Params.CrossPage {
		t.Error("crossPage was not stored")
	}
	// A rejected binding never reaches the library at all.
	bad := "{\"name\":\"骑缝章2\",\"sealId\":\"" + sealID + "\",\"params\":{\"blend\":\"multiply\",\"opacity\":1,\"scale\":1,\"crossPage\":true,\"binding\":\"middle\"}}"
	env := decodeEnvelope(t, presetSave(t, kit.mux, session, bad))
	if env.OK || env.Code != "bad_body" {
		t.Fatalf("binding=middle must be rejected, got %+v", env)
	}
	if _, _, err := kit.presets.ImageFile("骑缝章2"); !errors.Is(err, presetstore.ErrNotFound) {
		t.Errorf("a rejected preset must not be stored, got %v", err)
	}
}
