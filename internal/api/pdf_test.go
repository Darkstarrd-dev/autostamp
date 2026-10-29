package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"autostamp/internal/tmpstore"
	"autostamp/internal/webx"
)

// minimalPDF is a one-page A4 document written with correct byte offsets, the
// smallest input pdfcpu accepts.
func minimalPDF(t *testing.T) []byte {
	t.Helper()
	objs := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 595 842] >>",
		"<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		"<< /Length 4 >>\nstream\nq Q\nendstream",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	}
	var b bytes.Buffer
	b.WriteString("%PDF-1.7\n")
	offsets := make([]int, len(objs)+1)
	for i, body := range objs {
		nr := i + 1
		offsets[nr] = b.Len()
		b.WriteString(strconv.Itoa(nr) + " 0 obj\n" + body + "\nendobj\n")
	}
	xref := b.Len()
	b.WriteString("xref\n0 " + strconv.Itoa(len(objs)+1) + "\n0000000000 65535 f \n")
	for nr := 1; nr <= len(objs); nr++ {
		fmt.Fprintf(&b, "%010d 00000 n \n", offsets[nr])
	}
	b.WriteString("trailer\n<< /Size " + strconv.Itoa(len(objs)+1) + " /Root 1 0 R >>\nstartxref\n" +
		strconv.Itoa(xref) + "\n%%EOF\n")
	return b.Bytes()
}

// writePDF puts a valid PDF on disk and returns its path.
func writePDF(t *testing.T, name string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, minimalPDF(t), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
	return path
}

func grantPath(t *testing.T, assets *tmpstore.Store, path, owner string) string {
	t.Helper()
	id, err := tmpstore.NewID("pg")
	if err != nil {
		t.Fatalf("new id: %v", err)
	}
	if _, err := assets.GrantPath(id, path, owner, true); err != nil {
		t.Fatalf("grant: %v", err)
	}
	return id
}

func newSession(t *testing.T) string {
	t.Helper()
	tok, err := webx.NewToken()
	if err != nil {
		t.Fatalf("token: %v", err)
	}
	return tok
}

// openJSON posts the {"pathGrantId":…} shape used by the picker path.
func openJSON(t *testing.T, mux http.Handler, body, session string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/pdf/open", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(webx.SessionHeader, session)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func dataOf(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	env := decodeEnvelope(t, rec)
	if !env.OK {
		t.Fatalf("ok = false (code=%s err=%s)", env.Code, env.Error)
	}
	raw, err := json.Marshal(env.Data)
	if err != nil {
		t.Fatalf("data not encodable: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("data not an object: %v", err)
	}
	return m
}

func TestOpenByGrantReportsPageStructure(t *testing.T) {
	mux, _, assets := newTestMux(t)
	owner := newSession(t)
	path := writePDF(t, "合同 a.pdf")
	rec := openJSON(t, mux, `{"pathGrantId":"`+grantPath(t, assets, path, owner)+`"}`, owner)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /api/pdf/open = %d body=%s", rec.Code, rec.Body.String())
	}
	data := dataOf(t, rec)
	if data["assetId"] == "" || data["assetId"] == nil {
		t.Error("no assetId in the open response")
	}
	if data["name"] != filepath.Base(path) {
		t.Errorf("name = %v, want the file name as the display name", data["name"])
	}
	if data["pageCount"] != float64(1) {
		t.Errorf("pageCount = %v, want 1 (flat field, not a nested doc)", data["pageCount"])
	}
	pages, _ := data["pages"].([]any)
	if len(pages) != 1 {
		t.Fatalf("pages = %v, want one entry", data["pages"])
	}
	page, _ := pages[0].(map[string]any)
	if page["width"] != float64(595) || page["height"] != float64(842) {
		t.Errorf("page = %v, want A4 extents in pt", page)
	}
	if page["number"] != float64(1) {
		t.Errorf("page number = %v, want 1", page["number"])
	}
}

