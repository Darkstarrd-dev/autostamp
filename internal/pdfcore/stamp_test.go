package pdfcore

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"math"
	"testing"
)

// The A4 the fixtures use (FACTS §2.3: 595x842 in pdfcpu's own numbers).
var a4 = Page{Width: 595.25, Height: 841.75, Rotation: 0}

func TestStampBoxAnchors(t *testing.T) {
	const scale = 0.202
	w := scale * a4.Width
	cases := []struct {
		name         string
		geom         StampGeom
		wantX, wantY float64
	}{
		{"center default", StampGeom{Scale: scale, Aspect: 1, Anchor: AnchorCenter}, (a4.Width - w) / 2, (a4.Height - w) / 2},
		{"top-left", StampGeom{Scale: scale, Aspect: 1, Anchor: AnchorTL}, 0, 0},
		{"top-right", StampGeom{Scale: scale, Aspect: 1, Anchor: AnchorTR}, a4.Width - w, 0},
		{"bottom-left", StampGeom{Scale: scale, Aspect: 1, Anchor: AnchorBL}, 0, a4.Height - w},
		{"bottom-right", StampGeom{Scale: scale, Aspect: 1, Anchor: AnchorBR}, a4.Width - w, a4.Height - w},
		{"pos field", StampGeom{Scale: scale, Aspect: 1, Anchor: AnchorPos, PosX: 130, PosY: 480}, 130, 480},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r, err := c.geom.Box(a4)
			if err != nil {
				t.Fatalf("Box: %v", err)
			}
			if r.W != w || r.H != w {
				t.Errorf("box size = %gx%g, want %gx%g", r.W, r.H, w, w)
			}
			if math.Abs(r.X-c.wantX) > 1e-6 || math.Abs(r.Y-c.wantY) > 1e-6 {
				t.Errorf("box at (%g,%g), want (%g,%g)", r.X, r.Y, c.wantX, c.wantY)
			}
		})
	}
}

func TestStampBoxOffsetAndAspect(t *testing.T) {
	// A wide seal keeps its aspect: width = scale x page width, height follows
	// the bitmap ratio (app-overlay.js rectFor does the same, and the disk has
	// to match or the preview is a lie).
	g := StampGeom{Scale: 0.3, Aspect: 0.5, Anchor: AnchorTL}
	r, err := g.Box(a4)
	if err != nil {
		t.Fatal(err)
	}
	if want := 0.3 * a4.Width; math.Abs(r.W-want) > 1e-9 {
		t.Errorf("width = %g, want %g", r.W, want)
	}
	if want := 0.3 * a4.Width * 0.5; math.Abs(r.H-want) > 1e-9 {
		t.Errorf("height = %g, want %g", r.H, want)
	}

	// The offset is relative to the anchor point, y down.
	g2 := StampGeom{Scale: 0.3, Aspect: 0.5, Anchor: AnchorCenter, OffX: 40, OffY: -20}
	r2, err := g2.Box(a4)
	if err != nil {
		t.Fatal(err)
	}
	cx := r2.X + r2.W/2
	cy := r2.Y + r2.H/2
	if math.Abs(cx-a4.Width/2-40) > 1e-9 || math.Abs(cy-a4.Height/2+20) > 1e-9 {
		t.Errorf("center after offset = (%g,%g), want (%g,%g)", cx, cy, a4.Width/2+40, a4.Height/2-20)
	}
}

