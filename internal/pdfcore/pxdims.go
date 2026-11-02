package pdfcore

import (
	"bytes"
	"image"

	_ "image/png" // the seal assets are PNG; the blank import registers the decoder
)

// pxDims reads a bitmap header without decoding the pixels - the stamp
// geometry only ever needs the size, and a prepared seal can be large enough
// that decoding it twice on the way to disk would be noticeable.
//
// Zero means "undecodable", which callers report as an invalid bitmap instead
// of guessing a square.
func pxDims(b []byte) (w, h int) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(b))
	if err != nil {
		return 0, 0
	}
	return cfg.Width, cfg.Height
}
