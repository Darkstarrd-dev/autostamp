package api

// P5 export-route contract tests (AGENTS §6 POST /api/pdf/export). The pixel
// judgement of the raster path stays with pdf.js (tools/verify); these tests
// pin the content negotiation, the asset bookkeeping, the loud 400s and the
// W6 hard limit, which is what the route owns.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"

	"autostamp/internal/webx"
)

func exportJSON(t *testing.T, mux http.Handler, body map[string]any, session string) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/pdf/export", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	if session != "" {
		req.Header.Set(webx.SessionHeader, session)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

// exportMultipart posts the raster half: the spec JSON string plus one file
// per page, exactly the shape the front-end sends.
func exportMultipart(t *testing.T, mux http.Handler, spec string, pages map[int][]byte, session string) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, err := w.CreateFormField("spec")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write([]byte(spec)); err != nil {
		t.Fatal(err)
	}
	nums := make([]int, 0, len(pages))
	for n := range pages {
		nums = append(nums, n)
	}
	sort.Ints(nums)
	for _, n := range nums {
		fw, err := w.CreateFormFile(fmt.Sprintf("page-%d", n), fmt.Sprintf("page-%d.jpg", n))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := fw.Write(pages[n]); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/pdf/export", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	if session != "" {
		req.Header.Set(webx.SessionHeader, session)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

// exportSpecStr is one complete raster spec, so each case says what it changes.
func exportSpecStr(t *testing.T, asset string, override map[string]any) string {
	t.Helper()
	m := map[string]any{"assetId": asset, "mode": "raster", "dpi": 150, "quality": 75, "pages": "all"}
	for k, v := range override {
		m[k] = v
	}
	raw, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

// pageJPEG builds a deterministic w×h page bitmap as JPEG q75 — the preferred
// raster input, which the writer passes through untouched.
func pageJPEG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			img.SetNRGBA(x, y, color.NRGBA{uint8(x * 255 / max(1, w-1)), uint8(y * 255 / max(1, h-1)), 90, 255})
		}
	}
	var b bytes.Buffer
	if err := jpeg.Encode(&b, img, &jpeg.Options{Quality: 75}); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// pagePNG builds an incompressible w×h noise PNG, for the size-cap test:
// small bitmaps that still exceed a shrunken maxPageImageBytes.
func pagePNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			img.SetNRGBA(x, y, color.NRGBA{uint8(x*7 + y*13), uint8(x*3 ^ y), uint8((x*x + y) % 256), 255})
		}
	}
	return encodePNG(t, img)
}