func TestStampBoxStripsRightAndAlternate(t *testing.T) {
	// D2 single-sided: every slot keeps the same column width and hugs the
	// right edge; the height stays the box's full height, which is what lets
	// the halves reassemble into one seal.
	const scale, aspect, count = 0.4, 1.0, 4
	fullW := scale * a4.Width
	w := fullW / count
	mk := func(slot, page int, binding BindingSide, pct float64) Rect {
		g := StampGeom{
			Scale: scale, Aspect: aspect, CrossPage: true, Binding: binding,
			StartOffset: pct, Slot: slot, SlotCount: count, PageNumber: page,
		}
		r, err := g.Box(a4)
		if err != nil {
			t.Fatalf("slot %d: %v", slot, err)
		}
		return r
	}

	for slot := 0; slot < count; slot++ {
		r := mk(slot, slot+1, BindingRight, 37)
		if math.Abs(r.W-w) > 1e-9 || math.Abs(r.H-fullW) > 1e-9 {
			t.Errorf("slot %d size = %gx%g, want %gx%g", slot, r.W, r.H, w, fullW)
		}
		if math.Abs(r.X-(a4.Width-w)) > 1e-9 {
			t.Errorf("slot %d x = %g, want the right edge at %g", slot, r.X, a4.Width-w)
		}
		if wantY := (1 - 0.37) * (a4.Height - fullW); math.Abs(r.Y-wantY) > 1e-9 {
			t.Errorf("startOffset 37 (pct): y = %g, want (1-37%%/100)x(pageH-h) = %g", r.Y, wantY)
		}
	}

	// N4 pins: 0% keeps the strip box's bottom edge on the page bottom, 100%
	// keeps its top edge on the page top (the box height is the whole seal's,
	// so the travel is pageH - h).
	if got := mk(0, 1, BindingRight, 0).Y; math.Abs(got-(a4.Height-fullW)) > 1e-9 {
		t.Errorf("startOffset 0: y = %g, want the bottom pin at %g", got, a4.Height-fullW)
	}
	if got := mk(0, 1, BindingRight, 100).Y; got != 0 {
		t.Errorf("startOffset 100: y = %g, want the top pin at 0", got)
	}

	// Alternate: odd pages right, even pages left.
	for page := 1; page <= 4; page++ {
		slot := (page - 1) % count
		r := mk(slot, page, BindingAlternate, 0)
		want := a4.Width - w
		if page%2 == 0 {
			want = 0
		}
		if math.Abs(r.X-want) > 1e-9 {
			t.Errorf("page %d x = %g, want %g", page, r.X, want)
		}
	}

	// The seam invariant: the strips tile exactly the full box width.
	var sum float64
	for slot := 0; slot < count; slot++ {
		sum += mk(slot, slot+1, BindingRight, 0).W
	}
	if math.Abs(sum-fullW) > 1e-9 {
		t.Errorf("strip widths sum to %g, want the full box %g", sum, fullW)
	}

	// binding=none means there is nothing to place, and the route must not
	// silently fall back to a normal stamp.
	none := StampGeom{Scale: scale, Aspect: aspect, CrossPage: true, Binding: BindingNone, Slot: 0, SlotCount: count}
	if _, err := none.Box(a4); err == nil {
		t.Fatal("binding=none 应当报错，而不是放一枚普通印章")
	}
}

func TestStampBoxClampsScale(t *testing.T) {
	g := StampGeom{Scale: 9, Aspect: 1, Anchor: AnchorTL}
	r, err := g.Box(a4)
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(r.W-5.0*a4.Width) > 1e-9 {
		t.Errorf("scale 9 clamped to %g, want 5.0", r.W/a4.Width)
	}
	g = StampGeom{Scale: 0, Aspect: 1, Anchor: AnchorTL}
	r, err = g.Box(a4)
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(r.W-0.05*a4.Width) > 1e-9 {
		t.Errorf("scale 0 clamped to %g, want 0.05", r.W/a4.Width)
	}
}

func TestToPDFSpaceRotations(t *testing.T) {
	box := Rect{X: 100, Y: 200, W: 100, H: 60}

	// /Rotate 0: only the y-flip.
	p, err := box.ToPDFSpace(a4, 0)
	if err != nil {
		t.Fatal(err)
	}
	if p.X != 100 || math.Abs(p.Y-(a4.Height-200-60)) > 1e-9 || p.W != 100 || p.H != 60 {
		t.Errorf("rot 0 placement = %+v", p)
	}
	if p.Rot != 0 {
		t.Errorf("rot 0 stamp angle = %g", p.Rot)
	}

	rot90 := Page{Width: 595.25, Height: 841.75, Rotation: 90}
	p, err = box.ToPDFSpace(rot90, 0)
	if err != nil {
		t.Fatal(err)
	}
	// A display-wide box becomes a MediaBox-tall box, and the stamp itself has
	// to turn back by the page rotation.
	if p.W != 60 || p.H != 100 {
		t.Errorf("/Rotate 90 box = %gx%g, want 60x100", p.W, p.H)
	}
	if p.Rot != -90 {
		t.Errorf("/Rotate 90 stamp angle = %g, want -90", p.Rot)
	}
	if p.X < 0 || p.Y < 0 || p.X+p.W > rot90.Width || p.Y+p.H > rot90.Height {
		t.Errorf("/Rotate 90 placement %+v escapes the MediaBox %gx%g", p, rot90.Width, rot90.Height)
	}

	// The area must survive for every rotation, and the box must stay inside
	// the page: that is the no-mirroring check the ToPDFSpace comment
	// promises, since a mirrored seal is invisible for a symmetric mark.
	for _, rot := range []int{0, 90, 180, 270} {
		pg := Page{Width: 595.25, Height: 841.75, Rotation: rot}
		pl, err := box.ToPDFSpace(pg, 0)
		if err != nil {
			t.Fatalf("/Rotate %d: %v", rot, err)
		}
		dw, dh := pg.DisplaySize()
		if box.X < 0 || box.Y < 0 || box.Right() > dw || box.Bottom() > dh {
			t.Fatalf("/Rotate %d: display box escapes %gx%g", rot, dw, dh)
		}
		if math.Abs(pl.W*pl.H-box.W*box.H) > 1e-9 {
			t.Errorf("/Rotate %d: area %g != box area %g", rot, pl.W*pl.H, box.W*box.H)
		}
		if pl.X < 0 || pl.Y < 0 || pl.X+pl.W > pg.Width+1e-9 || pl.Y+pl.H > pg.Height+1e-9 {
			t.Errorf("/Rotate %d: placement %+v escapes the MediaBox", rot, pl)
		}
	}
}

