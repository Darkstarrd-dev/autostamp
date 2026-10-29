package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"autostamp/internal/webx"
)

// threePageA4 is the geometry the split route tests assert on: three plain A4
// pages (595x842), none of them a landscape spread, so the auto heuristic must
// leave them whole and only an explicit mode may cut.
func threePageA4(t *testing.T) []byte {
	t.Helper()
	objs := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 /MediaBox [0 0 595 842] /Rotate 0 >>",
		"<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>",
		"<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>",
		"<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>",
		"<< /Length 4 >>\nstream\nq Q\nendstream",
	}
	var b bytes.Buffer
	b.WriteString("%PDF-1.7\n")
	offsets := make([]int, len(objs)+1)
	for i, body := range objs {
		nr := i + 1
		offsets[nr] = b.Len()
		b.WriteString(fmt.Sprintf("%d 0 obj\n%s\nendobj\n", nr, body))
	}
	xref := b.Len()
	b.WriteString("xref\n")
	fmt.Fprintf(&b, "0 %d\n0000000000 65535 f \n", len(objs)+1)
	for nr := 1; nr <= len(objs); nr++ {
		fmt.Fprintf(&b, "%010d 00000 n \n", offsets[nr])
	}
	fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objs)+1, xref)
	return b.Bytes()
}

// openUploadedPDF puts bytes through /api/pdf/open (the drag/drop path) and
// returns the assetId the split route cuts.
func openUploadedPDF(t *testing.T, mux http.Handler, session string, pdf []byte) string {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, err := w.CreateFormFile("file", "doc.pdf")
	if err != nil {
		t.Fatal(err)
	}
	fw.Write(pdf)
	w.Close()
	req := httptest.NewRequest(http.MethodPost, "/api/pdf/open", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set(webx.SessionHeader, session)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("open = %d, want 201: %s", rec.Code, rec.Body.String())
	}
	id, _ := dataOf(t, rec)["assetId"].(string)
	if id == "" {
		t.Fatalf("no assetId in the open answer")
	}
	return id
}

func splitJSON(t *testing.T, mux http.Handler, body map[string]any, session string) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/pdf/split", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	if session != "" {
		req.Header.Set(webx.SessionHeader, session)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

// splitDims renders the answer's page sizes so the geometry assertions read
// compactly ("297.5x842").
func splitDims(t *testing.T, rec *httptest.ResponseRecorder) []string {
	t.Helper()
	pages, _ := dataOf(t, rec)["pages"].([]any)
	out := make([]string, 0, len(pages))
	for _, p := range pages {
		m, _ := p.(map[string]any)
		w, _ := m["width"].(float64)
		h, _ := m["height"].(float64)
		out = append(out, fmt.Sprintf("%gx%g", w, h))
	}
	return out
}

// AGENTS §8.3: the route reports the cut page sizes (A4 → 297.5x842).
func TestSplitRouteReportsCutPageSizes(t *testing.T) {
	mux, _, _ := newTestMux(t)
	session := newSession(t)
	id := openUploadedPDF(t, mux, session, threePageA4(t))

	rec := splitJSON(t, mux, map[string]any{
		"assetId":   id,
		"splitMode": "rows-cols",
		"rows":      1,
		"cols":      2,
	}, session)
	if rec.Code != http.StatusCreated {
		t.Fatalf("split = %d: %s", rec.Code, rec.Body.String())
	}
	data := dataOf(t, rec)
	newID, _ := data["assetId"].(string)
	if newID == "" || newID == id {
		t.Fatalf("assetId = %q, want a new asset different from %q", newID, id)
	}
	if kind, _ := data["kind"].(string); kind != "split" {
		t.Errorf("kind = %q, want split (the new asset's provenance)", kind)
	}
	if count, _ := data["pageCount"].(float64); count != 6 {
		t.Fatalf("pageCount = %v, want 6 (3 pages x 2 pieces)", data["pageCount"])
	}
	want := "297.5x842"
	for i, got := range splitDims(t, rec) {
		if got != want {
			t.Errorf("piece %d dims = %s, want %s", i, got, want)
		}
	}
}

// The auto heuristic must not invent a cut on a portrait document: the same
// pages come back, as a new asset (which is also how the UI's 撤销 works).
func TestSplitAutoLeavesPortraitPages(t *testing.T) {
	mux, _, _ := newTestMux(t)
	session := newSession(t)
	id := openUploadedPDF(t, mux, session, threePageA4(t))

	rec := splitJSON(t, mux, map[string]any{"assetId": id, "splitMode": "auto"}, session)
	if rec.Code != http.StatusCreated {
		t.Fatalf("split = %d: %s", rec.Code, rec.Body.String())
	}
	data := dataOf(t, rec)
	if count, _ := data["pageCount"].(float64); count != 3 {
		t.Fatalf("pageCount = %v, want 3 (auto must not cut a portrait page)", data["pageCount"])
	}
	if newID, _ := data["assetId"].(string); newID == id {
		t.Errorf("auto split reused the same assetId")
	}
}

