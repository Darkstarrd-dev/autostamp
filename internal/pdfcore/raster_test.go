package pdfcore

// P5 raster-writer contract tests. The writer is hand-rolled, so these parse
// the produced bytes — xref offsets, /Length, MediaBox numbers, DCT
// pass-through, Flate payloads — instead of trusting any library read-back.
// pdf.js's rendering judgement (AGENTS §5.4) stays with the front-end smoke
// scripts; TestRasterWriterPassesPdfcpuValidate pins the AGENTS §8 gate.

import (
	"bytes"
	"compress/zlib"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// gradientImg is a deterministic w×h RGB gradient.
func gradientImg(w, h int) image.Image {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			img.SetNRGBA(x, y, color.NRGBA{uint8(x % 256), uint8(y % 256), uint8((x + y) % 256), 255})
		}
	}
	return img
}

// translucentImg is a gradient with per-pixel alpha, so the /SMask branch is
// exercised end to end.
func translucentImg(w, h int) image.Image {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			img.SetNRGBA(x, y, color.NRGBA{uint8(x % 256), uint8(y % 256), uint8((x + y) % 256), uint8((x*3 + y*7) % 256)})
		}
	}
	return img
}

func encodeJPEG(t *testing.T, img image.Image, q int) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := jpeg.Encode(&b, img, &jpeg.Options{Quality: q}); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func encodeRasterPNG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// parsedRaster is a minimal read-back of the writer's output. It refuses to
// guess: every xref offset must land exactly on "N 0 obj" and every xref
// entry must be a well-formed 20-byte line.
type parsedRaster struct {
	raw       []byte
	size      int   // trailer /Size
	startxref int64 // byte offset the startxref keyword announces
	offs      []int64
}

func parseRasterPDF(t *testing.T, raw []byte) *parsedRaster {
	t.Helper()
	p := &parsedRaster{raw: raw}
	if !bytes.HasPrefix(raw, []byte("%PDF-1.7\n")) {
		t.Fatalf("output does not start with the PDF header: %q", raw[:min(16, len(raw))])
	}
	if !bytes.HasSuffix(raw, []byte("%%EOF\n")) {
		t.Fatalf("output does not end with %%EOF: %q", raw[max(0, len(raw)-8):])
	}
	i := bytes.LastIndex(raw, []byte("startxref\n"))
	if i < 0 {
		t.Fatal("no startxref")
	}
	rest := raw[i+len("startxref\n"):]
	line := rest[:bytes.IndexByte(rest, '\n')]
	v, err := strconv.ParseInt(string(line), 10, 64)
	if err != nil {
		t.Fatalf("startxref %q: %v", line, err)
	}
	p.startxref = v
	if int64(len(raw)) <= v || !bytes.HasPrefix(raw[v:], []byte("xref\n")) {
		t.Fatalf("startxref %d does not point at the xref table (found %q)", v, raw[min(int(v), len(raw)):min(int(v)+12, len(raw))])
	}
	sec := raw[v+int64(len("xref\n")):]
	j := bytes.IndexByte(sec, '\n')
	head := string(sec[:j])
	var first, count int
	if _, err := fmt.Sscanf(head, "%d %d", &first, &count); err != nil || first != 0 {
		t.Fatalf("xref subsection header %q: %v", head, err)
	}
	entries := sec[j+1:]
	if len(entries) < count*20 {
		t.Fatalf("xref claims %d entries but only %d bytes follow", count, len(entries))
	}
	p.size = count
	p.offs = make([]int64, count)
	for k := range count {
		e := entries[k*20 : k*20+20]
		if k == 0 {
			if string(e) != "0000000000 65535 f \n" {
				t.Fatalf("head entry = %q, want the free head", e)
			}
			continue
		}
		if e[10] != ' ' || e[16] != ' ' || e[17] != 'n' || e[18] != ' ' || e[19] != '\n' || string(e[11:16]) != "00000" {
			t.Fatalf("xref entry %d = %q is not a well-formed 20-byte line", k, e)
		}
		off, err := strconv.ParseInt(string(e[:10]), 10, 64)
		if err != nil {
			t.Fatalf("xref entry %d offset: %v", k, err)
		}
		p.offs[k] = off
		if !bytes.HasPrefix(raw[off:], []byte(fmt.Sprintf("%d 0 obj\n", k))) {
			t.Fatalf("xref says object %d lives at %d, found %q", k, off, raw[off:min(int(off)+16, len(raw))])
		}
	}
	trailerAt := j + 1 + count*20
	if !bytes.HasPrefix(sec[trailerAt:], []byte("trailer\n")) {
		t.Fatalf("xref entries are not followed by trailer at %d", trailerAt)
	}
	if !strings.Contains(string(sec[trailerAt:]), fmt.Sprintf("<< /Size %d /Root 1 0 R >>", count)) {
		t.Fatalf("trailer = %q, want /Size %d /Root 1 0 R", sec[trailerAt:], count)
	}
	return p
}

