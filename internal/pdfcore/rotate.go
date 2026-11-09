package pdfcore

// RotatePNG (Z4, 2026-11-09): the cross-page strip order is *rotate the whole
// seal first, then slice*, so the whole-seal rotation is baked into the bitmap
// before Strips slices it into per-page columns. What every page receives is a
// vertical strip of the rotated seal, and the preview side composites the very
// same rotated bitmap (app-overlay.js rotatedBitmapCanvas + effectiveBitmap).
//
// The canvas grows to the rotated bounding box:
//
//	wR = round(w*|cos| + h*|sin|), hR = round(w*|sin| + h*|cos|)
//
// which is the exact formula the preview canvas uses, and the strip-box aspect
// both sides lay out with comes from those dims. Rotation direction is screen
// clockwise (display space, y down) - the same handedness a canvas
// ctx.rotate(+deg) produces, and the same way the plain (non-cross-page) stamp
// rotates about its centre. Sampling is nearest-neighbour: seal art is hard
// edged, and the seam columns stay pixel-exact on the disk side (the preview's
// smooth filtering differs only along antialiased edges, which the strip
// acceptance probes away from).

import (
	"bytes"
	"fmt"
	"image"
	"image/png"
	"math"
)

// RotatePNG rotates the seal PNG by deg (screen degrees, clockwise) and
// returns the re-encoded PNG with the canvas sized to the rotated bbox.
// deg == 0 is the identity: the bytes answer unchanged.
func RotatePNG(pngBytes []byte, deg float64) ([]byte, error) {
	if deg == 0 {
		return pngBytes, nil
	}
	img, err := png.Decode(bytes.NewReader(pngBytes))
	if err != nil {
		return nil, fmt.Errorf("印章 PNG 解码失败: %w", err)
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w < 1 || h < 1 {
		return nil, fmt.Errorf("印章位图尺寸非法: %dx%d", w, h)
	}
	rad := deg * math.Pi / 180
	cos, sin := math.Cos(rad), math.Sin(rad)
	wR := int(math.Round(float64(w)*math.Abs(cos) + float64(h)*math.Abs(sin)))
	hR := int(math.Round(float64(w)*math.Abs(sin) + float64(h)*math.Abs(cos)))
	if wR < 1 || hR < 1 {
		return nil, fmt.Errorf("旋转后的印章画布尺寸非法: %dx%d (deg %g)", wR, hR, deg)
	}
	src := toNRGBA(img)
	out := image.NewNRGBA(image.Rect(0, 0, wR, hR))
	scx, scy := float64(w)/2, float64(h)/2
	dcx, dcy := float64(wR)/2, float64(hR)/2
	// Forward mapping is dst_local = (x*cos - y*sin, x*sin + y*cos) about the
	// canvas centres; sample backwards (dst -> src) so no dst pixel is left
	// unvisited.
	for y := range hR {
		dy := float64(y) + 0.5 - dcy
		for x := range wR {
			dx := float64(x) + 0.5 - dcx
			sx := scx + dx*cos + dy*sin
			sy := scy - dx*sin + dy*cos
			px, py := int(math.Floor(sx)), int(math.Floor(sy))
			if px < b.Min.X || px >= b.Max.X || py < b.Min.Y || py >= b.Max.Y {
				continue // outside the source: transparent
			}
			si := src.PixOffset(px, py)
			oi := out.PixOffset(x, y)
			out.Pix[oi] = src.Pix[si]
			out.Pix[oi+1] = src.Pix[si+1]
			out.Pix[oi+2] = src.Pix[si+2]
			out.Pix[oi+3] = src.Pix[si+3]
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, out); err != nil {
		return nil, fmt.Errorf("旋转后的印章编码失败: %w", err)
	}
	return buf.Bytes(), nil
}
