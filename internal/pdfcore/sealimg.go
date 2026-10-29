package pdfcore

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"math"

	"golang.org/x/image/draw"
)

// Seal bitmap normalisation (AGENTS §6 POST /api/pdf/seal/prepare).
//
// A scanned seal is usually a white-background RGB scan; embedding it as-is
// puts a white box over the page and wastes bytes on fully transparent
// padding. This file does the three things the UI lets the user ask for —
// white-background despill, alpha-bounding-box crop, resample to a chosen DPI
// — and reports the alpha metadata the preview needs. stdlib + x/image/draw
// only (AGENTS §2); no OCR, no server-side rendering.

// sealPixelLimit refuses to decode a bitmap with more than this many pixels
// (seal scans are small; 64 MP would already need a 256 MB NRGBA buffer). It is
// a variable so a test can hit the branch without building a 64 MP scan.
var sealPixelLimit int64 = 64 << 20

// DefaultSealMaxSide is the longest side a prepared seal may carry.
const DefaultSealMaxSide = 2400

// SealErr* are the caller-visible failure modes.
var (
	ErrSealTooLarge    = errors.New("印章图像过大")
	ErrSealEmpty       = errors.New("印章图像没有非透明像素")
	ErrSealUnsupported = errors.New("印章图像格式不支持（需要 PNG 或 JPEG）")
)

// SealOptions mirrors the api.seal.prepare.* fields (UI_SPEC §2).
type SealOptions struct {
	// Despill turns a white/near-white background into transparency.
	Despill bool
	// AlphaTrim crops the bitmap down to its alpha bounding box.
	AlphaTrim bool
	// TargetDPI is the resolution the prepared bitmap is resampled to
	// (resampleDpi, 72..600). 0 keeps the source DPI.
	TargetDPI int
	// MaxSide caps the longest side before embedding (0 = DefaultSealMaxSide).
	MaxSide int
}

// SealMeta is the alpha metadata the preview and the embed both need. The JSON
// keys are part of the /api/pdf/seal/prepare contract (AGENTS §6).
type SealMeta struct {
	SrcWidth     int     `json:"srcWidth"`
	SrcHeight    int     `json:"srcHeight"`
	SourceDPI    int     `json:"sourceDpi"` // 0 = 文件未写 pHYs
	Width        int     `json:"width"`
	Height       int     `json:"height"`
	DPI          int     `json:"dpi"` // 重采样后的有效 DPI
	Aspect       float64 `json:"aspect"`
	AlphaTrimmed bool    `json:"alphaTrimmed"`
	Despilled    bool    `json:"despilled"`
	OpaqueRatio  int     `json:"opaqueRatio"` // 非透明像素占**源图**的比例 ×100（裁剪前计量）
	// AlphaBBox 是非透明包围盒，坐标按**源像素**计；客户端自己留副本时可按此裁剪。
	AlphaBBox SealBox `json:"alphaBBox"`
}

// SealBox is a pixel rectangle (top-left origin).
type SealBox struct {
	X int `json:"x"`
	Y int `json:"y"`
	W int `json:"w"`
	H int `json:"h"`
}

// PrepareSeal decodes src (PNG or JPEG), applies opts and returns the prepared
// PNG plus its metadata. src is read once.
func PrepareSeal(src io.Reader, opts SealOptions) ([]byte, SealMeta, error) {
	img, srcDPI, err := decodeSeal(src)
	if err != nil {
		return nil, SealMeta{}, err
	}

	b := imgBounds(img)
	if int64(b.W)*int64(b.H) > sealPixelLimit {
		return nil, SealMeta{}, fmt.Errorf("%w: %d×%d px", ErrSealTooLarge, b.W, b.H)
	}
	meta := SealMeta{
		SrcWidth:  b.W,
		SrcHeight: b.H,
		SourceDPI: srcDPI,
		Despilled: opts.Despill,
	}

	work := toNRGBA(img)
	if opts.Despill {
		despillWhite(work)
	}
	meta.AlphaBBox, meta.OpaqueRatio = alphaBounds(work)
	if meta.OpaqueRatio == 0 {
		return nil, SealMeta{}, ErrSealEmpty
	}
	if opts.AlphaTrim && meta.AlphaBBox.W > 0 && meta.AlphaBBox.W < b.W {
		work = cropNRGBA(work, meta.AlphaBBox)
		meta.AlphaTrimmed = true
	}

	targetDPI := opts.TargetDPI
	if targetDPI <= 0 {
		targetDPI = srcDPI
	}
	maxSide := opts.MaxSide
	if maxSide <= 0 {
		maxSide = DefaultSealMaxSide
	}
	w, h := work.Bounds().Dx(), work.Bounds().Dy()
	if dpi := scaleDPI(srcDPI, targetDPI); dpi > 0 {
		w, h = resampleDims(w, h, dpi, maxSide)
	} else if m := maxInt(w, h); m > maxSide {
		w, h = fitDims(w, h, maxSide)
	}
	if w != work.Bounds().Dx() || h != work.Bounds().Dy() {
		work = scaleNRGBA(work, w, h)
	}

	meta.Width, meta.Height = w, h
	meta.DPI = effectiveDPI(srcDPI, targetDPI, w, b.W)
	meta.Aspect = round4(float64(w) / float64(h))

	var out bytes.Buffer
	enc := png.Encoder{CompressionLevel: png.BestCompression}
	if err := enc.Encode(&out, work); err != nil {
		return nil, SealMeta{}, fmt.Errorf("编码 PNG: %w", err)
	}
	return out.Bytes(), meta, nil
}