// objEnd is where object n's body ends: the next object's start (the writer
// numbers gaplessly), or the xref table for the last one.
func (p *parsedRaster) objEnd(n int) int64 {
	if n+1 < len(p.offs) {
		return p.offs[n+1]
	}
	return p.startxref
}

func (p *parsedRaster) dictOf(t *testing.T, n int) string {
	t.Helper()
	body := p.raw[p.offs[n]:p.objEnd(n)]
	marker := []byte(fmt.Sprintf("%d 0 obj\n", n))
	rest := body[len(marker):]
	if i := bytes.Index(rest, []byte("\nstream\n")); i >= 0 {
		return string(rest[:i])
	}
	if i := bytes.Index(rest, []byte("\nendobj\n")); i >= 0 {
		return string(rest[:i])
	}
	t.Fatalf("object %d has neither stream nor endobj", n)
	return ""
}

// streamOf cuts exactly /Length bytes after "stream\n" and asserts that
// "\nendstream" follows — the spec-correct read, and the reason an exact
// /Length matters (JPEG streams are arbitrary binary).
func (p *parsedRaster) streamOf(t *testing.T, n, length int) []byte {
	t.Helper()
	body := p.raw[p.offs[n]:p.objEnd(n)]
	marker := []byte(fmt.Sprintf("%d 0 obj\n", n))
	i := bytes.Index(body, marker) + len(marker)
	s := bytes.Index(body[i:], []byte("\nstream\n"))
	if s < 0 {
		t.Fatalf("object %d has no stream", n)
	}
	start := i + s + len("\nstream\n")
	if len(body) < start+length || !bytes.HasPrefix(body[start+length:], []byte("\nendstream\n")) {
		t.Fatalf("object %d stream is not followed by endstream at /Length %d", n, length)
	}
	return body[start : start+length]
}

func writeOne(t *testing.T, data []byte, dpi int) *parsedRaster {
	t.Helper()
	var buf bytes.Buffer
	if err := WriteRaster(&buf, []RasterPage{{Number: 1, Data: data}}, RasterOptions{Dpi: dpi}); err != nil {
		t.Fatal(err)
	}
	return parseRasterPDF(t, buf.Bytes())
}

func imageObject(t *testing.T, p *parsedRaster, filter string) (num int, dict string) {
	t.Helper()
	for n := 1; n < p.size; n++ {
		d := p.dictOf(t, n)
		if strings.Contains(d, "/Subtype /Image") && strings.Contains(d, "/Filter "+filter) {
			return n, d
		}
	}
	t.Fatalf("no image object with %s in the output", filter)
	return 0, ""
}

var (
	reLength = regexp.MustCompile(`/Length (\d+)`)
	reSMask  = regexp.MustCompile(`/SMask (\d+) 0 R`)
)

func lengthOf(t *testing.T, dict string) int {
	t.Helper()
	m := reLength.FindStringSubmatch(dict)
	if m == nil {
		t.Fatalf("dict has no /Length: %s", dict)
	}
	n, err := strconv.Atoi(m[1])
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func inflate(t *testing.T, data []byte) []byte {
	t.Helper()
	zr, err := zlib.NewReader(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("zlib: %v", err)
	}
	out, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("inflate: %v", err)
	}
	return out
}

