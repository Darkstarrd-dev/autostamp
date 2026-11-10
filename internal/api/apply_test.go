package api

// P4 apply-route contract tests (AGENTS §6 POST /api/pdf/apply). The pixel
// matrix of the write-back lives in tools/verify/apply-smoke.mjs (pdf.js
// read-back); these tests pin the vocabulary, the asset bookkeeping and the
// loud 400s, which is what the route owns.

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/draw"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	pdfapi "github.com/pdfcpu/pdfcpu/pkg/api"

	"autostamp/internal/webx"
)

func applyJSON(t *testing.T, mux http.Handler, body map[string]any, session string) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/pdf/apply", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	if session != "" {
		req.Header.Set(webx.SessionHeader, session)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func errorCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	return decodeEnvelope(t, rec).Code
}

// preparedSeal is the sealId half of an apply request: the upload channel runs
// first, because a stamp can only be baked from an image the store accepted.
func preparedSeal(t *testing.T, mux http.Handler, session string) string {
	t.Helper()
	rec := prepareSeal(t, mux, session, stampPNG(t), nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("seal/prepare = %d, want 201: %s", rec.Code, rec.Body.String())
	}
	id, _ := dataOf(t, rec)["sealId"].(string)
	if id == "" {
		t.Fatalf("no sealId in the prepare answer: %s", rec.Body.String())
	}
	return id
}

// instanceFields is one complete instance (UI_SPEC §2 apply.* vocabulary), so
// each case only has to say what it changes.
func instanceFields() map[string]any {
	return map[string]any{
		"blend":   "multiply",
		"opacity": 0.6,
		"scale":   0.2,
		"anchor":  "center",
		"offset":  "0,0",
		"pages":   "all",
	}
}

func withSeal(seal string, extra map[string]any) map[string]any {
	out := map[string]any{"sealId": seal}
	for k, v := range instanceFields() {
		out[k] = v
	}
	for k, v := range extra {
		out[k] = v
	}
	return out
}

func applyInstances(t *testing.T, mux http.Handler, session, asset string, instances []map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	return applyJSON(t, mux, map[string]any{"assetId": asset, "instances": instances}, session)
}

func applyOne(t *testing.T, mux http.Handler, session, asset, seal string, extra map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	return applyInstances(t, mux, session, asset, []map[string]any{withSeal(seal, extra)})
}

// The route bakes the seal onto a *copy*: the answer is a new asset, the source
// stays usable, and the page geometry is untouched (AGENTS §5: 所有修改落到新 asset).
func TestApplyRouteAnswersNewAssetKeepingSource(t *testing.T) {
	mux, _, assets := newTestMux(t)
	session := newSession(t)
	src := openUploadedPDF(t, mux, session, threePageA4(t))
	seal := preparedSeal(t, mux, session)

	rec := applyOne(t, mux, session, src, seal, nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("apply = %d, want 201: %s", rec.Code, rec.Body.String())
	}
	data := dataOf(t, rec)
	newID, _ := data["assetId"].(string)
	if newID == "" || newID == src {
		t.Fatalf("assetId = %v, want a fresh id distinct from %s", data["assetId"], src)
	}
	if data["kind"] != "applied" {
		t.Errorf("kind = %v, want applied", data["kind"])
	}
	if dims := splitDims(t, rec); len(dims) != 3 || dims[0] != "595x842" {
		t.Errorf("page geometry changed after applying: %v", dims)
	}
	if size, _ := data["size"].(float64); size <= 0 {
		t.Errorf("size = %v, want the stamped file's byte size", data["size"])
	}

	// The stamped copy carries pdfcpu's marked-content layer plus the alpha mask
	// the transparent PNG generates. The exact pixel state (/BM, /CA) is read
	// back through pdfcpu in internal/pdfcore and through pdf.js in
	// tools/verify/apply-smoke.mjs; scanning raw bytes here would only see what
	// pdfcpu happens to write uncompressed.
	raw := rawAsset(t, mux, session, newID)
	for _, want := range []string{"Watermark", "/SMask"} {
		if !bytes.Contains(raw, []byte(want)) {
			t.Errorf("the stamped PDF does not contain %q", want)
		}
	}
	if _, err := assets.Get(newID, session); err != nil {
		t.Errorf("the applied asset is not registered in the session store: %v", err)
	}

	// 撤销盖章 = the source asset is still there and still cuttable.
	srec := splitJSON(t, mux, map[string]any{"assetId": src, "splitMode": "rows-cols", "rows": 2, "cols": 1}, session)
	if srec.Code != http.StatusCreated {
		t.Fatalf("the source asset stopped working after applying: %d %s", srec.Code, srec.Body.String())
	}
}