// decodeSeal accepts PNG or JPEG and reports the DPI the file itself declares
// (PNG pHYs). 0 means the file says nothing, which is the usual case for a
// photo of a stamp. JPEG density is deliberately ignored: it describes the
// scanner, not the stamp's physical size.
func decodeSeal(src io.Reader) (image.Image, int, error) {
	data, err := io.ReadAll(src)
	if err != nil {
		return nil, 0, fmt.Errorf("读取印章: %w", err)
	}
	if len(data) == 0 {
		return nil, 0, fmt.Errorf("%w: 空文件", ErrSealUnsupported)
	}
	if _, err := png.DecodeConfig(bytes.NewReader(data)); err == nil {
		img, err := png.Decode(bytes.NewReader(data))
		if err != nil {
			return nil, 0, fmt.Errorf("%w: %v", ErrSealUnsupported, err)
		}
		return img, pngPHYsDPI(data), nil
	}
	if _, err := jpeg.DecodeConfig(bytes.NewReader(data)); err == nil {
		img, err := jpeg.Decode(bytes.NewReader(data))
		if err != nil {
			return nil, 0, fmt.Errorf("%w: %v", ErrSealUnsupported, err)
		}
		return img, 0, nil
	}
	return nil, 0, ErrSealUnsupported
}

// pngPHYsDPI reads the pHYs chunk of a PNG and returns DPI (0 = the file says
// nothing). Go's image/png does not expose pHYs, so the chunk list is walked by
// hand; a malformed file reports "unknown" rather than failing the upload.
func pngPHYsDPI(data []byte) int {
	const sig = "\x89PNG\r\n\x1a\n"
	if len(data) < len(sig) || string(data[:len(sig)]) != sig {
		return 0
	}
	for off := len(sig); off+12 <= len(data); {
		n := int(binary.BigEndian.Uint32(data[off : off+4]))
		kind := string(data[off+4 : off+8])
		if kind == "IDAT" || kind == "IEND" {
			return 0 // pHYs always precedes the image data
		}
		if n < 0 || off+12+n > len(data) {
			return 0
		}
		if kind == "pHYs" && n >= 9 {
			px := binary.BigEndian.Uint32(data[off+8 : off+12])
			// The unit byte is 0 (unknown) or 1 (metre); scanners write 1 and
			// both spellings mean per-metre, so a mislabeled file stays usable.
			if px > 0 {
				return int(round(float64(px) * 0.0254))
			}
			return 0
		}
		off += 12 + n
	}
	return 0
}

// despillWhite makes a white background transparent by removing the white
// matte: alpha = 255 - max(r,g,b), and the colour is un-premultiplied against
// that matte so the ink keeps its saturation instead of turning grey.
func despillWhite(img *image.NRGBA) {
	for y := img.Rect.Min.Y; y < img.Rect.Max.Y; y++ {
		for x := img.Rect.Min.X; x < img.Rect.Max.X; x++ {
			p := img.PixOffset(x, y)
			r, g, bl, a := img.Pix[p], img.Pix[p+1], img.Pix[p+2], img.Pix[p+3]
			if a == 0 {
				continue
			}
			white := max8(max8(r, g), bl)
			newA := 255 - int(white)
			if newA <= 0 {
				img.Pix[p+3] = 0
				continue
			}
			// The original pixel was colour over white; recover the colour.
			if int(a) > newA {
				f := float64(newA) / float64(a)
				img.Pix[p] = clamp8(int(math.Round((float64(r) - float64(white)*(1-f)) / f)))
				img.Pix[p+1] = clamp8(int(math.Round((float64(g) - float64(white)*(1-f)) / f)))
				img.Pix[p+2] = clamp8(int(math.Round((float64(bl) - float64(white)*(1-f)) / f)))
			}
			img.Pix[p+3] = uint8(newA)
		}
	}
}