func TestNormalizeAngle(t *testing.T) {
	for _, c := range []struct {
		in, want float64
	}{{0, 0}, {180, 180}, {-180, 180}, {270, -90}, {-270, 90}, {400, 40}, {360, 0}} {
		if got := normalizeAngle(c.in); math.Abs(got-c.want) > 1e-9 {
			t.Errorf("normalizeAngle(%g) = %g, want %g", c.in, got, c.want)
		}
	}
}

func TestParsePair(t *testing.T) {
	for _, c := range []struct {
		in      string
		x, y    float64
		wantErr bool
	}{
		{in: "", x: 0, y: 0},
		{in: "130,480", x: 130, y: 480},
		{in: " -12.5 , 8 ", x: -12.5, y: 8},
		{in: "40", x: 40, y: 0},
		{in: "x,1", wantErr: true},
		{in: "1,y", wantErr: true},
	} {
		x, y, err := ParsePair(c.in)
		if (err != nil) != c.wantErr {
			t.Errorf("ParsePair(%q) err = %v, wantErr %v", c.in, err, c.wantErr)
			continue
		}
		if err == nil && (x != c.x || y != c.y) {
			t.Errorf("ParsePair(%q) = (%g,%g), want (%g,%g)", c.in, x, y, c.x, c.y)
		}
	}
}

// gradientSeal encodes a seal whose columns are distinguishable, so slicing
// and re-assembling can be checked pixel by pixel instead of "looks about
// right".
func gradientSeal(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		for y := 0; y < h; y++ {
			img.SetNRGBA(x, y, color.NRGBA{R: uint8(x % 251), G: uint8(y % 253), B: uint8((x + y) % 251), A: uint8((x * 7) % 256)})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestStripsReassembleIntoOriginal(t *testing.T) {
	const w, h, count = 400, 400, 4
	src := gradientSeal(t, w, h)
	parts, err := Strips(src, count)
	if err != nil {
		t.Fatal(err)
	}
	if len(parts) != count {
		t.Fatalf("got %d strips, want %d", len(parts), count)
	}
	full := mustDecode(t, src)
	for i, p := range parts {
		img := mustDecode(t, p)
		wantW := (w*(i+1))/count - (w*i)/count
		if b := img.Bounds(); b.Dx() != wantW || b.Dy() != h {
			t.Errorf("strip %d = %dx%d, want %dx%d", i, b.Dx(), b.Dy(), wantW, h)
		}
	}

	// Re-assemble and compare pixel for pixel: the P3 acceptance needs the
	// halves to rejoin the original seal with no seam at all.
	rebuilt := image.NewNRGBA(image.Rect(0, 0, w, h))
	for i, p := range parts {
		img := mustDecode(t, p)
		x0 := (w * i) / count
		b := img.Bounds()
		for y := 0; y < h; y++ {
			for x := 0; x < b.Dx(); x++ {
				rebuilt.SetNRGBA(x0+x, y, img.NRGBAAt(b.Min.X+x, b.Min.Y+y))
			}
		}
	}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if full.NRGBAAt(x, y) != rebuilt.NRGBAAt(x, y) {
				t.Fatalf("seam mismatch at (%d,%d): %v vs %v", x, y, full.NRGBAAt(x, y), rebuilt.NRGBAAt(x, y))
			}
		}
	}
}