// rawAsset answers GET /api/pdf/raw, which is how pdf.js and the smoke script
// read the stamped file back.
func rawAsset(t *testing.T, mux http.Handler, session, id string) []byte {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/pdf/raw?id="+id, nil)
	req.Header.Set(webx.SessionHeader, session)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("raw %s = %d: %s", id, rec.Code, rec.Body.String())
	}
	return rec.Body.Bytes()
}

// Each instance gets its own stamping layer, so the number of layers in the
// served file has to grow with the number of instances - the blend and page
// vocabulary is carried per instance.
func TestApplyRouteWritesOneLayerPerInstance(t *testing.T) {
	mux, _, _ := newTestMux(t)
	session := newSession(t)
	src := openUploadedPDF(t, mux, session, threePageA4(t))
	seal := preparedSeal(t, mux, session)

	countLayers := func(instances []map[string]any) int {
		rec := applyInstances(t, mux, session, src, instances)
		if rec.Code != http.StatusCreated {
			t.Fatalf("apply = %d, want 201: %s", rec.Code, rec.Body.String())
		}
		return bytes.Count(rawAsset(t, mux, session, dataOf(t, rec)["assetId"].(string)), []byte("Watermark"))
	}
	one := countLayers([]map[string]any{withSeal(seal, map[string]any{"pages": "1"})})
	both := countLayers([]map[string]any{
		withSeal(seal, map[string]any{"pages": "1", "blend": "screen"}),
		withSeal(seal, map[string]any{"pages": "3"}),
	})
	if both <= one {
		t.Errorf("two instances produced %d layer markers, want more than the %d of a single instance", both, one)
	}
}

// Every rejected value answers 400 with a stable code: the panel sends client
// input, so vocabulary errors must not turn into a 500.
func TestApplyRouteRejectsVocabulary(t *testing.T) {
	cases := []struct {
		name  string
		extra map[string]any
	}{
		{"unknown blend", map[string]any{"blend": "grain-soft-light"}},
		{"opacity out of range", map[string]any{"opacity": 1.4}},
		{"pages typo", map[string]any{"pages": "1-99"}},
		{"pages none", map[string]any{"pages": "none"}},
		{"bad offset", map[string]any{"offset": "left"}},
		{"rotation out of range", map[string]any{"rotation": 540}},
		{"startOffset over the percent range (N4)", map[string]any{"startOffset": 100.5}},
		{"binding none with crossPage", map[string]any{"crossPage": true, "binding": "none"}},
		{"unknown anchor", map[string]any{"anchor": "middle"}},
		{"slices on a plain instance", map[string]any{"slices": []float64{0.5, 0.5}}},
		{"slices length mismatch", map[string]any{"crossPage": true, "binding": "right", "pages": "all", "slices": []float64{0.5, 0.5}}},
		{"slices over the seal width", map[string]any{"crossPage": true, "binding": "right", "pages": "all", "slices": []float64{0.6, 0.6, 0.6}}},
		{"slices all zero", map[string]any{"crossPage": true, "binding": "right", "pages": "all", "slices": []float64{0, 0, 0}}},
		{"brightness above 2 (UI5-B2)", map[string]any{"brightness": 2.5}},
		{"saturate above the ceiling 5 (B2 moved it from 3)", map[string]any{"saturate": 5.5}},
		{"saturate below 0", map[string]any{"saturate": -0.5}},
		{"ink below the floor 1 (UI5-B2)", map[string]any{"ink": 0.5}},
		{"ink above the ceiling 10 (UI5-B2)", map[string]any{"ink": 10.5}},
		{"a bake slider sent as a string, not a number", nil},
	}
	mux, _, _ := newTestMux(t)
	session := newSession(t)
	src := openUploadedPDF(t, mux, session, threePageA4(t))
	seal := preparedSeal(t, mux, session)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			extra := tc.extra
			if tc.name == "a bake slider sent as a string, not a number" {
				// The bake sliders are numbers; the old percentage label
				// ("150%") answers 400 on the JSON type, not on the range.
				raw, err := json.Marshal(map[string]any{
					"assetId": src,
					"instances": []map[string]any{
						withSeal(seal, map[string]any{"brightness": "150%"}),
					},
				})
				if err != nil {
					t.Fatal(err)
				}
				req := httptest.NewRequest(http.MethodPost, "/api/pdf/apply", bytes.NewReader(raw))
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set(webx.SessionHeader, session)
				rec := httptest.NewRecorder()
				mux.ServeHTTP(rec, req)
				if rec.Code != http.StatusBadRequest {
					t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
				}
				return
			}
			rec := applyOne(t, mux, session, src, seal, extra)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
			}
			if code := errorCode(t, rec); code != "bad_body" {
				t.Errorf("code = %q, want bad_body", code)
			}
		})
	}
}

