package pdfcore

// Stamp placement (P4, AGENTS §5.14). The contract's coordinate space is
// top-left origin, y **down**, PostScript points, in the page's *display*
// space - i.e. after /Rotate, the same space the ruler, the strip previews and
// app-overlay.js rectFor use (UI_SPEC §2 C1).
//
// pdfcpu places an image stamp from a page anchor plus a delta, in the page's
// **unrotated** MediaBox with origin at the lower-left (verified in
// model.Watermark: Pos/Dx/Dy, LowerLeftCorner, CalcBoundingBox; see also
// FACTS §2.1 for the measured anchor/opacity behaviour). So the conversion
// has two parts: a y-flip, and for /Rotate pages a rotation back to MediaBox
// space - plus the same rotation applied to the stamp bitmap itself, or a
// /Rotate 90 page lands the seal in the right place but lying on its side.

import (
	"bytes"
	"fmt"
	"image"
	"image/png"
	"math"
	"strconv"
	"strings"
)

// Rect is a display-space rectangle: top-left origin, y down, points.
type Rect struct {
	X, Y, W, H float64
}

// Right is the rectangle's right edge.
func (r Rect) Right() float64 { return r.X + r.W }

// Bottom is the rectangle's bottom edge.
func (r Rect) Bottom() float64 { return r.Y + r.H }

// DisplaySize is the page extent the user sees (/Rotate applied), the space
// every contract coordinate is measured in. A /Rotate 90 page displays
// swapped; a 180 page keeps its extent.
func (p Page) DisplaySize() (float64, float64) {
	if p.Rotation%180 == 0 {
		return p.Width, p.Height
	}
	return p.Height, p.Width
}

// Anchor names the nine-point grid UI_SPEC §2 declares. The vocabulary in the
// frozen table is `tl|tr|center|bl|br`; `pos` is the internal form used when
// the panel's 位置 field is the source of truth (UI_SPEC §2: "与页内锚点二选一;
// 选锚点后 pos 自动归算"), which keeps the anchor out of the conversion.
type Anchor string

const (
	AnchorTL     Anchor = "tl"
	AnchorTR     Anchor = "tr"
	AnchorCenter Anchor = "center"
	AnchorBL     Anchor = "bl"
	AnchorBR     Anchor = "br"
	// AnchorPos means "the pos field is authoritative; the anchor corner is
	// the box's top-left".
	AnchorPos Anchor = "pos"
)

// ParseAnchor maps the vocabulary; "" means the frozen default (center).
// Anything else is an error so the route answers 400 instead of letting a bad
// name reach pdfcpu.
func ParseAnchor(s string) (Anchor, error) {
	if s == "" {
		return AnchorCenter, nil
	}
	switch Anchor(s) {
	case AnchorTL, AnchorTR, AnchorCenter, AnchorBL, AnchorBR, AnchorPos:
		return Anchor(s), nil
	}
	return "", fmt.Errorf("anchor 必须是 tl|tr|center|bl|br，收到 %q", s)
}

// BindingSide is D2's confirmed three-way choice (UI_SPEC §8 D2, 2026-10-29):
// single-sided keeps every half on the right edge; duplex alternates odd
// pages right / even pages left ("左右是同一条分割的两半"); none disables the
// cross-page stamp entirely.
type BindingSide string

const (
	BindingRight     BindingSide = "right"
	BindingAlternate BindingSide = "alternate"
	BindingNone      BindingSide = "none"
)

// ParseBinding maps the vocabulary; "" means the confirmed default (right).
func ParseBinding(s string) (BindingSide, error) {
	if s == "" {
		return BindingRight, nil
	}
	switch BindingSide(s) {
	case BindingRight, BindingAlternate, BindingNone:
		return BindingSide(s), nil
	}
	return "", fmt.Errorf("binding 必须是 right|alternate|none，收到 %q", s)
}