// The recent list is what P6's batch picker shows; opening through a grant must
// register the file, otherwise the UI list stays empty forever.
func TestOpenRecordsTheRecentFile(t *testing.T) {
	mux, _, assets := newTestMux(t)
	owner := newSession(t)
	path := writePDF(t, "recent.pdf")
	if rec := openJSON(t, mux, `{"pathGrantId":"`+grantPath(t, assets, path, owner)+`"}`, owner); rec.Code != http.StatusCreated {
		t.Fatalf("open = %d %s", rec.Code, rec.Body.String())
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/settings", nil))
	data := dataOf(t, rec)
	settings, _ := data["settings"].(map[string]any)
	list, _ := settings["recentFiles"].([]any)
	if len(list) != 1 {
		t.Fatalf("recentFiles = %v, want the opened path recorded", settings["recentFiles"])
	}
	entry, _ := list[0].(map[string]any)
	if entry["path"] != path {
		t.Errorf("recent entry = %v, want %s", entry, path)
	}
}

func TestOpenNeedsASessionOfItsOwn(t *testing.T) {
	mux, _, assets := newTestMux(t)
	first, second := newSession(t), newSession(t)
	path := writePDF(t, "shared.pdf")
	grant := grantPath(t, assets, path, first)

	// A grant belonging to another window is refused, and a request without a
	// token is a client bug rather than a security decision.
	if rec := openJSON(t, mux, `{"pathGrantId":"`+grant+`"}`, second); rec.Code != http.StatusBadRequest {
		t.Errorf("cross-session open = %d, want 400", rec.Code)
	} else if env := decodeEnvelope(t, rec); env.Code != "path_denied" {
		t.Errorf("code = %s, want path_denied", env.Code)
	}
	if rec := openJSON(t, mux, `{"pathGrantId":"`+grant+`"}`, ""); rec.Code != http.StatusBadRequest {
		t.Errorf("no-session open = %d, want 400", rec.Code)
	} else if env := decodeEnvelope(t, rec); env.Code != "bad_session" {
		t.Errorf("code = %s, want bad_session", env.Code)
	}
}

func TestOpenUploadMultipart(t *testing.T) {
	mux, _, _ := newTestMux(t)
	owner := newSession(t)

	post := func(fileName string, body []byte) *httptest.ResponseRecorder {
		var buf bytes.Buffer
		w := multipart.NewWriter(&buf)
		fw, err := w.CreateFormFile("file", fileName)
		if err != nil {
			t.Fatal(err)
		}
		fw.Write(body)
		w.Close()
		req := httptest.NewRequest(http.MethodPost, "/api/pdf/open", &buf)
		req.Header.Set("Content-Type", w.FormDataContentType())
		req.Header.Set(webx.SessionHeader, owner)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec
	}

	rec := post("dropped.pdf", minimalPDF(t))
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload open = %d %s", rec.Code, rec.Body.String())
	}
	if data := dataOf(t, rec); data["pageCount"] != float64(1) {
		t.Errorf("uploaded doc = %v", data)
	}
	if rec := post("notes.txt", []byte("hello")); rec.Code != http.StatusBadRequest {
		t.Errorf("non-pdf upload = %d, want 400", rec.Code)
	} else if env := decodeEnvelope(t, rec); env.Code != "not_pdf" {
		t.Errorf("code = %s, want not_pdf", env.Code)
	}
	// A corrupt .pdf must not be mistaken for a password prompt.
	if rec := post("broken.pdf", []byte("%PDF-1.7\nnot a real body\n%%EOF\n")); rec.Code != http.StatusBadRequest {
		t.Errorf("broken pdf = %d, want 400", rec.Code)
	} else if env := decodeEnvelope(t, rec); env.Code != "unreadable_pdf" {
		t.Errorf("code = %s, want unreadable_pdf", env.Code)
	}
}

// The harness caps a single file at 1 MiB, so a 2 MiB document must be rejected
// before it is spooled (AGENTS §5.11 quota chain).
func TestOpenRejectsOverQuotaFile(t *testing.T) {
	mux, _, assets := newTestMux(t)
	owner := newSession(t)
	path := filepath.Join(t.TempDir(), "big.pdf")
	if err := os.WriteFile(path, bytes.Repeat([]byte("%"), 2<<20), 0o600); err != nil {
		t.Fatal(err)
	}
	rec := openJSON(t, mux, `{"pathGrantId":"`+grantPath(t, assets, path, owner)+`"}`, owner)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("over-quota open = %d, want 413: %s", rec.Code, rec.Body.String())
	}
	if env := decodeEnvelope(t, rec); env.Code != "payload_too_large" {
		t.Errorf("code = %s, want payload_too_large", env.Code)
	}
}