// Ownership matters: a foreign document is 404, a foreign seal 400, a PDF used
// as a seal kind_denied. Nothing may silently stamp nothing.
func TestApplyRouteNeedsOwnSealAndAsset(t *testing.T) {
	mux, _, _ := newTestMux(t)
	session := newSession(t)
	other := newSession(t)
	src := openUploadedPDF(t, mux, session, threePageA4(t))
	seal := preparedSeal(t, mux, session)

	if rec := applyOne(t, mux, other, src, seal, nil); rec.Code != http.StatusNotFound {
		t.Errorf("foreign asset = %d, want 404: %s", rec.Code, rec.Body.String())
	}
	if rec := applyOne(t, mux, session, src, preparedSeal(t, mux, other), nil); rec.Code != http.StatusBadRequest {
		t.Errorf("foreign seal = %d, want 400: %s", rec.Code, rec.Body.String())
	}
	if rec := applyJSON(t, mux, map[string]any{"assetId": src}, session); rec.Code != http.StatusBadRequest {
		t.Errorf("empty instances = %d, want 400: %s", rec.Code, rec.Body.String())
	}
	if rec := applyOne(t, mux, session, src, src, nil); errorCode(t, rec) != "kind_denied" {
		t.Errorf("sealId pointing at a PDF = code %q, want kind_denied", errorCode(t, rec))
	}
	if rec := applyJSON(t, mux, map[string]any{"assetId": src, "instances": []map[string]any{{}}}, ""); rec.Code != http.StatusBadRequest {
		t.Errorf("no session = %d, want 400", rec.Code)
	}
}

