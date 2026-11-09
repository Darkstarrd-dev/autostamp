package pdfcore

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

// twoToneSeal builds a 48x24 seal whose LEFT half is L and RIGHT half is R
// (both fully opaque). Z4 (2026-11-09): the cross-page strip order is
// rotate-whole-then-slice, so a colour test can pin the exact pixel mapping
// of RotatePNG and of the strip slices over the rotated bitmap.
func twoToneSeal(t *testing.T) []byte {
	t.Helper()
	const (
		w, h = 48, 24
	)
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			c := color.NRGBA{R: 210, G: 40, B: 90, A: 255} // right half
			if x < w/2 {
				c = color.NRGBA{R: 24, G: 190, B: 70, A: 255} // left half
			}
			img.Set(x, y, c)
		}
	}
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func decodePNG(t *testing.T, b []byte) image.Image {
	t.Helper()
	img, err := png.Decode(bytes.NewReader(b))
	if err != nil {
		t.Fatalf("PNG 解码失败: %v", err)
	}
	return img
}

func sealPx(t *testing.T, img image.Image, x, y int) color.NRGBA {
	t.Helper()
	r, g, bl, a := img.At(x, y).RGBA()
	return color.NRGBA{R: uint8(r >> 8), G: uint8(g >> 8), B: uint8(bl >> 8), A: uint8(a >> 8)}
}

var (
	testL = color.NRGBA{R: 24, G: 190, B: 70, A: 255}
	testR = color.NRGBA{R: 210, G: 40, B: 90, A: 255}
)

func TestRotatePNGClockwise90GrowsCanvas(t *testing.T) {
	src := twoToneSeal(t)
	out, err := RotatePNG(src, 90)
	if err != nil {
		t.Fatal(err)
	}
	img := decodePNG(t, out)
	b := img.Bounds()
	// The rotated bbox formula: w' = |h|, h' = |w| for an exact 90.
	if b.Dx() != 24 || b.Dy() != 48 {
		t.Fatalf("旋转后的画尺寸 = %dx%d, want 24x48", b.Dx(), b.Dy())
	}
	// Screen clockwise: the left half lands on TOP, the right half on the bottom.
	for x := range b.Dx() {
		for y := range b.Dy() {
			want := testR
			if y < b.Dy()/2 {
				want = testL
			}
			if got := sealPx(t, img, b.Min.X+x, b.Min.Y+y); got != want {
				t.Fatalf("(%d,%d) = %+v, want %+v (left half must land on top, y down display space, clockwise)", x, y, got, want)
			}
		}
	}
}

func TestRotatePNGCounter90MirrorDirection(t *testing.T) {
	src := twoToneSeal(t)
	out, err := RotatePNG(src, -90)
	if err != nil {
		t.Fatal(err)
	}
	img := decodePNG(t, out)
	b := img.Bounds()
	if b.Dx() != 24 || b.Dy() != 48 {
		t.Fatalf("旋转后的画尺寸 = %dx%d, want 24x48", b.Dx(), b.Dy())
	}
	// -90: the left half lands on the BOTTOM.
	for x := range b.Dx() {
		for y := range b.Dy() {
			want := testL
			if y < b.Dy()/2 {
				want = testR
			}
			if got := sealPx(t, img, b.Min.X+x, b.Min.Y+y); got != want {
				t.Fatalf("(%d,%d) = %+v, want %+v", x, y, got, want)
			}
		}
	}
}

func TestRotatePNG180FlipsHalves(t *testing.T) {
	src := twoToneSeal(t)
	out, err := RotatePNG(src, 180)
	if err != nil {
		t.Fatal(err)
	}
	img := decodePNG(t, out)
	b := img.Bounds()
	if b.Dx() != 48 || b.Dy() != 24 {
		t.Fatalf("旋转后的画尺寸 = %dx%d, want 48x24", b.Dx(), b.Dy())
	}
	// 180: the left half moves to the right half (the whole mark is turned).
	for x := range b.Dx() {
		for y := range b.Dy() {
			want := testR // left half now shows what the right half was
			if x >= b.Dx()/2 {
				want = testL // and vice versa: the whole mark is turned
			}
			if got := sealPx(t, img, b.Min.X+x, b.Min.Y+y); got != want {
				t.Fatalf("(%d,%d) = %+v, want %+v", x, y, got, want)
			}
		}
	}
}

func TestRotatePNGZeroIsIdentity(t *testing.T) {
	src := twoToneSeal(t)
	out, err := RotatePNG(src, 0)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out, src) {
		t.Fatal("deg 0 必须原样返回字节（恒等）")
	}
}

// TestRotatedStripsAreVerticalColumnsOfRotatedSeal pins the Z4 acceptance from
// the bitmap side: after baking the rotation, every slot is a full-height
// column of the *rotated* seal - top L, bottom R on every page - which is the
// whole point of "先旋转、再切、每页都是竖条". The old order (slice, then
// rotate each half in place) would leave page 1 entirely L and page 2
// entirely R, which this rejects.
func TestRotatedStripsAreVerticalColumnsOfRotatedSeal(t *testing.T) {
	rotated, err := RotatePNG(twoToneSeal(t), 90)
	if err != nil {
		t.Fatal(err)
	}
	strips, err := Strips(rotated, 2)
	if err != nil {
		t.Fatal(err)
	}
	for i, sb := range strips {
		img := decodePNG(t, sb)
		b := img.Bounds()
		if b.Dx() != 12 || b.Dy() != 48 {
			t.Fatalf("条带 %d 尺寸 = %dx%d, want 12x48", i, b.Dx(), b.Dy())
		}
		if got := sealPx(t, img, b.Min.X+6, b.Min.Y+4); got != testL {
			t.Fatalf("条带 %d 上部 = %+v, want %+v（旋转后的整章顶部）", i, got, testL)
		}
		if got := sealPx(t, img, b.Min.X+6, b.Min.Y+40); got != testR {
			t.Fatalf("条带 %d 下部 = %+v, want %+v（旋转后的整章底部）", i, got, testR)
		}
	}
}
