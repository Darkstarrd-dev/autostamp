package api

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"autostamp/internal/webx"
)

// stampPNG builds a small stamp bitmap: white paper around an opaque red
// square, so despill and the alpha crop have something real to work with.
func stampPNG(t *testing.T) []byte {
	t.Helper()
	return encodePNG(t, square(t, 20, 5, 15, color.NRGBA{R: 200, G: 30, B: 30, A: 255}))
}

// blankPNG is uniform paper with no ink at all.
func blankPNG(t *testing.T, size int, c color.NRGBA) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			img.SetNRGBA(x, y, c)
		}
	}
	return encodePNG(t, img)
}

// square builds a size×size white bitmap with an opaque rect at x,y = from..to.
func square(t *testing.T, size, from, to int, ink color.NRGBA) image.Image {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			img.SetNRGBA(x, y, color.NRGBA{R: 255, G: 255, B: 255, A: 255})
		}
	}
	for y := from; y < to; y++ {
		for x := from; x < to; x++ {
			img.SetNRGBA(x, y, ink)
		}
	}
	_ = t
	return img
}

func encodePNG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return b.Bytes()
}

// prepareSeal posts the multipart form the front-end sends.
func prepareSeal(t *testing.T, mux http.Handler, session string, file []byte, fields map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	fw, err := w.CreateFormFile("file", "seal.png")
	if err != nil {
		t.Fatalf("form file: %v", err)
	}
	if _, err := fw.Write(file); err != nil {
		t.Fatalf("write file: %v", err)
	}
	for k, v := range fields {
		if err := w.WriteField(k, v); err != nil {
			t.Fatalf("field %s: %v", k, err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/pdf/seal/prepare", &body)
	req.Header.Set("Content-Type", w.FormDataContentType())
	if session != "" {
		req.Header.Set(webx.SessionHeader, session)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func numField(t *testing.T, data map[string]any, key string) float64 {
	t.Helper()
	v, ok := data[key]
	if !ok {
		t.Fatalf("missing key %q in %v", key, data)
	}
	n, ok := v.(float64)
	if !ok {
		t.Fatalf("%q is %#v, want a JSON number", key, v)
	}
	return n
}

func TestSealPrepareReportsAlphaMetadata(t *testing.T) {
	mux, _, _ := newTestMux(t)
	owner := newSession(t)

	rec := prepareSeal(t, mux, owner, stampPNG(t), nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 body=%s", rec.Code, rec.Body.String())
	}
	data := dataOf(t, rec)
	if got := numField(t, data, "srcWidth"); got != 20 {
		t.Errorf("srcWidth = %v, want 20", got)
	}
	if got := numField(t, data, "srcHeight"); got != 20 {
		t.Errorf("srcHeight = %v, want 20", got)
	}
	if mime, _ := data["mime"].(string); mime != "image/png" {
		t.Errorf("mime = %q, want image/png", mime)
	}
	id, _ := data["sealId"].(string)
	if !strings.HasPrefix(id, "sl") {
		t.Fatalf("sealId = %q, want the seal id prefix (tmpstore.NewID)", id)
	}
	if url, _ := data["url"].(string); url != "/api/pdf/seal/raw?id="+id {
		t.Errorf("url = %q, want the raw route for %s", url, id)
	}
	// The echo reports what was applied: the documented defaults.
	echo, _ := data["echo"].(map[string]any)
	if echo["despill"] != true || echo["alphaTrimed"] != true || echo["resampleDpi"] != float64(300) {
		t.Errorf("echo = %v, want defaults despill/alphaTrim true, resampleDpi 300", echo)
	}
	box, ok := data["alphaBBox"].(map[string]any)
	if !ok {
		t.Fatalf("alphaBBox = %#v, want an object", data["alphaBBox"])
	}
	// The white matte is gone, so the ink square starts at 5,5 and is 10×10.
	if got := numField(t, box, "x"); got != 5 {
		t.Errorf("alphaBBox.x = %v, want 5 (the ink square's edge)", got)
	}
	if got := numField(t, box, "w"); got != 10 {
		t.Errorf("alphaBBox.w = %v, want 10", got)
	}
	// Trim runs after the despill, so the bitmap itself is cropped to the ink.
	if got := numField(t, data, "width"); got != 10 {
		t.Errorf("width = %v, want 10 (alphaTrim cropped the paper)", got)
	}
	// The ratio counts the source bitmap, not the crop: 100 ink px of 400.
	if got := numField(t, data, "opaqueRatio"); got != 2500 {
		t.Errorf("opaqueRatio = %v, want 2500 (25%% of the source is ink)", got)
	}
}

func TestSealPrepareAppliesOptions(t *testing.T) {
	mux, _, _ := newTestMux(t)
	owner := newSession(t)

	// Trim off keeps the white padding; the bbox still reports where the ink is.
	rec := prepareSeal(t, mux, owner, stampPNG(t), map[string]string{"alphaTrim": "false"})
	data := dataOf(t, rec)
	if got := numField(t, data, "width"); got != 20 {
		t.Errorf("width with trim off = %v, want 20 (padding kept)", got)
	}
	echo, _ := data["echo"].(map[string]any)
	if echo["alphaTrimed"] != false {
		t.Errorf("echo.alphaTrimed = %v, want false as sent", echo["alphaTrimed"])
	}

	// Despill off means the paper stays opaque: the whole bitmap has ink.
	rec = prepareSeal(t, mux, owner, stampPNG(t), map[string]string{"despill": "false"})
	data = dataOf(t, rec)
	if got := numField(t, data, "opaqueRatio"); got != 10000 {
		t.Errorf("opaqueRatio with despill off = %v, want 10000 (white paper kept)", got)
	}

	// The upload carries no pHYs, so the source DPI report says "unknown".
	rec = prepareSeal(t, mux, owner, stampPNG(t), map[string]string{"resampleDpi": "600"})
	data = dataOf(t, rec)
	if got := numField(t, data, "sourceDpi"); got != 0 {
		t.Errorf("sourceDpi = %v, want 0 (no pHYs in the upload)", got)
	}
	echo, _ = data["echo"].(map[string]any)
	if echo["resampleDpi"] != float64(600) {
		t.Errorf("echo.resampleDpi = %v, want 600", echo["resampleDpi"])
	}
}

func TestSealPrepareRejects(t *testing.T) {
	mux, _, _ := newTestMux(t)
	owner := newSession(t)

	// Non-image bytes must not become a seal asset.
	rec := prepareSeal(t, mux, owner, []byte("not an image"), nil)
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("non-image upload = %d, want 415 body=%s", rec.Code, rec.Body.String())
	}
	if code := decodeEnvelope(t, rec).Code; code != "seal_type" {
		t.Errorf("code = %s, want seal_type", code)
	}

	// White paper with the white matte removed leaves nothing to stamp.
	blank := blankPNG(t, 8, color.NRGBA{R: 255, G: 255, B: 255, A: 255})
	if rec := prepareSeal(t, mux, owner, blank, nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("blank seal = %d, want 400 body=%s", rec.Code, rec.Body.String())
	} else if code := decodeEnvelope(t, rec).Code; code != "seal_empty" {
		t.Errorf("code = %s, want seal_empty", code)
	}

	// No session, no prepare.
	if rec := prepareSeal(t, mux, "", stampPNG(t), nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("no-session prepare = %d, want 400", rec.Code)
	} else if code := decodeEnvelope(t, rec).Code; code != "bad_session" {
		t.Errorf("code = %s, want bad_session", code)
	}

	// A JSON body is the wrong shape for this route.
	req := httptest.NewRequest(http.MethodPost, "/api/pdf/seal/prepare", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(webx.SessionHeader, owner)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest || decodeEnvelope(t, rec).Code != "bad_body" {
		t.Errorf("json body = %d/%s, want 400 bad_body", rec.Code, decodeEnvelope(t, rec).Code)
	}
}

func TestSealRawServesOnlySealAssets(t *testing.T) {
	mux, _, assets := newTestMux(t)
	owner := newSession(t)

	rec := prepareSeal(t, mux, owner, stampPNG(t), nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("prepare = %d: %s", rec.Code, rec.Body.String())
	}
	id, _ := dataOf(t, rec)["sealId"].(string)

	get := func(path string, hdr map[string]string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set(webx.SessionHeader, owner)
		for k, v := range hdr {
			req.Header.Set(k, v)
		}
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec
	}

	rec = get("/api/pdf/seal/raw?id="+id, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("seal raw = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
		t.Errorf("content-type = %q, want image/png", ct)
	}
	if _, err := png.Decode(bytes.NewReader(rec.Body.Bytes())); err != nil {
		t.Errorf("served body is not a PNG: %v", err)
	}

	rec = get("/api/pdf/seal/raw?id="+id, map[string]string{"Range": "bytes=0-63"})
	if rec.Code != http.StatusPartialContent || rec.Body.Len() != 64 {
		t.Errorf("range = %d len=%d, want 206/64", rec.Code, rec.Body.Len())
	}

	// The seal id must not be fetchable through the document route.
	if rec = get("/api/pdf/raw?id="+id, nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("document route with a seal id = %d, want 400", rec.Code)
	} else if code := decodeEnvelope(t, rec).Code; code != "kind_denied" {
		t.Errorf("code = %s, want kind_denied", code)
	}

	// A document asset must not be fetchable through the seal route.
	pdfPath := writePDF(t, "doc seal.pdf")
	rec = openJSON(t, mux, `{"pathGrantId":"`+grantPath(t, assets, pdfPath, owner)+`"}`, owner)
	if rec.Code != http.StatusCreated {
		t.Fatalf("open = %d: %s", rec.Code, rec.Body.String())
	}
	pdfID, _ := dataOf(t, rec)["assetId"].(string)
	if rec = get("/api/pdf/seal/raw?id="+pdfID, nil); rec.Code != http.StatusBadRequest {
		t.Errorf("seal route with a document id = %d, want 400", rec.Code)
	}

	// Another window's session cannot read it.
	other := newSession(t)
	req := httptest.NewRequest(http.MethodGet, "/api/pdf/seal/raw?id="+id, nil)
	req.Header.Set(webx.SessionHeader, other)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("other session = %d, want 404", rec.Code)
	}

	// The id is required; an empty query is a client bug, not a miss.
	if rec = get("/api/pdf/seal/raw?id=", nil); rec.Code != http.StatusBadRequest {
		t.Errorf("empty id = %d, want 400", rec.Code)
	}
}

func TestSealPrepareBodyCap(t *testing.T) {
	mux, _, _ := newTestMux(t)
	owner := newSession(t)

	// The route is wrapped in MaxBytesHandler, so a body past the cap is
	// rejected before the handler ever parses it (AGENTS §5.11 spirit).
	payload := bytes.Repeat([]byte("0"), maxSealBody+1<<20)
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	fw, err := w.CreateFormFile("file", "big.png")
	if err != nil {
		t.Fatalf("form file: %v", err)
	}
	if _, err := io.Copy(fw, bytes.NewReader(payload)); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/pdf/seal/prepare", &body)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set(webx.SessionHeader, owner)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code == http.StatusCreated {
		t.Fatalf("over-cap body accepted, want a rejection")
	}
}
