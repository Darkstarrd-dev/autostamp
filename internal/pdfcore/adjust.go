package pdfcore

// UI5-B2 (2026-11-09, 用户确认): 明度/饱和度/密度 bake into the seal bitmap
// instead of staying a preview-only canvas filter, so 预览 == 落盘 by
// construction. The channel maths below is the shared contract — app-overlay.js
// adjustedBitmap runs the same numbers, in the same order, with the same
// rounding.
//
// Every colour channel of every pixel (straight alpha, so no premultiply dance
// and the alpha itself never moves) goes through three steps **in this order**,
// each step clamped to 0..255 before the next one starts:
//
//	1. ink (密度, pow curve): v = 255 * (v/255)^g, g = ink, 1 = identity
//	2. brightness b:          v = v * b
//	3. saturate s:            the CSS saturate 3x3 matrix (luminance weights
//	                          0.213/0.715/0.072), so s = 0 collapses to grey
//
// The answer rounds half-up (math.Round / JS Math.round) and clamps to 0..255.
// Steps 1+2 are a pure function of one input byte, so they collapse into a
// 256-entry lookup and the pixel loop never calls math.Pow.

import (
	"bytes"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"math"
)

// The bake vocabulary ranges: the same numbers config.sanitize and the apply
// route validate (api.apply.brightness 0..2, api.apply.saturate 0..5,
// api.apply.ink 1..10).
const (
	bakeBrightMin = 0.0
	bakeBrightMax = 2.0
	bakeSatMin    = 0.0
	bakeSatMax    = 5.0
	bakeInkMin    = 1.0
	bakeInkMax    = 10.0
)

// bakeParams reports one instance's bake parameters. Brightness 0 and
// Saturate 0 are *legal* slider values, so a hand-built StampInstance that
// never touched the group is only recognisable through the whole triple: all
// three at their zero value means "defaults", i.e. the identity bake. Ink 0
// sits outside the slider vocabulary (1..10) entirely, so it falls back to 1
// on its own. The apply route always sends all three (absent fields become the
// declared defaults), so this only guards direct pdfcore callers.
func bakeParams(in StampInstance) (bright, sat, ink float64) {
	bright, sat, ink = in.Brightness, in.Saturate, in.Ink
	if bright == 0 && sat == 0 && ink == 0 {
		return 1, 1, 1
	}
	if ink == 0 {
		ink = 1
	}
	return bright, sat, ink
}

// AdjustPNG bakes the three colour sliders into the seal bitmap and answers the
// re-encoded PNG (PNG or JPEG in, PNG out — the stamp layer always carries
// lossless image bytes, and Strips/RotatePNG need PNG bytes anyway).
//
// All three parameters at 1 answer the input bytes untouched: no decode, no
// re-encode, so the un-adjusted stamp path is byte-for-byte what it was before
// B2 (the P3 seam assertions depend on that identity). Out-of-range parameters
// are an error, never a silent clamp: pdfcore does not guess at an appearance
// the panel did not ask for, and the route owns the 400.
func AdjustPNG(data []byte, bright, sat, ink float64) ([]byte, error) {
	// The comparisons are inverted so NaN falls into the error branch too.
	if !(bright >= bakeBrightMin && bright <= bakeBrightMax) {
		return nil, fmt.Errorf("brightness %g 必须在 %g..%g 之内", bright, bakeBrightMin, bakeBrightMax)
	}
	if !(sat >= bakeSatMin && sat <= bakeSatMax) {
		return nil, fmt.Errorf("saturate %g 必须在 %g..%g 之内", sat, bakeSatMin, bakeSatMax)
	}
	if !(ink >= bakeInkMin && ink <= bakeInkMax) {
		return nil, fmt.Errorf("ink %g 必须在 %g..%g 之内", ink, bakeInkMin, bakeInkMax)
	}
	if bright == 1 && sat == 1 && ink == 1 {
		return data, nil
	}

	var (
		img image.Image
		err error
	)
	switch {
	case pngDecodeConfigOK(data):
		img, err = png.Decode(bytes.NewReader(data))
	case jpegDecodeConfigOK(data):
		img, err = jpeg.Decode(bytes.NewReader(data))
	default:
		return nil, fmt.Errorf("%w: 印章位图需要 PNG 或 JPEG", ErrSealUnsupported)
	}
	if err != nil {
		return nil, fmt.Errorf("印章位图解码失败: %w", err)
	}

	src := toNRGBA(img)
	w, h := src.Bounds().Dx(), src.Bounds().Dy()
	if w < 1 || h < 1 {
		return nil, fmt.Errorf("印章位图尺寸非法: %dx%d", w, h)
	}

	// Steps 1 and 2: pow then clamp, brightness then clamp.
	var lut [256]float64
	for v := range 256 {
		f := clampBake(255 * math.Pow(float64(v)/255, ink))
		lut[v] = clampBake(f * bright)
	}
	// Step 3: the CSS saturate matrix — s = 1 is the identity, s = 0 drops the
	// colour to the luminance greyscale.
	mr := [3]float64{0.213 + 0.787*sat, 0.715 - 0.715*sat, 0.072 - 0.072*sat}
	mg := [3]float64{0.213 - 0.213*sat, 0.715 + 0.285*sat, 0.072 - 0.072*sat}
	mb := [3]float64{0.213 - 0.213*sat, 0.715 - 0.715*sat, 0.072 + 0.928*sat}

	out := image.NewNRGBA(src.Bounds())
	for y := src.Bounds().Min.Y; y < src.Bounds().Max.Y; y++ {
		for x := src.Bounds().Min.X; x < src.Bounds().Max.X; x++ {
			p := src.PixOffset(x, y)
			r, g, b := lut[src.Pix[p]], lut[src.Pix[p+1]], lut[src.Pix[p+2]]
			o := out.PixOffset(x, y)
			out.Pix[o] = uint8(math.Round(clampBake(mr[0]*r + mr[1]*g + mr[2]*b)))
			out.Pix[o+1] = uint8(math.Round(clampBake(mg[0]*r + mg[1]*g + mg[2]*b)))
			out.Pix[o+2] = uint8(math.Round(clampBake(mb[0]*r + mb[1]*g + mb[2]*b)))
			out.Pix[o+3] = src.Pix[p+3] // straight alpha: untouched
		}
	}

	var buf bytes.Buffer
	enc := png.Encoder{CompressionLevel: png.BestCompression}
	if err := enc.Encode(&buf, out); err != nil {
		return nil, fmt.Errorf("编码调整后 PNG: %w", err)
	}
	return buf.Bytes(), nil
}

// clampBake clamps one float channel value into 0..255; every bake step clamps
// before the next one reads it (contract 17).
func clampBake(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 255 {
		return 255
	}
	return v
}

func pngDecodeConfigOK(data []byte) bool {
	_, err := png.DecodeConfig(bytes.NewReader(data))
	return err == nil
}

func jpegDecodeConfigOK(data []byte) bool {
	_, err := jpeg.DecodeConfig(bytes.NewReader(data))
	return err == nil
}
