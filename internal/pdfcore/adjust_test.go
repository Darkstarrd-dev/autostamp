package pdfcore

// B2/CS2 goldens (UI8 契约 调色公式). The numbers are worked out by hand from the
// contract steps, so the Go bake and app-overlay.js adjustedBitmap cannot drift
// apart. The fixture colour is (200,40,40), CS2 order = bright → pow(ink) +
// alpha lift → sat:
//
//	ink 3:      r = 255*(200/255)^3 = 123.03 -> 123, g/b = 255*(40/255)^3 = 0.984 -> 1
//	ink 3 alpha lift: 255*(137/255)^(1/3) = 207.35 -> 207
//	bright 1.5: 200*1.5 = 300 -> clamp 255; 40*1.5 = 60
//	sat 0:      0.213*200 + 0.715*40 + 0.072*40 = 74.08 -> 74 for all three channels
//	sat 5:      4.148*200 - 2.86*40 - 0.288*40 = 703.7 -> clamp 255, green/b -> 0
//	sat 2:      1.787*200 - 0.43*40 - 0.072*40 = 337.4 -> clamp 255, g/b = 6
//	the chain (bright 1.5 -> ink 3 -> sat 0.5, per-step clamp):
//	          bright -> (300, 60, 60) -> clamp -> (255, 60, 60)
//	          pow    -> 255*(255/255)^3 = 255; 255*(60/255)^3 = 3.32
//	          sat    -> 0.6065*255 + 0.3575*3.32 + 0.036*3.32 = 155.9 -> 156, g/b:
//	                     0.1065*255 + 0.8575*3.32 + 0.036*3.32 = 30.1 -> 30
//	ink 1.5:    255*(200/255)^1.5 = 176.9 -> 177, 255*(40/255)^1.5 = 16.0 -> 16
//	ink 10:     255*(200/255)^10 = 22.0 -> 22, 40 -> 0
//	ink 1 / sat 1 / bright 0: everything to 0

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"math"
	"testing"
)

// bakeSource is the 2x2 fixture every golden runs on: the same (200,40,40)
// colour on an opaque pixel and on a half-alpha one, so the alpha channel is
// checked next to the colour maths.
func bakeSource(t *testing.T) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	img.SetNRGBA(0, 0, color.NRGBA{R: 200, G: 40, B: 40, A: 255})
	img.SetNRGBA(1, 1, color.NRGBA{R: 200, G: 40, B: 40, A: 137})
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// decodeBaked fails the test unless the bake answered a PNG, and hands back the
// straight-alpha view the assertions speak in.
func decodeBaked(t *testing.T, data []byte) *image.NRGBA {
	t.Helper()
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("the bake did not answer a PNG: %v", err)
	}
	return toNRGBA(img)
}

func mustBake(t *testing.T, data []byte, bright, sat, ink float64) []byte {
	t.Helper()
	out, err := AdjustPNG(data, bright, sat, ink)
	if err != nil {
		t.Fatalf("AdjustPNG(%g,%g,%g): %v", bright, sat, ink, err)
	}
	return out
}

// TestAdjustPNGGoldens pins one slider at a time plus the chained run, with the
// per-step clamps the contract fixes (bright clamps before saturate reads it).
func TestAdjustPNGGoldens(t *testing.T) {
	src := bakeSource(t)
	for _, tc := range []struct {
		name                string
		bright, sat, ink    float64
		wantR, wantG, wantB int
	}{
		{"ink 3 darkens along the pow curve", 1, 1, 3, 123, 1, 1},
		{"ink 1.5 mid-curve", 1, 1, 1.5, 177, 16, 16},
		{"ink 10 keeps the darkest end readable", 1, 1, 10, 22, 0, 0},
		{"brightness 1.5 clamps the red channel at 255", 1.5, 1, 1, 255, 60, 60},
		{"brightness 0 answers black", 0, 1, 1, 0, 0, 0},
		{"saturate 0 collapses to the luminance grey", 1, 0, 1, 74, 74, 74},
		{"saturate 5 pushes red out of the gamut", 1, 5, 1, 255, 0, 0},
		{"saturate 2 clamps the red channel only", 1, 2, 1, 255, 6, 6},
		{"the chain bright -> pow -> sat", 1.5, 0.5, 3, 156, 30, 30},
	} {
		t.Run(tc.name, func(t *testing.T) {
			out := decodeBaked(t, mustBake(t, src, tc.bright, tc.sat, tc.ink))
			for _, x := range []int{0, 1} {
				c := out.NRGBAAt(x, x)
				if int(c.R) != tc.wantR || int(c.G) != tc.wantG || int(c.B) != tc.wantB {
					t.Errorf("pixel (%d,%d) = (%d,%d,%d), want (%d,%d,%d)",
						x, x, c.R, c.G, c.B, tc.wantR, tc.wantG, tc.wantB)
				}
			}
		})
	}
}

// TestAdjustPNGIdentityKeepsBytes: all three sliders at 1 answer the input
// bytes - no decode, no re-encode - so a stamp nobody adjusted carries exactly
// the prepared bitmap (the seam assertions and the pre-B2 byte comparison both
// rely on that).
func TestAdjustPNGIdentityKeepsBytes(t *testing.T) {
	src := bakeSource(t)
	out, err := AdjustPNG(src, 1, 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out, src) {
		t.Errorf("identity bake changed the bytes (%d -> %d)", len(src), len(out))
	}
}