// alphaBounds returns the non-transparent bounding box and the percentage*100
// of pixels with alpha > 0. An empty image reports a zero-size box.
func alphaBounds(img *image.NRGBA) (SealBox, int) {
	minX, minY := img.Rect.Max.X, img.Rect.Max.Y
	maxX, maxY := img.Rect.Min.X, img.Rect.Min.Y
	count := 0
	for y := img.Rect.Min.Y; y < img.Rect.Max.Y; y++ {
		for x := img.Rect.Min.X; x < img.Rect.Max.X; x++ {
			p := img.PixOffset(x, y)
			if img.Pix[p+3] == 0 {
				continue
			}
			count++
			if x < minX {
				minX = x
			}
			if x > maxX {
				maxX = x
			}
			if y < minY {
				minY = y
			}
			if y > maxY {
				maxY = y
			}
		}
	}
	total := img.Rect.Dx() * img.Rect.Dy()
	if total == 0 || count == 0 {
		return SealBox{}, 0
	}
	return SealBox{
		X: minX - img.Rect.Min.X,
		Y: minY - img.Rect.Min.Y,
		W: maxX - minX + 1,
		H: maxY - minY + 1,
	}, int(math.Round(float64(count) / float64(total) * 10000))
}

// toNRGBA normalises any image.Image into straight-alpha NRGBA so the alpha
// math above never works on premultiplied values.
func toNRGBA(img image.Image) *image.NRGBA {
	if n, ok := img.(*image.NRGBA); ok {
		return n
	}
	out := image.NewNRGBA(img.Bounds())
	draw.Draw(out, out.Bounds(), img, img.Bounds().Min, draw.Src)
	return out
}

func cropNRGBA(img *image.NRGBA, box SealBox) *image.NRGBA {
	r := image.Rect(img.Rect.Min.X+box.X, img.Rect.Min.Y+box.Y,
		img.Rect.Min.X+box.X+box.W, img.Rect.Min.Y+box.Y+box.H)
	out := image.NewNRGBA(r.Sub(image.Pt(r.Min.X, r.Min.Y)))
	draw.Draw(out, out.Bounds(), img, r.Min, draw.Src)
	return out
}

func scaleNRGBA(img *image.NRGBA, w, h int) *image.NRGBA {
	out := image.NewNRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(out, out.Bounds(), img, img.Bounds(), draw.Src, nil)
	return out
}

// scaleDPI returns the ratio target/source to resample by, 0 when either the
// source DPI or the target is unknown/equal.
func scaleDPI(srcDPI, targetDPI int) float64 {
	if srcDPI <= 0 || targetDPI <= 0 || srcDPI == targetDPI {
		return 0
	}
	return float64(targetDPI) / float64(srcDPI)
}

// effectiveDPI reports the resolution the prepared bitmap stands for: the
// target DPI when we knew the source, otherwise the source DPI scaled by the
// pixel resize (so a blind downsample still reports honest DPI).
func effectiveDPI(srcDPI, targetDPI, newW, oldW int) int {
	if srcDPI > 0 && targetDPI > 0 {
		return targetDPI
	}
	if srcDPI > 0 && oldW > 0 {
		return int(round(float64(srcDPI) * float64(newW) / float64(oldW)))
	}
	return targetDPI
}

func resampleDims(w, h int, ratio float64, maxSide int) (int, int) {
	nw, nh := int(round(float64(w)*ratio)), int(round(float64(h)*ratio))
	if nw < 1 {
		nw = 1
	}
	if nh < 1 {
		nh = 1
	}
	if m := max(nw, nh); m > maxSide {
		return fitDims(nw, nh, maxSide)
	}
	return nw, nh
}

func fitDims(w, h, maxSide int) (int, int) {
	m := max(w, h)
	if m <= maxSide || m == 0 {
		return w, h
	}
	f := float64(maxSide) / float64(m)
	nw, nh := int(round(float64(w)*f)), int(round(float64(h)*f))
	if nw < 1 {
		nw = 1
	}
	if nh < 1 {
		nh = 1
	}
	return nw, nh
}

func imgBounds(img image.Image) SealBox {
	r := img.Bounds()
	return SealBox{W: r.Dx(), H: r.Dy()}
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func max8(a, b uint8) uint8 {
	if a > b {
		return a
	}
	return b
}

func clamp8(v int) uint8 {
	if v < 0 {
		return 0
	}
	if v > 255 {
		return 255
	}
	return uint8(v)
}

func round(v float64) float64 { return math.RoundToEven(v) }

// round4 keeps aspect ratios readable in JSON (1.0008, not 1.00079999999).
func round4(v float64) float64 { return math.Round(v*10000) / 10000 }