// TestRasterWriterByteStructure parses the written PDF bytes: xref offsets
// point at the right objects, /Length matches the real byte count, the
// trailer is exact, the DCT stream equals the input JPEG byte for byte, and
// the MediaBox carries px*72/dpi with exactly two decimals.
func TestRasterWriterByteStructure(t *testing.T) {
	const pxW, pxH, dpi = 320, 240, 150
	jpg := encodeJPEG(t, gradientImg(pxW, pxH), 75)

	var buf bytes.Buffer
	if err := WriteRaster(&buf, []RasterPage{{Number: 1, Data: jpg}}, RasterOptions{Dpi: dpi}); err != nil {
		t.Fatal(err)
	}
	p := parseRasterPDF(t, buf.Bytes())

	// free head + catalog + tree + page + content + image
	if p.size != 6 {
		t.Fatalf("/Size = %d, want 6", p.size)
	}
	if got := p.dictOf(t, 1); got != "<< /Type /Catalog /Pages 2 0 R >>" {
		t.Errorf("catalog dict = %q", got)
	}
	if got := p.dictOf(t, 2); got != "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" {
		t.Errorf("page tree dict = %q", got)
	}

	// MediaBox: px*72/dpi as two decimals (153.60 x 115.20 for this page).
	wantW := fmt.Sprintf("%.2f", float64(pxW)*72/dpi)
	wantH := fmt.Sprintf("%.2f", float64(pxH)*72/dpi)
	pageDict := p.dictOf(t, 3)
	if !strings.Contains(pageDict, fmt.Sprintf("/MediaBox [0 0 %s %s]", wantW, wantH)) {
		t.Errorf("page dict = %q, want MediaBox [0 0 %s %s]", pageDict, wantW, wantH)
	}
	if strings.Contains(pageDict, "/Rotate") {
		t.Errorf("page dict declares a rotation; the bitmap is already display-oriented (AGENTS §5.17)")
	}
	content := fmt.Sprintf("q %s 0 0 %s 0 0 cm /Im0 Do Q", wantW, wantH)
	if got := p.streamOf(t, 4, len(content)); string(got) != content {
		t.Errorf("content stream = %q, want %q", got, content)
	}

	imgNum, imgDict := imageObject(t, p, "/DCTDecode")
	if imgNum != 5 {
		t.Errorf("image object number = %d, want 5", imgNum)
	}
	if lengthOf(t, imgDict) != len(jpg) {
		t.Errorf("image dict = %s, want /Length %d", imgDict, len(jpg))
	}
	// DCT pass-through: the stream must equal the input JPEG byte for byte.
	if data := p.streamOf(t, imgNum, len(jpg)); !bytes.Equal(data, jpg) {
		t.Errorf("DCT stream differs from the input JPEG (%d stream bytes vs %d input bytes)", len(data), len(jpg))
	}
}

// TestRasterWriterFlatePath covers the non-JPEG path: an opaque PNG must come
// out as /FlateDecode RGB scanlines (filter byte 0 per row, no /SMask), a
// translucent PNG additionally as a /DeviceGray /SMask plane.
func TestRasterWriterFlatePath(t *testing.T) {
	const w, h = 40, 30
	opaque := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			opaque.SetNRGBA(x, y, color.NRGBA{uint8(x * 6), uint8(y * 8), 77, 255})
		}
	}
	p := writeOne(t, encodeRasterPNG(t, opaque), 96)
	num, dict := imageObject(t, p, "/FlateDecode")
	if strings.Contains(dict, "/SMask") {
		t.Errorf("opaque PNG produced %s, want no /SMask", dict)
	}
	if !strings.Contains(dict, fmt.Sprintf("/Width %d /Height %d", w, h)) {
		t.Errorf("image dict = %s, want the pixel dims", dict)
	}
	raw := inflate(t, p.streamOf(t, num, lengthOf(t, dict)))
	if len(raw) != h*(1+w*3) {
		t.Fatalf("inflated RGB stream = %d bytes, want %d", len(raw), h*(1+w*3))
	}
	// Row layout: filter byte 0, then RGB per pixel. First pixel is (0,0,77).
	for y := range h {
		if raw[y*(1+w*3)] != 0 {
			t.Fatalf("row %d filter byte = %d, want 0", y, raw[y*(1+w*3)])
		}
	}
	if raw[1] != 0 || raw[2] != 0 || raw[3] != 77 {
		t.Errorf("first pixel = (%d,%d,%d), want (0,0,77)", raw[1], raw[2], raw[3])
	}

	// Translucent PNG: same RGB plane plus a gray /SMask.
	alpha := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			alpha.SetNRGBA(x, y, color.NRGBA{200, 30, 30, uint8((x*7 + y*11) % 256)})
		}
	}
	p2 := writeOne(t, encodeRasterPNG(t, alpha), 96)
	num2, dict2 := imageObject(t, p2, "/FlateDecode")
	m := reSMask.FindStringSubmatch(dict2)
	if m == nil {
		t.Fatalf("translucent PNG produced %s, want a /SMask reference", dict2)
	}
	sm, err := strconv.Atoi(m[1])
	if err != nil {
		t.Fatal(err)
	}
	if base := inflate(t, p2.streamOf(t, num2, lengthOf(t, dict2))); len(base) != h*(1+w*3) {
		t.Errorf("inflated base stream = %d bytes, want %d", len(base), h*(1+w*3))
	}
	mdict := p2.dictOf(t, sm)
	if !strings.Contains(mdict, "/ColorSpace /DeviceGray") || !strings.Contains(mdict, "/BitsPerComponent 8") {
		t.Errorf("smask dict = %s, want /DeviceGray 8-bit", mdict)
	}
	if mask := inflate(t, p2.streamOf(t, sm, lengthOf(t, mdict))); len(mask) != h*(1+w) {
		t.Errorf("inflated mask stream = %d bytes, want %d", len(mask), h*(1+w))
	}
}