// nPagePDF is the threePageA4 fixture generalized to n pages, so the page-cap
// test can build a 201-page document without 201 fixture objects of prose.
func nPagePDF(t *testing.T, n int) []byte {
	t.Helper()
	var b bytes.Buffer
	b.WriteString("%PDF-1.7\n")
	total := n + 3 // catalog + tree + n pages + one shared content stream
	offsets := make([]int, total+1)
	writeObj := func(nr int, body string) {
		offsets[nr] = b.Len()
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", nr, body)
	}
	var kids strings.Builder
	for p := 3; p <= n+2; p++ {
		fmt.Fprintf(&kids, "%d 0 R ", p)
	}
	writeObj(1, "<< /Type /Catalog /Pages 2 0 R >>")
	writeObj(2, fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d /MediaBox [0 0 595 842] /Rotate 0 >>", strings.TrimRight(kids.String(), " "), n))
	for p := 3; p <= n+2; p++ {
		writeObj(p, fmt.Sprintf("<< /Type /Page /Parent 2 0 R /Contents %d 0 R >>", n+3))
	}
	writeObj(n+3, "<< /Length 4 >>\nstream\nq Q\nendstream")
	xref := b.Len()
	b.WriteString("xref\n")
	fmt.Fprintf(&b, "0 %d\n0000000000 65535 f \n", total)
	for nr := 1; nr <= total; nr++ {
		fmt.Fprintf(&b, "%010d 00000 n \n", offsets[nr])
	}
	fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", total, xref)
	return b.Bytes()
}

// The vector/all path is a byte-for-byte clone with a fresh assetId, kind
// "exported", and the disk origin carried forward.
func TestExportRouteVectorClonesAll(t *testing.T) {
	mux, _, assets := newTestMux(t)
	session := newSession(t)
	srcPDF := threePageA4(t)
	src := openUploadedPDF(t, mux, session, srcPDF)
	if err := assets.SetOrigin(src, `C:/tmp/original.pdf`); err != nil {
		t.Fatal(err)
	}

	rec := exportJSON(t, mux, map[string]any{"assetId": src, "mode": "vector", "pages": "all"}, session)
	if rec.Code != http.StatusCreated {
		t.Fatalf("export = %d, want 201: %s", rec.Code, rec.Body.String())
	}
	data := dataOf(t, rec)
	newID, _ := data["assetId"].(string)
	if newID == "" || newID == src {
		t.Fatalf("assetId = %v, want a fresh id distinct from %s", data["assetId"], src)
	}
	if data["kind"] != "exported" {
		t.Errorf("kind = %v, want exported", data["kind"])
	}
	if data["mode"] != "vector" {
		t.Errorf("mode = %v, want vector", data["mode"])
	}
	if dims := splitDims(t, rec); len(dims) != 3 || dims[0] != "595x842" {
		t.Errorf("pages = %v, want the three source A4 pages", dims)
	}
	// 克隆是字节原样复制：the read-back must equal the upload byte for byte.
	if raw := rawAsset(t, mux, session, newID); !bytes.Equal(raw, srcPDF) {
		t.Errorf("cloned asset is %d bytes, want the source's %d byte-for-byte", len(raw), len(srcPDF))
	}
	if origin, err := assets.OriginOf(newID, session); err != nil || origin != `C:/tmp/original.pdf` {
		t.Errorf("origin = %q (%v), want the source origin carried forward", origin, err)
	}
}

// The vector subset trims to exactly the selected pages; none and out-of-range
// selections are loud 400s.
func TestExportRouteVectorSubsetPages(t *testing.T) {
	mux, _, _ := newTestMux(t)
	session := newSession(t)
	src := openUploadedPDF(t, mux, session, threePageA4(t))

	rec := exportJSON(t, mux, map[string]any{"assetId": src, "mode": "vector", "pages": "1-2"}, session)
	if rec.Code != http.StatusCreated {
		t.Fatalf("export 1-2 = %d, want 201: %s", rec.Code, rec.Body.String())
	}
	if dims := splitDims(t, rec); len(dims) != 2 {
		t.Errorf("pages = %v, want exactly the two selected pages", dims)
	}
	if got, _ := dataOf(t, rec)["pageCount"].(float64); got != 2 {
		t.Errorf("pageCount = %v, want 2", got)
	}

	if rec := exportJSON(t, mux, map[string]any{"assetId": src, "mode": "vector", "pages": "none"}, session); rec.Code != http.StatusBadRequest || errorCode(t, rec) != "bad_body" {
		t.Errorf("pages none = %d/%s, want 400 bad_body", rec.Code, errorCode(t, rec))
	}
	if rec := exportJSON(t, mux, map[string]any{"assetId": src, "mode": "vector", "pages": "5"}, session); rec.Code != http.StatusBadRequest {
		t.Errorf("pages out of range = %d, want 400", rec.Code)
	}
}

// webx.DecodeJSON uses DisallowUnknownFields: raster-only vocabulary in a
// vector body is a 400, exactly like apply rejecting an instance field outside its vocabulary.
func TestExportRouteVectorRejectsUnknownFields(t *testing.T) {
	mux, _, _ := newTestMux(t)
	session := newSession(t)
	src := openUploadedPDF(t, mux, session, threePageA4(t))

	for _, extra := range []map[string]any{{"dpi": 150}, {"quality": 75}, {"customDpi": 300}} {
		body := map[string]any{"assetId": src, "mode": "vector", "pages": "all"}
		for k, v := range extra {
			body[k] = v
		}
		if rec := exportJSON(t, mux, body, session); rec.Code != http.StatusBadRequest || errorCode(t, rec) != "bad_body" {
			t.Errorf("vector body with %v = %d/%s, want 400 bad_body", extra, rec.Code, errorCode(t, rec))
		}
	}
	if rec := exportJSON(t, mux, map[string]any{"assetId": src, "mode": "raster", "pages": "all"}, session); rec.Code != http.StatusBadRequest {
		t.Errorf("JSON body with mode raster = %d, want 400 (raster goes through multipart)", rec.Code)
	}
}

// The raster path answers a new asset with the echoed parameters, the
// per-page byte counts and the re-measured page geometry.
func TestExportRouteRasterAnswersNewAsset(t *testing.T) {
	mux, _, assets := newTestMux(t)
	session := newSession(t)
	src := openUploadedPDF(t, mux, session, threePageA4(t))
	page := pageJPEG(t, 100, 140)
	pages := map[int][]byte{1: page, 2: page, 3: page}

	rec := exportMultipart(t, mux, exportSpecStr(t, src, nil), pages, session)
	if rec.Code != http.StatusCreated {
		t.Fatalf("raster export = %d, want 201: %s", rec.Code, rec.Body.String())
	}
	data := dataOf(t, rec)
	newID, _ := data["assetId"].(string)
	if newID == "" || newID == src {
		t.Fatalf("assetId = %v, want a fresh id distinct from %s", data["assetId"], src)
	}
	if data["kind"] != "exported" || data["mode"] != "raster" {
		t.Errorf("kind/mode = %v/%v, want exported/raster", data["kind"], data["mode"])
	}
	if got, _ := data["dpi"].(float64); got != 150 {
		t.Errorf("dpi = %v, want 150", got)
	}
	if got, _ := data["quality"].(float64); got != 75 {
		t.Errorf("quality = %v, want 75", got)
	}
	per, _ := data["bytesPerPage"].([]any)
	if len(per) != 3 {
		t.Fatalf("bytesPerPage = %v, want 3 entries", per)
	}
	for i, v := range per {
		if got, _ := v.(float64); int64(got) != int64(len(page)) {
			t.Errorf("bytesPerPage[%d] = %v, want %d", i, got, len(page))
		}
	}
	// 100x140 px @ 150 dpi ⇒ 48 x 67.2 pt.
	if dims := splitDims(t, rec); len(dims) != 3 || dims[0] != "48x67.2" {
		t.Errorf("page dims = %v, want 48x67.2", dims)
	}
	if _, err := assets.Get(newID, session); err != nil {
		t.Errorf("the exported asset is not registered in the session store: %v", err)
	}
	if raw := rawAsset(t, mux, session, newID); !bytes.HasPrefix(raw, []byte("%PDF-")) {
		t.Errorf("the exported asset is not a PDF: %q", raw[:min(8, len(raw))])
	}
}

// Ownership matters: a foreign document is 404, a seal id on either path is
// kind_denied, and no session token is no service.
func TestExportRouteNeedsOwnAssetAndKind(t *testing.T) {
	mux, _, _ := newTestMux(t)
	session := newSession(t)
	other := newSession(t)
	src := openUploadedPDF(t, mux, session, threePageA4(t))
	seal := preparedSeal(t, mux, session)

	if rec := exportJSON(t, mux, map[string]any{"assetId": src, "mode": "vector", "pages": "all"}, other); rec.Code != http.StatusNotFound {
		t.Errorf("foreign asset = %d, want 404", rec.Code)
	}
	vrec := exportJSON(t, mux, map[string]any{"assetId": seal, "mode": "vector", "pages": "all"}, session)
	if vrec.Code != http.StatusBadRequest || errorCode(t, vrec) != "kind_denied" {
		t.Errorf("seal via vector = %d/%s, want 400 kind_denied", vrec.Code, errorCode(t, vrec))
	}
	rrec := exportMultipart(t, mux, exportSpecStr(t, seal, nil), map[int][]byte{1: pageJPEG(t, 10, 10)}, session)
	if rrec.Code != http.StatusBadRequest || errorCode(t, rrec) != "kind_denied" {
		t.Errorf("seal via raster = %d/%s, want 400 kind_denied", rrec.Code, errorCode(t, rrec))
	}
	if rec := exportJSON(t, mux, map[string]any{"assetId": src, "mode": "vector", "pages": "all"}, ""); rec.Code != http.StatusBadRequest {
		t.Errorf("no session = %d, want 400", rec.Code)
	}
}

// W6: one page bitmap above maxPageImageBytes is a 400 page_too_large. The
// cap is shrunk instead of allocating 90 MB.
func TestExportRoutePageTooLarge(t *testing.T) {
	mux, _, _ := newTestMux(t)
	session := newSession(t)
	src := openUploadedPDF(t, mux, session, threePageA4(t))

	old := maxPageImageBytes
	maxPageImageBytes = 2 << 10
	defer func() { maxPageImageBytes = old }()

	page := pagePNG(t, 200, 200) // incompressible noise, well past 2 KiB
	rec := exportMultipart(t, mux, exportSpecStr(t, src, nil), map[int][]byte{1: page, 2: page, 3: page}, session)
	if rec.Code != http.StatusBadRequest || errorCode(t, rec) != "page_too_large" {
		t.Fatalf("oversized page = %d/%s, want 400 page_too_large", rec.Code, errorCode(t, rec))
	}
}

// The 200-page raster cap is a loud bad_body before any bitmap is read.
func TestExportRouteCapsRasterPages(t *testing.T) {
	mux, _, _ := newTestMux(t)
	session := newSession(t)
	src := openUploadedPDF(t, mux, session, nPagePDF(t, maxExportPages+1))

	rec := exportMultipart(t, mux, exportSpecStr(t, src, nil), nil, session)
	if rec.Code != http.StatusBadRequest || errorCode(t, rec) != "bad_body" {
		t.Fatalf("%d-page export = %d/%s, want 400 bad_body", maxExportPages+1, rec.Code, errorCode(t, rec))
	}
	if !strings.Contains(rec.Body.String(), "200") {
		t.Errorf("the cap message does not name the limit: %s", rec.Body.String())
	}
}

// Out-of-range dpi/quality is clamped and reported through the response's
// warning field, not rejected — and the clamp must reach the writer.
func TestExportRouteClampsDpiQuality(t *testing.T) {
	mux, _, _ := newTestMux(t)
	session := newSession(t)
	src := openUploadedPDF(t, mux, session, threePageA4(t))
	page := pageJPEG(t, 100, 140)

	rec := exportMultipart(t, mux, exportSpecStr(t, src, map[string]any{"dpi": 1200, "quality": 10}), map[int][]byte{1: page, 2: page, 3: page}, session)
	if rec.Code != http.StatusCreated {
		t.Fatalf("clamped export = %d, want 201: %s", rec.Code, rec.Body.String())
	}
	data := dataOf(t, rec)
	if got, _ := data["dpi"].(float64); got != 600 {
		t.Errorf("dpi = %v, want 600 (clamped)", got)
	}
	if got, _ := data["quality"].(float64); got != 40 {
		t.Errorf("quality = %v, want 40 (clamped)", got)
	}
	if warn, _ := data["warning"].(string); warn == "" {
		t.Errorf("warning = %q, want the clamp explanation", warn)
	}
	// The clamp actually flowed into the writer: 100x140 px @ 600 dpi.
	if dims := splitDims(t, rec); len(dims) != 3 || dims[0] != "12x16.8" {
		t.Errorf("page dims = %v, want 12x16.8", dims)
	}
}

// Bad raster specs answer 400 bad_body: required fields, vocabulary, page
// selection, and the one-bitmap-per-selected-page rule.
func TestExportRouteRasterRejectsBadSpec(t *testing.T) {
	mux, _, _ := newTestMux(t)
	session := newSession(t)
	src := openUploadedPDF(t, mux, session, threePageA4(t))
	pages := map[int][]byte{1: pageJPEG(t, 50, 70), 2: pageJPEG(t, 50, 70), 3: pageJPEG(t, 50, 70)}

	cases := []struct {
		name  string
		spec  string
		parts map[int][]byte
	}{
		{"missing quality", `{"assetId":"` + src + `","mode":"raster","dpi":150,"pages":"all"}`, pages},
		{"missing dpi", `{"assetId":"` + src + `","mode":"raster","quality":75,"pages":"all"}`, pages},
		{"wrong mode", exportSpecStr(t, src, map[string]any{"mode": "vector"}), pages},
		{"unknown field", exportSpecStr(t, src, map[string]any{"customDpi": 300}), pages},
		{"pages out of range", exportSpecStr(t, src, map[string]any{"pages": "9"}), pages},
		{"missing page bitmap", exportSpecStr(t, src, nil), map[int][]byte{1: pageJPEG(t, 50, 70), 3: pageJPEG(t, 50, 70)}},
		{"stray page field", exportSpecStr(t, src, nil), map[int][]byte{1: pageJPEG(t, 50, 70), 2: pageJPEG(t, 50, 70), 3: pageJPEG(t, 50, 70), 4: pageJPEG(t, 50, 70)}},
	}
	for _, tc := range cases {
		if rec := exportMultipart(t, mux, tc.spec, tc.parts, session); rec.Code != http.StatusBadRequest || errorCode(t, rec) != "bad_body" {
			t.Errorf("%s = %d/%s, want 400 bad_body", tc.name, rec.Code, errorCode(t, rec))
		}
	}
}