// 一键否决: with the veto on, auto must not cut either.
func TestSplitAutoVetoThroughRoute(t *testing.T) {
	mux, _, _ := newTestMux(t)
	session := newSession(t)
	id := openUploadedPDF(t, mux, session, threePageA4(t))
	rec := splitJSON(t, mux, map[string]any{"assetId": id, "splitMode": "auto", "splitVeto": true}, session)
	if rec.Code != http.StatusCreated {
		t.Fatalf("split = %d: %s", rec.Code, rec.Body.String())
	}
	if count, _ := dataOf(t, rec)["pageCount"].(float64); count != 3 {
		t.Errorf("pageCount = %v, want 3 (veto 必须完全不切)", count)
	}
}

func TestSplitCustomCutsThroughRoute(t *testing.T) {
	mux, _, _ := newTestMux(t)
	session := newSession(t)
	id := openUploadedPDF(t, mux, session, threePageA4(t))
	rec := splitJSON(t, mux, map[string]any{"assetId": id, "splitMode": "custom", "customCuts": []string{"x0.5"}}, session)
	if rec.Code != http.StatusCreated {
		t.Fatalf("split = %d: %s", rec.Code, rec.Body.String())
	}
	if count, _ := dataOf(t, rec)["pageCount"].(float64); count != 6 {
		t.Errorf("pageCount = %v, want 6", count)
	}
}

func TestSplitRejectsUnknownMode(t *testing.T) {
	mux, _, _ := newTestMux(t)
	session := newSession(t)
	id := openUploadedPDF(t, mux, session, threePageA4(t))
	rec := splitJSON(t, mux, map[string]any{"assetId": id, "splitMode": "diagonal"}, session)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
	}
	if code := decodeEnvelope(t, rec).Code; code != "bad_body" {
		t.Errorf("code = %q, want bad_body (splitMode is client input)", code)
	}
}

func TestSplitCustomNeedsCuts(t *testing.T) {
	mux, _, _ := newTestMux(t)
	session := newSession(t)
	id := openUploadedPDF(t, mux, session, threePageA4(t))
	rec := splitJSON(t, mux, map[string]any{"assetId": id, "splitMode": "custom"}, session)
	if rec.Code != http.StatusBadRequest || decodeEnvelope(t, rec).Code != "bad_body" {
		t.Fatalf("got %d %s, want 400 bad_body", rec.Code, rec.Body.String())
	}
}

func TestSplitNeedsSessionAndAsset(t *testing.T) {
	mux, _, _ := newTestMux(t)
	rec := splitJSON(t, mux, map[string]any{"assetId": "as1", "splitMode": "auto"}, "")
	if rec.Code != http.StatusBadRequest || decodeEnvelope(t, rec).Code != "bad_session" {
		t.Fatalf("no session: got %d %s, want 400 bad_session", rec.Code, rec.Body.String())
	}
	session := newSession(t)
	rec = splitJSON(t, mux, map[string]any{"assetId": "", "splitMode": "auto"}, session)
	if rec.Code != http.StatusBadRequest || decodeEnvelope(t, rec).Code != "bad_body" {
		t.Fatalf("no assetId: got %d %s, want 400 bad_body", rec.Code, rec.Body.String())
	}
	rec = splitJSON(t, mux, map[string]any{"assetId": "asmissing", "splitMode": "auto"}, session)
	if rec.Code != http.StatusNotFound || decodeEnvelope(t, rec).Code != "not_found" {
		t.Fatalf("unknown asset: got %d %s, want 404 not_found", rec.Code, rec.Body.String())
	}
}

// The cut must not destroy the source asset: the answer is a *new* asset, and
// the original's bytes still serve afterwards (that is the UI's 撤销).
func TestSplitKeepsOriginalAssetUsable(t *testing.T) {
	mux, _, _ := newTestMux(t)
	session := newSession(t)
	id := openUploadedPDF(t, mux, session, threePageA4(t))
	if rec := splitJSON(t, mux, map[string]any{"assetId": id, "splitMode": "rows-cols", "rows": 1, "cols": 2}, session); rec.Code != http.StatusCreated {
		t.Fatalf("split = %d: %s", rec.Code, rec.Body.String())
	}
	req := httptest.NewRequest(http.MethodGet, "/api/pdf/raw?id="+id, nil)
	req.Header.Set(webx.SessionHeader, session)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("raw of the original asset = %d, want 200", rec.Code)
	}
	if got := len(rec.Body.Bytes()); got < 300 {
		t.Errorf("original bytes = %d, want them still served", got)
	}
}