// TestRasterWriterMatchesFacts4Magnitude pins the JPEG size magnitude against
// FACTS §4's 150dpi q75 row (123,796 B for A4). FACTS §4 那张探针的合成图与
// 本项目样本内容不同，所以只能钉量级（±40%），不能钉到 ±5% —— 不要假装能
// 精确复现那张表的字节数。
func TestRasterWriterMatchesFacts4Magnitude(t *testing.T) {
	const want = 123796
	jpg := encodeJPEG(t, factsProbeImage(1239, 1754), 75)

	var buf bytes.Buffer
	if err := WriteRaster(&buf, []RasterPage{{Number: 1, Data: jpg}}, RasterOptions{Dpi: 150}); err != nil {
		t.Fatal(err)
	}
	p := parseRasterPDF(t, buf.Bytes())
	_, dict := imageObject(t, p, "/DCTDecode")
	n := lengthOf(t, dict)
	if n != len(jpg) {
		t.Fatalf("/Length = %d, want the input JPEG's %d bytes", n, len(jpg))
	}
	if n < want*60/100 || n > want*140/100 {
		t.Errorf("150dpi q75 A4 image stream = %d B, FACTS §4 row is %d B (±40%%)", n, want)
	}
	t.Logf("150dpi q75 A4 probe image stream = %d B (FACTS §4 row: %d B)", n, want)
}

// factsProbeImage builds a deterministic A4-probe-like image: smooth
// gradients plus LCG noise, so its JPEG size sits in the same magnitude band
// as FACTS §4's synthetic probe without pretending to reproduce it.
func factsProbeImage(w, h int) image.Image {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	seed := uint32(1)
	for y := range h {
		for x := range w {
			seed = seed*1664525 + 1013904223
			img.SetNRGBA(x, y, color.NRGBA{
				uint8(200 - y*40/h + x*55/w),
				uint8(120 + x*100/w),
				uint8(90 + (seed>>24)%64),
				255,
			})
		}
	}
	return img
}

// TestRasterWriterPassesPdfcpuValidate pins the AGENTS §8 gate for the
// hand-written PDF: a two-page output (JPEG page + translucent PNG page) must
// go through pdfcore.Validate, i.e. pdfcpu's ValidateFile with DefaultLimits.
func TestRasterWriterPassesPdfcpuValidate(t *testing.T) {
	pages := []RasterPage{
		{Number: 1, Data: encodeJPEG(t, factsProbeImage(1239, 1754), 75)},
		{Number: 2, Data: encodeRasterPNG(t, gradientImg(620, 877))},
		{Number: 3, Data: encodeRasterPNG(t, translucentImg(620, 877))},
	}
	var buf bytes.Buffer
	if err := WriteRaster(&buf, pages, RasterOptions{Dpi: 150}); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "raster.pdf")
	if err := os.WriteFile(path, buf.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Validate(t.Context(), path); err != nil {
		t.Fatalf("pdfcpu rejects the hand-written raster PDF: %v", err)
	}
}
