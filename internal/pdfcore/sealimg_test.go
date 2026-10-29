package pdfcore

import (
	"bytes"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

// stampPNG encodes img and, when dpi > 0, injects a pHYs chunk after IHDR. The
// Go encoder never writes pHYs, so a scanned stamp has to be built by hand —
// otherwise the resample tests would never see a declared DPI.
func stampPNG(t *testing.T, img image.Image, dpi int) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	out := b.Bytes()
	if dpi <= 0 {
		return out
	}
	dpm := uint32(float64(dpi) / 0.0254)

	// Build the chunk properly: length + type + payload + CRC over type+payload.
	var body [9]byte
	binary.BigEndian.PutUint32(body[0:4], dpm)
	binary.BigEndian.PutUint32(body[4:8], dpm)
	body[8] = 1
	chunkType := []byte("pHYs")
	crc := crc32.ChecksumIEEE(append(chunkType, body[:]...))
	var lenBuf, crcBuf [4]byte
	binary.BigEndian.PutUint32(lenBuf[:], 9)
	binary.BigEndian.PutUint32(crcBuf[:], crc)
	chunk := append(lenBuf[:], chunkType...)
	chunk = append(chunk, body[:]...)
	chunk = append(chunk, crcBuf[:]...)

	const sig = 8
	ihdr := sig + 12 + int(binary.BigEndian.Uint32(out[sig:sig+4]))
	full := append([]byte{}, out[:ihdr]...)
	full = append(full, chunk...)
	return append(full, out[ihdr:]...)
}

// flat returns a w×h NRGBA filled with c.
func flat(w, h int, c color.NRGBA) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetNRGBA(x, y, c)
		}
	}
	return img
}

func fill(img *image.NRGBA, r image.Rectangle, c color.NRGBA) {
	for y := r.Min.Y; y < r.Max.Y; y++ {
		for x := r.Min.X; x < r.Max.X; x++ {
			img.SetNRGBA(x, y, c)
		}
	}
}

func decodePrepared(t *testing.T, pngBytes []byte) image.Image {
	t.Helper()
	img, err := png.Decode(bytes.NewReader(pngBytes))
	if err != nil {
		t.Fatalf("prepared bytes are not a decodable PNG: %v", err)
	}
	// The encoder may drop the alpha channel when the prepared stamp is fully
	// opaque, so the decoded type is not fixed here.
	if img.Bounds().Dx() == 0 || img.Bounds().Dy() == 0 {
		t.Fatalf("prepared PNG bounds = %v, want non-empty", img.Bounds())
	}
	return img
}

// px reads a pixel as straight-alpha NRGBA, which is what the PNG spec stores.
func px(img image.Image, x, y int) color.NRGBA {
	return color.NRGBAModel.Convert(img.At(x, y)).(color.NRGBA)
}

func TestPrepareSealDespillsWhiteBackground(t *testing.T) {
	img := flat(10, 10, color.NRGBA{R: 255, G: 255, B: 255, A: 255})
	fill(img, image.Rect(3, 3, 7, 7), color.NRGBA{R: 200, G: 20, B: 30, A: 255})

	data, meta, err := PrepareSeal(bytes.NewReader(stampPNG(t, img, 0)), SealOptions{Despill: true})
	if err != nil {
		t.Fatalf("PrepareSeal: %v", err)
	}
	if meta.SrcWidth != 10 || meta.SrcHeight != 10 {
		t.Errorf("src dims = %d×%d, want 10×10", meta.SrcWidth, meta.SrcHeight)
	}
	// 4×4 ink out of 100 px, percent×100.
	if meta.OpaqueRatio != 1600 {
		t.Errorf("opaqueRatio = %d, want 1600 (16 px of 100)", meta.OpaqueRatio)
	}
	if !meta.Despilled {
		t.Error("Despilled = false, want true so the UI can show what was applied")
	}
	out := decodePrepared(t, data)
	if a := px(out, 0, 0).A; a != 0 {
		t.Errorf("white corner alpha = %d, want 0 (the white matte must go)", a)
	}
	ink := px(out, 4, 4)
	if ink.A == 0 {
		t.Fatal("ink pixel became transparent")
	}
	if ink.R < 150 {
		t.Errorf("ink red = %d, want the red kept (despill must not grey the stamp)", ink.R)
	}
	if ink.G > 60 || ink.B > 80 {
		t.Errorf("ink = %+v, want a saturated red after un-matting", ink)
	}
}

func TestPrepareSealAlphaTrim(t *testing.T) {
	img := flat(40, 30, color.NRGBA{A: 0})
	fill(img, image.Rect(5, 5, 15, 12), color.NRGBA{R: 9, G: 180, B: 90, A: 255})

	data, meta, err := PrepareSeal(bytes.NewReader(stampPNG(t, img, 0)), SealOptions{AlphaTrim: true})
	if err != nil {
		t.Fatalf("PrepareSeal: %v", err)
	}
	if meta.Width != 10 || meta.Height != 7 {
		t.Errorf("trimmed dims = %d×%d, want 10×7", meta.Width, meta.Height)
	}
	if want := (SealBox{X: 5, Y: 5, W: 10, H: 7}); meta.AlphaBBox != want {
		t.Errorf("alpha bbox = %+v, want %+v (source pixel coords)", meta.AlphaBBox, want)
	}
	if !meta.AlphaTrimmed {
		t.Error("AlphaTrimed = false, want true")
	}
	out := decodePrepared(t, data)
	if out.Bounds().Dx() != 10 || out.Bounds().Dy() != 7 {
		t.Errorf("encoded image bounds = %v, want 10×7", out.Bounds())
	}

	// Without the trim the padding stays, which is what a client that turned
	// the control off must get back.
	_, meta2, err := PrepareSeal(bytes.NewReader(stampPNG(t, img, 0)), SealOptions{})
	if err != nil {
		t.Fatalf("PrepareSeal (no trim): %v", err)
	}
	if meta2.Width != 40 || meta2.Height != 30 {
		t.Errorf("untrimmed dims = %d×%d, want 40×30", meta2.Width, meta2.Height)
	}
	if meta2.AlphaTrimmed {
		t.Error("AlphaTrimed = true with the control off")
	}
}