func TestStripsRejectsBadInput(t *testing.T) {
	if _, err := Strips(gradientSeal(t, 10, 10), 0); err == nil {
		t.Error("count 0 should fail")
	}
	if _, err := Strips([]byte("not a png"), 4); err == nil {
		t.Error("garbage should fail")
	}
	if _, err := Strips(gradientSeal(t, 3, 3), 4); err == nil {
		t.Error("3 px wide seal cannot make 4 strips")
	}
}

// Z5 (2026-11-09): uneven slices. The cumulative columns must stay
// continuous across covered slots (content continuity), and a fraction of 0
// answers a nil entry — the page gets no strip at all.
func TestStripsFractionsUnevenColumnsStayContinuous(t *testing.T) {
	const w, h = 100, 40
	src := gradientSeal(t, w, h)
	parts, err := StripsFractions(src, []float64{0.3, 0, 0.4, 0.3})
	if err != nil {
		t.Fatal(err)
	}
	if len(parts) != 4 {
		t.Fatalf("got %d strips, want 4", len(parts))
	}
	if parts[1] != nil {
		t.Errorf("gap slot must answer a nil entry, got %d bytes", len(parts[1]))
	}
	wantW := []int{30, 0, 40, 30}
	for i, p := range parts {
		if wantW[i] == 0 {
			continue
		}
		if b := mustDecode(t, p).Bounds(); b.Dx() != wantW[i] || b.Dy() != h {
			t.Errorf("strip %d = %v, want width %d height %d", i, b.Dx(), wantW[i], h)
		}
	}

	// Re-assemble the covered columns at their cumulative positions: every
	// pixel of the original seal appears exactly once, in order.
	full := mustDecode(t, src)
	rebuilt := image.NewNRGBA(image.Rect(0, 0, w, h))
	cums := []float64{0, 0.3, 0.3, 0.7}
	for i, p := range parts {
		if p == nil {
			continue
		}
		img := mustDecode(t, p)
		x0 := int(cums[i] * float64(w)) // exact here: w = 100
		b := img.Bounds()
		for y := 0; y < h; y++ {
			for x := 0; x < b.Dx(); x++ {
				rebuilt.SetNRGBA(x0+x, y, img.NRGBAAt(b.Min.X+x, b.Min.Y+y))
			}
		}
	}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if full.NRGBAAt(x, y) != rebuilt.NRGBAAt(x, y) {
				t.Fatalf("uneven seam mismatch at (%d,%d): %v vs %v", x, y, full.NRGBAAt(x, y), rebuilt.NRGBAAt(x, y))
			}
		}
	}
}

func TestStripsFractionsRejects(t *testing.T) {
	if _, err := StripsFractions(gradientSeal(t, 10, 10), nil); err == nil {
		t.Error("empty slice list should fail")
	}
	if _, err := StripsFractions([]byte("not a png"), []float64{0.5, 0.5}); err == nil {
		t.Error("garbage should fail")
	}
	if _, err := StripsFractions(gradientSeal(t, 10, 10), []float64{1.2, -0.2}); err == nil {
		t.Error("out-of-range fractions should fail")
	}
}

// The strip box answers to its own fraction: width = frac x (scale x pageW),
// still pinned to the binding edge (right, D2).
func TestBoxHonoursUnevenSlotFrac(t *testing.T) {
	g := StampGeom{
		Scale: 0.2, Aspect: 1, CrossPage: true, Binding: BindingRight,
		StartOffset: 40, SlotCount: 4, Slot: 1, SlotFrac: 0.3, PageNumber: 2,
	}
	box, err := g.Box(a4)
	if err != nil {
		t.Fatal(err)
	}
	wantW := 0.3 * 0.2 * a4.Width
	if math.Abs(box.W-wantW) > 0.01 {
		t.Errorf("uneven strip width = %g, want %g", box.W, wantW)
	}
	if wantX := a4.Width - wantW; math.Abs(box.X-wantX) > 0.01 {
		t.Errorf("uneven strip pinned to right edge: x = %g, want %g", box.X, wantX)
	}
}

func mustDecode(t *testing.T, b []byte) *image.NRGBA {
	t.Helper()
	img, err := png.Decode(bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	n, ok := img.(*image.NRGBA)
	if !ok {
		t.Fatalf("expected *image.NRGBA, got %T", img)
	}
	return n
}