// TestAdjustPNGAlphaLift: the density slider lifts semi-transparent coverage
// with the inverse pow curve (a′ = 255·(a/255)^(1/g)), so a pale scan
// actually puts more ink on the page; brightness/saturate never touch alpha,
// and the colour under the half-alpha matte still darks with the pow curve.
func TestAdjustPNGAlphaLift(t *testing.T) {
	src := bakeSource(t)
	before := decodeBaked(t, src)

	// brightness / saturate alone: alpha byte-for-byte unchanged.
	for _, tc := range []struct {
		name             string
		bright, sat, ink float64
	}{
		{"bright 1.5 keeps alpha", 1.5, 1, 1},
		{"sat 2 keeps alpha", 1, 2, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			after := decodeBaked(t, mustBake(t, src, tc.bright, tc.sat, tc.ink))
			for _, x := range []int{0, 1} {
			a, b := before.NRGBAAt(x, x).A, after.NRGBAAt(x, x).A
			if a != b {
				t.Errorf("pixel (%d,%d) alpha = %d, want the unchanged %d", x, x, b, a)
			}
			}
		})
	}

	after := decodeBaked(t, mustBake(t, src, 1, 1, 3))
	if c := after.NRGBAAt(1, 1); c.A != 207 || c.R != 123 || c.G != 1 || c.B != 1 {
		t.Errorf("pixel (1,1) = %+v, want density (123,1,1) a207 (255*(137/255)^(1/3))", c)
	}
	if c := after.NRGBAAt(0, 0); c.A != 255 {
		t.Errorf("opaque pixel alpha = %d, want 255 (the lift keeps opacity at 1)", c.A)
	}
	// ink 10 lands the lift near the ceiling on this matte.
	if c := decodeBaked(t, mustBake(t, src, 1, 1, 10)).NRGBAAt(1, 1); c.A != 240 {
		t.Errorf("ink 10 alpha = %d, want 240", c.A)
	}
}

// TestAdjustPNGRejectsRanges: out-of-range sliders are an error, never a silent
// clamp - the route owns the 400, and pdfcore never stamps an appearance nobody
// asked for.
func TestAdjustPNGRejectsRanges(t *testing.T) {
	src := bakeSource(t)
	for _, tc := range []struct {
		name             string
		bright, sat, ink float64
	}{
		{"brightness above 2", 2.01, 1, 1},
		{"brightness below 0", -0.5, 1, 1},
		{"saturate above the new ceiling 5", 1, 5.5, 1},
		{"saturate below 0", 1, -1, 1},
		{"ink below 1", 1, 1, 0.5},
		{"ink above 10", 1, 1, 11},
		{"a NaN brightness never survives", math.NaN(), 1, 1},
		{"a NaN ink never survives", 1, 1, math.NaN()},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := AdjustPNG(src, tc.bright, tc.sat, tc.ink); err == nil {
				t.Errorf("AdjustPNG(%g,%g,%g) answered no error, want the range rejection",
					tc.bright, tc.sat, tc.ink)
			}
		})
	}
	if _, err := AdjustPNG([]byte("not an image"), 1, 1, 2); err == nil {
		t.Error("a bitmap neither png nor jpeg decodes must error")
	}
}

// TestAdjustPNGAcceptsJPEG: a JPEG seal scan is accepted too, and the answer is
// still a PNG carrying the same pixel grid.
func TestAdjustPNGAcceptsJPEG(t *testing.T) {
	src := image.NewNRGBA(image.Rect(0, 0, 3, 2))
	for y := range 2 {
		for x := range 3 {
			src.SetNRGBA(x, y, color.NRGBA{R: 200, G: 40, B: 40, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, src, &jpeg.Options{Quality: 100}); err != nil {
		t.Fatal(err)
	}
	out := decodeBaked(t, mustBake(t, buf.Bytes(), 1, 1, 3))
	if w, h := out.Bounds().Dx(), out.Bounds().Dy(); w != 3 || h != 2 {
		t.Errorf("dims = %dx%d, want the source's 3x2", w, h)
	}
	// Quality 100 JPEG is still lossy, so the golden lands within 2.
	c := out.NRGBAAt(0, 0)
	if diff(c.R, 123) > 2 || diff(c.G, 1) > 2 || diff(c.B, 1) > 2 {
		t.Errorf("jpeg bake = %+v, want (123,1,1) within 2 per channel", c)
	}
	if c.A != 255 {
		t.Errorf("jpeg alpha = %d, want 255 (a JPEG carries no alpha, so it stays opaque)", c.A)
	}
}

func diff(v, want uint8) uint8 {
	if v > want {
		return v - want
	}
	return want - v
}

// TestBakeParamsZeroGroup: brightness 0 and saturate 0 are legal slider values,
// so a hand-built StampInstance that never touched the bake group can only be
// recognised through the whole triple — that case answers the identity, while a
// partial group keeps what the caller asked for (and ink 0, outside the slider
// vocabulary, falls back to 1).
func TestBakeParamsZeroGroup(t *testing.T) {
	for _, tc := range []struct {
		name                string
		in                  StampInstance
		wantB, wantS, wantI float64
	}{
		{"the untouched triple answers the identity", StampInstance{}, 1, 1, 1},
		{"a full group is taken as asked", StampInstance{Brightness: 2, Saturate: 5, Ink: 10}, 2, 5, 10},
		{"black plus grey plus density stays black", StampInstance{Brightness: 0, Saturate: 0, Ink: 3}, 0, 0, 3},
		{"an unset ink falls back to 1", StampInstance{Brightness: 1.4, Saturate: 2}, 1.4, 2, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			b, s, i := bakeParams(tc.in)
			if b != tc.wantB || s != tc.wantS || i != tc.wantI {
				t.Errorf("bakeParams(%+v) = (%g,%g,%g), want (%g,%g,%g)",
					tc.in, b, s, i, tc.wantB, tc.wantS, tc.wantI)
			}
		})
	}
}