func TestPrepareSealResamplesDeclaredDPI(t *testing.T) {
	img := flat(300, 300, color.NRGBA{R: 200, G: 40, B: 40, A: 255})
	// A 300×300 scan declared as 300 DPI, resampled to 150 DPI, must halve.
	data, meta, err := PrepareSeal(bytes.NewReader(stampPNG(t, img, 300)), SealOptions{TargetDPI: 150})
	if err != nil {
		t.Fatalf("PrepareSeal: %v", err)
	}
	if meta.SourceDPI != 300 {
		t.Errorf("sourceDpi = %d, want 300 (the pHYs chunk said so)", meta.SourceDPI)
	}
	if meta.Width != 150 || meta.Height != 150 {
		t.Errorf("dims = %d×%d, want 150×150", meta.Width, meta.Height)
	}
	if meta.DPI != 150 {
		t.Errorf("dpi = %d, want 150", meta.DPI)
	}
	if out := decodePrepared(t, data); out.Bounds().Dx() != 150 {
		t.Errorf("encoded width = %d, want 150", out.Bounds().Dx())
	}
}

func TestPrepareSealMaxSideCapWithoutDPI(t *testing.T) {
	img := flat(1000, 800, color.NRGBA{R: 10, G: 200, B: 30, A: 255})
	_, meta, err := PrepareSeal(bytes.NewReader(stampPNG(t, img, 0)), SealOptions{MaxSide: 400})
	if err != nil {
		t.Fatalf("PrepareSeal: %v", err)
	}
	if meta.Width != 400 || meta.Height != 320 {
		t.Errorf("dims = %d×%d, want 400×320 (cap keeps aspect)", meta.Width, meta.Height)
	}
	if meta.SourceDPI != 0 {
		t.Errorf("sourceDpi = %d, want 0 (file has no pHYs)", meta.SourceDPI)
	}
	if meta.DPI != 0 {
		t.Errorf("dpi = %d, want 0 when the source DPI is unknown", meta.DPI)
	}
	if meta.Aspect < 1.24 || meta.Aspect > 1.26 {
		t.Errorf("aspect = %v, want 1.25", meta.Aspect)
	}
}

func TestPrepareSealRejects(t *testing.T) {
	empty := flat(8, 8, color.NRGBA{A: 0})
	if _, _, err := PrepareSeal(bytes.NewReader(stampPNG(t, empty, 0)), SealOptions{}); !errors.Is(err, ErrSealEmpty) {
		t.Errorf("fully transparent seal: err = %v, want ErrSealEmpty", err)
	}
	if _, _, err := PrepareSeal(bytes.NewReader([]byte("not an image at all")), SealOptions{}); !errors.Is(err, ErrSealUnsupported) {
		t.Errorf("garbage input: err = %v, want ErrSealUnsupported", err)
	}
	if _, _, err := PrepareSeal(bytes.NewReader(nil), SealOptions{}); !errors.Is(err, ErrSealUnsupported) {
		t.Errorf("empty input: err = %v, want ErrSealUnsupported", err)
	}

	// Pixel cap: the same tiny image past the configured pixel budget. A test
	// that lowered the budget instead of building a 64 MP scan is the only
	// cheap way to hit that branch.
	img := flat(50, 50, color.NRGBA{R: 5, G: 5, B: 200, A: 255})
	old := sealPixelLimit
	sealPixelLimit = 100
	defer func() { sealPixelLimit = old }()
	if _, _, err := PrepareSeal(bytes.NewReader(stampPNG(t, img, 0)), SealOptions{}); !errors.Is(err, ErrSealTooLarge) {
		t.Errorf("over-cap seal: err = %v, want ErrSealTooLarge", err)
	}
}

func TestPrepareSealAcceptsJPEG(t *testing.T) {
	img := flat(60, 40, color.NRGBA{R: 210, G: 30, B: 30, A: 255})
	var b bytes.Buffer
	if err := jpeg.Encode(&b, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatalf("encode jpeg: %v", err)
	}
	data, meta, err := PrepareSeal(bytes.NewReader(b.Bytes()), SealOptions{})
	if err != nil {
		t.Fatalf("PrepareSeal(jpeg): %v", err)
	}
	if meta.Width != 60 || meta.Height != 40 {
		t.Errorf("jpeg dims = %d×%d, want 60×40", meta.Width, meta.Height)
	}
	if meta.SourceDPI != 0 {
		t.Errorf("jpeg sourceDpi = %d, want 0 (EXIF density is not the stamp size)", meta.SourceDPI)
	}
	if out := decodePrepared(t, data); out.Bounds().Dx() != 60 {
		t.Errorf("re-encoded width = %d, want 60", out.Bounds().Dx())
	}
}