// ClampScale keeps the seal inside the page the way the preview does: the
// slider vocabulary is 0.1..2.0 but corner drag can exceed it, and the
// on-disk ceiling is 5.0 (UI_SPEC §2 api.apply.scale, HD12). Out-of-range
// numbers clamp rather than error so a value an older build wrote out still
// lands somewhere sane.
func ClampScale(v float64) float64 {
	const min, max = 0.05, 5.0
	if math.IsNaN(v) || v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

// SealAspect is a bitmap's height/width ratio; unknown or zero falls back to
// square, which is what the preview assumes too.
func SealAspect(w, h int) float64 {
	if w <= 0 || h <= 0 {
		return 1
	}
	return float64(h) / float64(w)
}

// StampGeom is one instance's placement request in contract space.
//
// Aspect is the seal bitmap's h/w ratio (it comes from the prepared asset, so
// the preview and the disk agree by construction). Scale is the relative
// page-width fraction UI_SPEC declares. Anchor + Offset locate the box: with
// AnchorPos the anchor point *is* (PosX, PosY) and the offset still adds,
// which is how the panel's 居中 button behaves.
type StampGeom struct {
	Scale  float64
	Aspect float64
	Anchor Anchor
	OffX   float64
	OffY   float64
	PosX   float64
	PosY   float64

	// Cross-page fields: Binding is D2's choice, StartOffset is the N4
	// percent along the page (api.apply.startOffset, 0..100): 0 pins the
	// strip box's bottom edge to the page bottom, 100 pins its top edge to
	// the page top. The plain offset fields are ignored for a strip, exactly
	// like the preview does, because a strip is never dragged by its offset.
	CrossPage   bool
	Binding     BindingSide
	StartOffset float64

	// Slot indexes this stamp into the page list: Slot is the position within
	// Pages (0-based) and PageNumber the 1-based page, which alternate binding
	// needs (odd right, even left). SlotFrac is that slot's share of the
	// whole-seal width (Z5 uneven slices; 0 = the even 1/SlotCount split).
	Slot       int
	SlotCount  int
	SlotFrac   float64
	PageNumber int
}

// Box computes the instance's rectangle in display space (top-left origin, y
// down). For a cross-page instance this is the slot-th strip, pinned to the
// binding edge and moved only by the StartOffset percent (N4).
//
// The strip geometry mirrors app-overlay.js rectFor: the *whole* seal box has
// width = scale x pageWidth, so each strip is that width divided by the page
// count, and the strip's height is the box's full height, not the slice's.
// That is what makes the halves reassemble into one seal across the binding
// gutter, and it is why the slice of the bitmap has to be the i-th column of
// the image (see Strips).
func (g StampGeom) Box(pg Page) (Rect, error) {
	pageW, pageH := pg.DisplaySize()
	if pageW <= 0 || pageH <= 0 {
		return Rect{}, fmt.Errorf("页 %dx%g 尺寸非法", pg.Rotation, pageW)
	}
	scale := ClampScale(g.Scale)
	aspect := g.Aspect
	if aspect <= 0 {
		aspect = 1
	}
	fullW := scale * pageW

	if g.CrossPage {
		if g.Binding == BindingNone {
			return Rect{}, fmt.Errorf("binding=none 时没有骑缝章可放")
		}
		if g.SlotCount < 1 {
			return Rect{}, fmt.Errorf("骑缝章需要页数 >= 1")
		}
		if g.Slot < 0 || g.Slot >= g.SlotCount {
			return Rect{}, fmt.Errorf("条带序号 %d 超出 %d 页", g.Slot, g.SlotCount)
		}
		w := fullW / float64(g.SlotCount)
		if g.SlotFrac > 0 {
			w = fullW * g.SlotFrac // Z5: uneven slices widen/shrink the slot
		}
		h := fullW * aspect
		// D2: single-sided keeps every half on the right; duplex alternates by
		// physical page number (1-based, so the first half of a sheet is right).
		leftEdge := g.Binding == BindingAlternate && g.PageNumber%2 == 0
		x := 0.0
		if !leftEdge {
			x = pageW - w
		}
		// N4: the strip travels along the page in percent of the space the
		// whole-seal box leaves over the page height (travel = pageH - h), and
		// the percent is measured from the bottom: 0 keeps the box's lower edge
		// on the page bottom, 100 puts its upper edge on the page top. travel
		// < 0 simply means the box is taller than the page, and the formula's
		// own value stands, which is what the preview draws too.
		return Rect{X: x, Y: (1 - g.StartOffset/100) * (pageH - h), W: w, H: h}, nil
	}

	w, h := fullW, fullW*aspect
	var ax, ay float64
	switch g.Anchor {
	case AnchorPos:
		ax, ay = g.PosX, g.PosY
	case AnchorTL:
		ax, ay = 0, 0
	case AnchorTR:
		ax, ay = pageW, 0
	case AnchorBL:
		ax, ay = 0, pageH
	case AnchorBR:
		ax, ay = pageW, pageH
	default:
		ax, ay = pageW/2, pageH/2
	}
	// The offset is relative to the anchor point (UI_SPEC §2 api.apply.offset,
	// y down), and the anchor point is where the *box's own anchor corner*
	// goes: tl means the box's top-left sits there, br its bottom-right,
	// center its middle.
	px, py := ax+g.OffX, ay+g.OffY
	x, y := px, py
	switch g.Anchor {
	case AnchorTR, AnchorBR:
		x = px - w
	case AnchorCenter:
		x = px - w/2
	}
	switch g.Anchor {
	case AnchorBL, AnchorBR:
		y = py - h
	case AnchorCenter:
		y = py - h/2
	}
	return Rect{X: x, Y: y, W: w, H: h}, nil
}

// Placement is a stamp rectangle in pdfcpu's page space: lower-left origin, y
// **up**, in the page's unrotated MediaBox, with the bitmap's own angle.
type Placement struct {
	X, Y, W, H float64
	Rot        float64 // degrees, pdfcpu's stamp rotation (-180..180)
}

// ToPDFSpace converts a display-space box into MediaBox space for a page
// carrying /Rotate (0/90/180/270). pdfcpu works in the unrotated MediaBox -
// FACTS §2.3 measures the same normalization for cuts - so a box the user saw
// on a rotated page must be rotated back around the page, and the stamp
// bitmap has to turn by minus the page rotation on top of the user's own
// rotation, or it lands in the right place lying on its side.
//
// The derivation is documented because handedness is easy to get wrong, and a
// handedness bug *mirrors* the seal: invisible for a symmetric mark, obvious
// for a text seal. The display frame is right-and-down, the PDF frame
// right-and-up, so a transpose in the display frame is a rotation (not a
// reflection):
//
//	rot    dx, dy of a point     box (X,Y = lower-left in MediaBox space)
//	0      dx = x,   dy = H-y    X = dx,            Y = mbH - dy - dh
//	90     dx = y,   dy = x      X = dy,            Y = dx
//	180    dx = W-x, dy = H-y    X = mbW - dx - dw,  Y = mbH - dy - dh
//	270    dx = H-y, dy = W-x    X = mbW - dy - dh,  Y = mbH - dx - dw
//
// (90/270 also swap the box's own W/H, since a display-wide box is a
// MediaBox-tall box once the page is rotated back.)
func (r Rect) ToPDFSpace(pg Page, userRotation float64) (Placement, error) {
	mbW, mbH := pg.Width, pg.Height
	if mbW <= 0 || mbH <= 0 {
		return Placement{}, fmt.Errorf("页 %gx%g 尺寸非法", mbW, mbH)
	}
	if r.W <= 0 || r.H <= 0 {
		return Placement{}, fmt.Errorf("印章框 %gx%g 尺寸非法", r.W, r.H)
	}
	dx, dy, dw, dh := r.X, r.Y, r.W, r.H
	var p Placement
	switch norm := normalizeRotation(pg.Rotation); norm {
	case 0:
		p = Placement{X: dx, Y: mbH - dy - dh, W: dw, H: dh}
	case 90:
		p = Placement{X: dy, Y: dx, W: dh, H: dw}
	case 180:
		p = Placement{X: mbW - dx - dw, Y: mbH - dy - dh, W: dw, H: dh}
	case 270:
		p = Placement{X: mbW - dy - dh, Y: mbH - dx - dw, W: dh, H: dw}
	default:
		return Placement{}, fmt.Errorf("/Rotate %d 不是 90 的倍数", pg.Rotation)
	}
	p.Rot = normalizeAngle(userRotation - float64(normalizeRotation(pg.Rotation)))
	return p, nil
}

// normalizeAngle folds an angle into (-180, 180], the range both the stamp
// matrix and the contract's rotation slider speak in.
func normalizeAngle(a float64) float64 {
	for a <= -180 {
		a += 360
	}
	for a > 180 {
		a -= 360
	}
	return a
}

// Strips returns the vertical slices of a cross-page seal bitmap, one per slot,
// encoded as PNG. Slice i is the columns [w*i/count, w*(i+1)/count) of the
// image, full height - the mirror of app-overlay.js drawSeal, which paints the
// i-th column of the bitmap into the i-th page slot. Under Z4 (2026-11-09) the
// caller feeds Strips the *rotated* whole bitmap (RotatePNG): rotation is
// baked before slicing, so each page's slice is a vertical column of the
// turned seal, upright in its slot.
//
// The slices keep the image's own pixel grid, so the reassembled seal is
// byte-identical to the original across the binding gutter (the P3 acceptance
// asserts the seam lines up); count < 1 or an image the decoder rejects is an
// error, never an empty slice set.
func Strips(pngBytes []byte, count int) ([][]byte, error) {
	if count < 1 {
		return nil, fmt.Errorf("条带数必须 >= 1，收到 %d", count)
	}
	img, err := png.Decode(bytes.NewReader(pngBytes))
	if err != nil {
		return nil, fmt.Errorf("印章 PNG 解码失败: %w", err)
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w < count {
		return nil, fmt.Errorf("印章宽 %d px 不足以切成 %d 条", w, count)
	}
	out := make([][]byte, count)
	for i := 0; i < count; i++ {
		x0 := b.Min.X + (w*i)/count
		x1 := b.Min.X + (w*(i+1))/count
		src, ok := img.(subImager)
		if !ok {
			// png.Decode always returns *image.NRGBA or a paletched equivalent;
			// anything else means the decoder handed us something unexpected
			// and slicing it by hand would be guesswork.
			return nil, fmt.Errorf("印章位图类型 %T 不支持按列切分", img)
		}
		var buf bytes.Buffer
		if err := png.Encode(&buf, src.SubImage(image.Rect(x0, b.Min.Y, x1, b.Min.Y+h))); err != nil {
			return nil, fmt.Errorf("条带 %d 编码失败: %w", i, err)
		}
		out[i] = buf.Bytes()
	}
	return out, nil
}

// StripsFractions slices the seal by *explicit per-slot fractions* (Z5,
// 2026-11-09: 随机骑缝章 simulates real binding misalignment). fracs[i] is
// page slot i's share of the whole-seal width; the slice columns follow the
// cumulative sum, so consecutive covered slots keep the seal's own content
// continuity (slot i shows the columns [cum(i-1), cum(i)) of the bitmap).
// A fraction of 0 means the page gets **no strip at all** — the entry is nil,
// the caller must skip placing that page. Fractions are validated against
// 0..1 here; the cumulative pixel bounds round at each step so the reassembled
// columns still tile the bitmap exactly once (the last bound is pinned to the
// image edge). Strips (even) keeps the integer division so existing even-split
// seams stay byte-identical; addInstance routes the uneven case here.
func StripsFractions(pngBytes []byte, fracs []float64) ([][]byte, error) {
	if len(fracs) < 1 {
		return nil, fmt.Errorf("切片数必须 >= 1，收到 %d", len(fracs))
	}
	img, err := png.Decode(bytes.NewReader(pngBytes))
	if err != nil {
		return nil, fmt.Errorf("印章 PNG 解码失败: %w", err)
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	xs := make([]int, len(fracs)+1)
	cum := 0.0
	for i, f := range fracs {
		if f < 0 || f > 1 {
			return nil, fmt.Errorf("切片比例 %g 不在 0..1 之内", f)
		}
		cum += f
		xs[i+1] = int(math.Round(float64(w) * math.Min(cum, 1)))
	}
	out := make([][]byte, len(fracs))
	src, ok := img.(subImager)
	if !ok {
		return nil, fmt.Errorf("印章位图类型 %T 不支持按列切分", img)
	}
	for i := range fracs {
		if xs[i+1] <= xs[i] {
			continue // zero-width slot: the page gets no strip (nil entry)
		}
		var buf bytes.Buffer
		if err := png.Encode(&buf, src.SubImage(image.Rect(xs[i], b.Min.Y, xs[i+1], b.Min.Y+h))); err != nil {
			return nil, fmt.Errorf("条带 %d 编码失败: %w", i, err)
		}
		out[i] = buf.Bytes()
	}
	return out, nil
}

// subImager is the part of image.Image we need for slicing; image.Rectangle
// already satisfies it for the common decoder types.
type subImager interface {
	SubImage(r image.Rectangle) image.Image
}

// ParsePair reads the contract's "x,y" text (api.apply.offset, api.apply.pos).
// Empty means 0,0; a single number means that value with the other axis 0 (the
// UI always writes two, but a hand-built request staying usable is worth
// more than a strict rejection); a malformed number is an error so the route
// answers 400 instead of stamping at the origin.
func ParsePair(s string) (float64, float64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, 0, nil
	}
	parts := strings.SplitN(s, ",", 2)
	if len(parts) == 1 {
		v, err := parseFloat(parts[0])
		if err != nil {
			return 0, 0, fmt.Errorf("偏移/位置需要 x,y 两个数，收到 %q", s)
		}
		return v, 0, nil
	}
	x, err := parseFloat(parts[0])
	if err != nil {
		return 0, 0, fmt.Errorf("偏移/位置需要 x,y 两个数，收到 %q", s)
	}
	y, err := parseFloat(parts[1])
	if err != nil {
		return 0, 0, fmt.Errorf("偏移/位置需要 x,y 两个数，收到 %q", s)
	}
	return x, y, nil
}

func parseFloat(s string) (float64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, nil
	}
	return strconv.ParseFloat(s, 64)
}