func TestRawServesBytesAndRanges(t *testing.T) {
	mux, _, assets := newTestMux(t)
	owner, other := newSession(t), newSession(t)
	pdf := minimalPDF(t)
	id, err := tmpstore.NewID("as")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := assets.Add(id, tmpstore.KindSource, owner, bytes.NewReader(pdf)); err != nil {
		t.Fatal(err)
	}

	get := func(session, rangeHeader string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/pdf/raw?id="+id, nil)
		req.Header.Set(webx.SessionHeader, session)
		if rangeHeader != "" {
			req.Header.Set("Range", rangeHeader)
		}
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec
	}

	rec := get(owner, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("raw = %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/pdf" {
		t.Errorf("Content-Type = %q, want application/pdf", ct)
	}
	if rec.Header().Get("Accept-Ranges") != "bytes" {
		t.Error("raw must advertise ranges so pdf.js can page through a document")
	}
	if !bytes.Equal(rec.Body.Bytes(), pdf) {
		t.Error("raw body != the stored bytes")
	}

	partial := get(owner, "bytes=0-3")
	if partial.Code != http.StatusPartialContent {
		t.Fatalf("range = %d, want 206", partial.Code)
	}
	if got := partial.Body.String(); got != "%PDF" {
		t.Errorf("first 4 bytes = %q, want the PDF header", got)
	}

	if missing := get(other, ""); missing.Code != http.StatusNotFound {
		t.Errorf("foreign asset = %d, want 404", missing.Code)
	} else if env := decodeEnvelope(t, missing); env.Code != "not_found" {
		t.Errorf("code = %s, want not_found", env.Code)
	}
}

// The pick filter vocabulary is frozen (UI_SPEC §2); an unknown value must not
// reach the native dialog.
func TestPickRejectsUnknownFilter(t *testing.T) {
	mux, _, _ := newTestMux(t)
	req := httptest.NewRequest(http.MethodPost, "/api/fs/pick", strings.NewReader(`{"filter":"exe"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(webx.SessionHeader, newSession(t))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("filter=exe = %d, want 400", rec.Code)
	}
	if env := decodeEnvelope(t, rec); env.Code != "bad_body" {
		t.Errorf("code = %s, want bad_body", env.Code)
	}
}

func TestRawRequiresAKnownAsset(t *testing.T) {
	mux, _, _ := newTestMux(t)
	req := httptest.NewRequest(http.MethodGet, "/api/pdf/raw?id=as-nope", nil)
	req.Header.Set(webx.SessionHeader, newSession(t))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("unknown asset = %d, want 404", rec.Code)
	}
	if _, err := io.ReadAll(rec.Body); err != nil {
		t.Fatal(err)
	}
}

// The empty-state path box is the only way to open a file without a dialog, so
// it must return a grant the open route accepts.
func TestPickGrantsTypedPath(t *testing.T) {
	mux, _, _ := newTestMux(t)
	owner := newSession(t)
	path := writePDF(t, "typed.pdf")

	post := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/fs/pick", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set(webx.SessionHeader, owner)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec
	}

	rec := post(`{"filePath":"` + filepath.ToSlash(path) + `"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("typed pick = %d %s", rec.Code, rec.Body.String())
	}
	data := dataOf(t, rec)
	if data["cancelled"] != false {
		t.Errorf("cancelled = %v, want false for a typed path", data["cancelled"])
	}
	picks, _ := data["picks"].([]any)
	if len(picks) != 1 {
		t.Fatalf("picks = %v, want one grant", data["picks"])
	}
	one, _ := picks[0].(map[string]any)
	if one["path"] != filepath.ToSlash(path) && one["path"] != path {
		t.Errorf("path = %v, want %s", one["path"], path)
	}
	grant, _ := one["pathGrantId"].(string)
	if grant == "" {
		t.Fatal("typed pick returned no pathGrantId")
	}
	if open := openJSON(t, mux, `{"pathGrantId":"`+grant+`"}`, owner); open.Code != http.StatusCreated {
		t.Errorf("open with the typed grant = %d %s", open.Code, open.Body.String())
	}

	// A path that does not exist must not be granted.
	if missing := post(`{"filePath":"` + filepath.ToSlash(filepath.Join(t.TempDir(), "nope.pdf")) + `"}`); missing.Code != http.StatusBadRequest {
		t.Errorf("missing path = %d, want 400", missing.Code)
	} else if env := decodeEnvelope(t, missing); env.Code != "path_denied" {
		t.Errorf("code = %s, want path_denied", env.Code)
	}
	// A directory is not a file to open.
	dirPick := post(`{"filePath":"` + filepath.ToSlash(t.TempDir()) + `"}`)
	if dirPick.Code != http.StatusBadRequest {
		t.Errorf("directory path = %d, want 400", dirPick.Code)
	}
}