// Cross-page seals (骑缝章) need the split asset to work on: the route must
// answer a new asset and keep the strip vocabulary honest.
func TestApplyRouteCrossPageOnSplitAsset(t *testing.T) {
	mux, _, _ := newTestMux(t)
	session := newSession(t)
	src := openUploadedPDF(t, mux, session, threePageA4(t))
	seal := preparedSeal(t, mux, session)
	srec := splitJSON(t, mux, map[string]any{"assetId": src, "splitMode": "rows-cols", "rows": 2, "cols": 1}, session)
	if srec.Code != http.StatusCreated {
		t.Fatalf("split = %d: %s", srec.Code, srec.Body.String())
	}
	cut := dataOf(t, srec)["assetId"].(string)

	rec := applyOne(t, mux, session, cut, seal, map[string]any{
		"crossPage":   true,
		"binding":     "right",
		"startOffset": 12.5,
		"pages":       "all",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("cross-page apply = %d, want 201: %s", rec.Code, rec.Body.String())
	}
	if n := len(splitDims(t, rec)); n != 6 {
		t.Errorf("cross-page apply changed the page count to %d, want 6 strips", n)
	}
	stamped := rawAsset(t, mux, session, dataOf(t, rec)["assetId"].(string))
	if !bytes.Contains(stamped, []byte("/SMask")) {
		t.Error("a cross-page seal of a transparent PNG lost its /SMask in the stamped file")
	}

	// Z5: the 平均|随机 panel hands the route an explicit slice list; the route
	// accepts a legal one (length = page list, total <= the seal width) and the
	// stamped file stays valid.
	rec = applyOne(t, mux, session, cut, seal, map[string]any{
		"crossPage":   true,
		"binding":     "right",
		"startOffset": 0,
		"pages":       "all",
		"slices":      []float64{0.4, 0, 0.3, 0, 0.05, 0.25},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("uneven-slice apply = %d, want 201: %s", rec.Code, rec.Body.String())
	}
}

// stampedSealImage applies one instance and reads the stamp bitmap back out of
// the new asset: pdfcpu writes one image XObject per stamp (the /SMask folds
// into the extracted file), so what ExtractImagesFile hands back is the pixels
// the page carries — the disk-side mirror of tools/verify/apply-sm.mjs, which
// probes the same file through pdf.js.
func stampedSealImage(t *testing.T, mux http.Handler, session, asset, seal string, extra map[string]any, page string) image.Image {
	t.Helper()
	fields := map[string]any{"pages": page}
	for k, v := range extra {
		fields[k] = v
	}
	rec := applyOne(t, mux, session, asset, seal, fields)
	if rec.Code != http.StatusCreated {
		t.Fatalf("apply = %d, want 201: %s", rec.Code, rec.Body.String())
	}
	raw := rawAsset(t, mux, session, dataOf(t, rec)["assetId"].(string))
	in := filepath.Join(t.TempDir(), "stamped.pdf")
	if err := os.WriteFile(in, raw, 0o644); err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(t.TempDir(), "imgs")
	if err := os.MkdirAll(out, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := pdfapi.ExtractImagesFile(context.Background(), in, out, []string{page}, nil); err != nil {
		t.Fatalf("reading the stamped seal back: %v", err)
	}
	fs, err := os.ReadDir(out)
	if err != nil {
		t.Fatal(err)
	}
	if len(fs) != 1 {
		t.Fatalf("page %s carries %d stamped images, want exactly one", page, len(fs))
	}
	b, err := os.ReadFile(filepath.Join(out, fs[0].Name()))
	if err != nil {
		t.Fatal(err)
	}
	img, _, err := image.Decode(bytes.NewReader(b))
	if err != nil {
		t.Fatalf("the extracted stamp (%s) is not a decodable bitmap: %v", fs[0].Name(), err)
	}
	return img
}

// nrgbaAt samples one pixel as straight alpha: the bake contract speaks in
// un-premultiplied channels, so whatever format the decoder picked goes through
// draw.Src into an NRGBA cell.
func nrgbaAt(img image.Image, x, y int) color.NRGBA {
	cell := image.NewNRGBA(image.Rect(0, 0, 1, 1))
	draw.Draw(cell, cell.Bounds(), img, image.Pt(x, y), draw.Src)
	return cell.NRGBAAt(0, 0)
}

// bakePixel mirrors the UI8-CS2 contract formula for one colour sample:
// brightness, then the pow curve (plus the density alpha lift), then the CSS
// saturate matrix, each step clamped before the next reads it. It is
// deliberately a copy of the contract rather than a call into pdfcore, so the
// route test compares the stamped file with the agreement both sides promise
// (±1 tolerance for pdfcpu's re-encode).
func bakePixel(c color.NRGBA, bright, sat, ink float64) color.NRGBA {
	step := func(v uint8) float64 {
		f := bakeClamp(float64(v) * bright)
		return bakeClamp(255 * math.Pow(f/255, ink))
	}
	r, g, b := step(c.R), step(c.G), step(c.B)
	a := c.A
	if ink != 1 {
		a = uint8(math.Round(bakeClamp(255 * math.Pow(float64(c.A)/255, 1/ink))))
	}
	return color.NRGBA{
		R: uint8(math.Round(bakeClamp((0.213+0.787*sat)*r + (0.715-0.715*sat)*g + (0.072-0.072*sat)*b))),
		G: uint8(math.Round(bakeClamp((0.213-0.213*sat)*r + (0.715+0.285*sat)*g + (0.072-0.072*sat)*b))),
		B: uint8(math.Round(bakeClamp((0.213-0.213*sat)*r + (0.715-0.715*sat)*g + (0.072+0.928*sat)*b))),
		A: a,
	}
}

func bakeClamp(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 255 {
		return 255
	}
	return v
}

func chanDelta(a, b uint8) int {
	if int(a) > int(b) {
		return int(a) - int(b)
	}
	return int(b) - int(a)
}

// UI5-B2: the sliders bake into the bitmap, so the stamped file carries the
// adjusted colours and the same pixel grid. Absent sliders are the identity,
// which is why the plain run is the reference.
func TestApplyRouteBakesColourSlidersIntoTheStamp(t *testing.T) {
	mux, _, _ := newTestMux(t)
	session := newSession(t)
	src := openUploadedPDF(t, mux, session, threePageA4(t))
	seal := preparedSeal(t, mux, session)

	plain := stampedSealImage(t, mux, session, src, seal, nil, "1")
	box := plain.Bounds()
	mid := image.Pt(box.Dx()/2, box.Dy()/2)
	ref := nrgbaAt(plain, mid.X, mid.Y)
	if ref.A == 0 {
		t.Fatalf("the reference pixel is fully transparent: the fixture seal lost its ink")
	}

	for _, tc := range []struct {
		name             string
		bright, sat, ink float64
		extra            map[string]any
	}{
		{"density alone darkens along the pow curve", 1, 1, 3, map[string]any{"ink": 3.0}},
		{"saturate 0 greys the seal out", 1, 0, 1, map[string]any{"saturate": 0.0}},
		{"saturate up to the new ceiling 5", 1, 5, 1, map[string]any{"saturate": 5.0}},
		{"the chain bright -> pow -> sat", 1.5, 0.5, 3, map[string]any{"brightness": 1.5, "saturate": 0.5, "ink": 3.0}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			baked := stampedSealImage(t, mux, session, src, seal, tc.extra, "1")
			if b := baked.Bounds(); b.Dx() != box.Dx() || b.Dy() != box.Dy() {
				t.Fatalf("the bake resized the bitmap to %dx%d, want the unadjusted %dx%d",
					b.Dx(), b.Dy(), box.Dx(), box.Dy())
			}
			got := nrgbaAt(baked, mid.X, mid.Y)
			if got == ref {
				t.Errorf("the bake left the stamped pixel at %+v: the sliders never reached the bitmap", ref)
			}
			want := bakePixel(ref, tc.bright, tc.sat, tc.ink)
			if chanDelta(got.R, want.R) > 1 || chanDelta(got.G, want.G) > 1 || chanDelta(got.B, want.B) > 1 {
				t.Errorf("stamped pixel = %+v, want %+v (±1) — the file does not carry the contract bake", got, want)
			}
		})
	}
}

// The cross-page path bakes the whole seal before RotatePNG/Strips slice it, so
// every slot page carries a column of the *adjusted* bitmap (AGENTS §5.42: 先
// 调色 → 再旋转 → 再切). The strip read back off page 1 has to match the same
// contract formula the plain case pins down.
func TestApplyRouteBakesBeforeCrossPageStrips(t *testing.T) {
	mux, _, _ := newTestMux(t)
	session := newSession(t)
	src := openUploadedPDF(t, mux, session, threePageA4(t))
	seal := preparedSeal(t, mux, session)
	srec := splitJSON(t, mux, map[string]any{"assetId": src, "splitMode": "rows-cols", "rows": 2, "cols": 1}, session)
	if srec.Code != http.StatusCreated {
		t.Fatalf("split = %d: %s", srec.Code, srec.Body.String())
	}
	cut := dataOf(t, srec)["assetId"].(string)

	cross := map[string]any{"crossPage": true, "binding": "right", "startOffset": 30, "pages": "all"}
	plain := stampedSealImage(t, mux, session, cut, seal, cross, "1")
	ref := nrgbaAt(plain, 0, 0)
	if ref.A == 0 {
		t.Fatalf("the strip reference pixel is fully transparent: the fixture seal lost its ink")
	}
	baked := stampedSealImage(t, mux, session, cut, seal, map[string]any{
		"crossPage":   true,
		"binding":     "right",
		"startOffset": 30,
		"pages":       "all",
		"brightness":  1.5,
		"saturate":    0.5,
		"ink":         3.0,
	}, "1")
	if b := baked.Bounds(); b.Dx() != plain.Bounds().Dx() || b.Dy() != plain.Bounds().Dy() {
		t.Fatalf("the bake resized the strip to %dx%d, want the unadjusted %dx%d",
			b.Dx(), b.Dy(), plain.Bounds().Dx(), plain.Bounds().Dy())
	}
	got := nrgbaAt(baked, 0, 0)
	want := bakePixel(ref, 1.5, 0.5, 3)
	if chanDelta(got.R, want.R) > 1 || chanDelta(got.G, want.G) > 1 || chanDelta(got.B, want.B) > 1 {
		t.Errorf("strip pixel = %+v, want %+v (±1): the bake stopped before the strip chain", got, want)
	}
}
