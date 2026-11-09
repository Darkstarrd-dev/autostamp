package pdfcore

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// sealPNG builds a deterministic RGBA seal: a red cross on a transparent field,
// with half-alpha edge pixels, so both the /SMask channel and the antialiased
// border are exercised.
func sealPNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			a := uint8(0)
			switch {
			case x == 0 || y == 0 || x == w-1 || y == h-1:
				a = 128
			case x == w/2 || y == h/2:
				a = 255
			}
			img.Set(x, y, color.NRGBA{R: 200, G: 30, B: 30, A: a})
		}
	}
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// buildPageWithOwnStatePDF is a one-page fixture whose own content uses
// /GS0 gs, so a test can prove the stamp layer never writes on that state.
func buildPageWithOwnStatePDF(t *testing.T) []byte {
	t.Helper()
	var b bytes.Buffer
	b.WriteString("%PDF-1.7\n")
	objs := []string{
		"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
		"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 595 842] /Rotate 0 >>\nendobj\n",
		"3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /ExtGState << /GS0 5 0 R >> >> >>\nendobj\n",
		"4 0 obj\n<< /Length 10 >>\nstream\nq Q q Q\nendstream\nendobj\n",
		"5 0 obj\n<< /Type /ExtGState /CA 1 /ca 1 >>\nendobj\n",
	}
	offsets := make([]int, 0, len(objs))
	for _, s := range objs {
		offsets = append(offsets, len(b.String()))
		b.WriteString(s)
	}
	xref := len(b.String())
	b.WriteString("xref\n0 6\n0000000000 65535 f \n")
	for _, off := range offsets {
		fmt.Fprintf(&b, "%010d 00000 n \n", off)
	}
	fmt.Fprintf(&b, "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", xref)
	return b.Bytes()
}

// stampBytes runs pdfcore.Stamp over a fixture and returns the written bytes.
func stampBytes(t *testing.T, src []byte, instances []StampInstance) []byte {
	t.Helper()
	in, doc := writeFixture(t, src)
	f, err := os.Open(in)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	out, err := Stamp(context.Background(), f, doc, instances)
	if err != nil {
		t.Fatalf("Stamp: %v", err)
	}
	return out
}

// writeStamped saves bytes to a file and validates them (AGENTS §8: 落盘后必须
// 能过 ValidateFile), returning the path so the caller can re-read it.
func writeStamped(t *testing.T, b []byte) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "stamped.pdf")
	if err := os.WriteFile(p, b, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := api.ValidateFile(context.Background(), p, DefaultLimits(), nil); err != nil {
		t.Fatalf("stamped output rejected: %v", err)
	}
	return p
}

// stampState is one graphic state a stamp artifact referenced.
type stampState struct {
	BM string
	CA float64
}

// stampStatesOf re-reads one file and reports the graphic states its stamp
// artifacts reference, keyed by the resource name.
func stampStatesOf(t *testing.T, path string, pageNr int) map[string]stampState {
	t.Helper()
	ctx, err := api.ReadContextFile(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	names, err := StampGraphicStatesOf(context.Background(), ctx, pageNr)
	if err != nil {
		t.Fatal(err)
	}
	if len(names) == 0 {
		t.Fatalf("page %d: no stamp graphic state found in the written file", pageNr)
	}
	pageDict, _, _, err := ctx.PageDict(context.Background(), pageNr, false)
	if err != nil {
		t.Fatal(err)
	}
	res, err := pageResources(ctx, pageDict)
	if err != nil {
		t.Fatal(err)
	}
	gsObj, found := res.Find("ExtGState")
	if !found {
		t.Fatalf("page %d: no ExtGState resources", pageNr)
	}
	gs, err := ctx.DereferenceDict(gsObj)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]stampState{}
	for name := range names {
		o, found := gs.Find(name)
		if !found {
			t.Fatalf("page %d: stamp state %q is not in Resources/ExtGState", pageNr, name)
		}
		d, err := ctx.DereferenceDict(o)
		if err != nil {
			t.Fatal(err)
		}
		var e stampState
		if o, ok := d.Find("BM"); ok {
			if n, ok := o.(types.Name); ok {
				e.BM = n.Value()
			}
		}
		if ca, ok := d.Find("CA"); ok {
			switch v := ca.(type) {
			case types.Float:
				e.CA = float64(v)
			}
		}
		out[name] = e
	}
	return out
}

// The P4 acceptance pin: the /BM a stamp needs is written by us (pdfcpu never
// emits it, FACTS §2.2) on the state pdfcpu created, together with the opacity
// pdfcpu wrote itself.
func TestStampWritesBMAndOpacity(t *testing.T) {
	pngBytes := sealPNG(t, 40, 40)
	out := stampBytes(t, buildSinglePagePDF(t, 595.25, 841.75), []StampInstance{
		{
			SealID: "s1", PNG: pngBytes, Opacity: 0.6, Blend: BlendMultiply,
			Geom:  StampGeom{Scale: 0.2, Aspect: 1, Anchor: AnchorTL},
			Pages: []int{1},
		},
	})
	path := writeStamped(t, out)

	states := stampStatesOf(t, path, 1)
	if len(states) != 1 {
		t.Fatalf("want exactly one stamp state, got %d: %+v", len(states), states)
	}
	for name, e := range states {
		if e.BM != "Multiply" {
			t.Errorf("state %s /BM = %q, want Multiply", name, e.BM)
		}
		if e.CA != 0.6 {
			t.Errorf("state %s /CA = %g, want 0.6 (pdfcpu opacity)", name, e.CA)
		}
	}
}

// Two instances with different appearance on one page: pdfcpu refuses them in a
// single pass (measured: "inconsistent Opacity: got 1, want 0.6"), so they must
// land as two states, each keeping its own /BM — a shared state would silently
// turn one seal into another seal's blend.
func TestStampKeepsAppearanceSeparateOnOnePage(t *testing.T) {
	pngBytes := sealPNG(t, 40, 40)
	out := stampBytes(t, buildSinglePagePDF(t, 595.25, 841.75), []StampInstance{
		{SealID: "a", PNG: pngBytes, Opacity: 0.6, Blend: BlendMultiply, Geom: StampGeom{Scale: 0.2, Aspect: 1, Anchor: AnchorTL}, Pages: []int{1}},
		{SealID: "b", PNG: pngBytes, Opacity: 1.0, Blend: BlendScreen, Geom: StampGeom{Scale: 0.2, Aspect: 1, Anchor: AnchorBR}, Pages: []int{1}},
	})
	path := writeStamped(t, out)

	states := stampStatesOf(t, path, 1)
	if len(states) != 2 {
		t.Fatalf("want two stamp states, got %d: %+v", len(states), states)
	}
	wantBM := map[string]bool{"Multiply": true, "Screen": true}
	wantCA := map[float64]bool{0.6: true, 1.0: true}
	for name, e := range states {
		if !wantBM[e.BM] {
			t.Errorf("state %s /BM = %q, want Multiply or Screen", name, e.BM)
		}
		if !wantCA[e.CA] {
			t.Errorf("state %s /CA = %g, want 0.6 or 1.0", name, e.CA)
		}
		delete(wantBM, e.BM)
		delete(wantCA, e.CA)
	}
	if len(wantBM) != 0 || len(wantCA) != 0 {
		t.Errorf("missing blends/Opacities: %v / %v", wantBM, wantCA)
	}
}

// The page's own graphic state must never receive /BM: only the seal changes
// appearance, and the stamp layer never shares a state with page content.
func TestStampDoesNotTouchPageOwnStates(t *testing.T) {
	out := stampBytes(t, buildPageWithOwnStatePDF(t), []StampInstance{
		{SealID: "s", PNG: sealPNG(t, 40, 40), Opacity: 0.4, Blend: BlendHardLight, Geom: StampGeom{Scale: 0.2, Aspect: 1, Anchor: AnchorTL}, Pages: []int{1}},
	})
	path := writeStamped(t, out)

	ctx, err := api.ReadContextFile(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	pageDict, _, _, err := ctx.PageDict(context.Background(), 1, false)
	if err != nil {
		t.Fatal(err)
	}
	res, err := pageResources(ctx, pageDict)
	if err != nil {
		t.Fatal(err)
	}
	gsObj, _ := res.Find("ExtGState")
	gs, err := ctx.DereferenceDict(gsObj)
	if err != nil {
		t.Fatal(err)
	}
	o, found := gs.Find("GS0")
	if !found {
		t.Fatal("the page's own /GS0 state vanished from Resources/ExtGState")
	}
	d, err := ctx.DereferenceDict(o)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := d.Find("BM"); ok {
		t.Fatal("the page's own graphic state was given a /BM — the seal must not change page content")
	}
	if len(gs) != 2 {
		t.Errorf("ExtGState carries %d entries, want 2 (the page's + the seal's): %v", len(gs), sortedKeys(gs))
	}
}

// The other half of 需求 3: every page carries its own strip, so each page ends
// up with exactly one stamp state and one /BM, and the product is valid.
func TestStampCrossPageStripsPerPage(t *testing.T) {
	pngBytes := sealPNG(t, 60, 60)
	out := stampBytes(t, buildTestPDF(t), []StampInstance{
		{
			SealID: "cross", PNG: pngBytes, Opacity: 0.6, Blend: BlendMultiply,
			Geom: StampGeom{
				Scale: 0.2, Aspect: 1, CrossPage: true,
				Binding: BindingRight, StartOffset: 40,
			},
			Pages: []int{1, 2, 3},
		},
	})
	path := writeStamped(t, out)
	for _, pageNr := range []int{1, 2, 3} {
		states := stampStatesOf(t, path, pageNr)
		if len(states) != 1 {
			t.Errorf("page %d: want one strip state, got %d", pageNr, len(states))
		}
		for name, e := range states {
			if e.BM != "Multiply" {
				t.Errorf("page %d state %s /BM = %q, want Multiply", pageNr, name, e.BM)
			}
		}
	}
}

// TestStampUnevenSlicesPerPage (Z5): the disk honours the preview's slice list
// — the gap slot (fraction 0) produces no artifact at all, and the surviving
// strips keep their per-slot width (the cm matrix scale = box width in points)
// and binding-edge pin.
func TestStampUnevenSlicesPerPage(t *testing.T) {
	pngBytes := sealPNG(t, 48, 24)
	out := stampBytes(t, buildTestPDF(t), []StampInstance{
		{
			SealID: "cross", PNG: pngBytes, Opacity: 0.6, Blend: BlendMultiply,
			Geom:   StampGeom{Scale: 0.2, Aspect: 1, CrossPage: true, Binding: BindingRight, StartOffset: 40},
			Pages:  []int{1, 2, 3},
			Slices: []float64{0.7, 0.3, 0},
		},
	})
	path := writeStamped(t, out)
	ctx, err := api.ReadContextFile(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	const pageW = 595.0 // buildTestPDF's MediaBox
	fullW := 0.2 * pageW
	// buildTestPDF's pages *share* one content stream object, so page 1's
	// stream carries every stamped slot — convenient: the two uneven slots
	// must be side by side at their own pinned x offsets (only true if the
	// per-slot fractions drove Box()), and the gap slot contributes nothing:
	// exactly two artifacts, never three. (Strip *width* is pinned by
	// TestBoxHonoursUnevenSlotFrac and the StripsFractions tests above.)
	pageDict, _, _, err := ctx.PageDict(context.Background(), 1, false)
	if err != nil {
		t.Fatal(err)
	}
	content, err := pageContentBytes(ctx, pageDict, 1)
	if err != nil {
		t.Fatal(err)
	}
	tr := artifactTranslations(t, content)
	if len(tr) != 2 {
		t.Fatalf("gap slot contributed an artifact (want exactly 2 stamped slots, got %d: %v)", len(tr), tr)
	}
	for _, want := range []struct {
		frac float64
		x    float64
	}{{0.7, pageW - 0.7*fullW}, {0.3, pageW - 0.3*fullW}} {
		hit := false
		for _, m := range tr {
			if math.Abs(m[4]-want.x) < 0.05 {
				hit = true
			}
		}
		if !hit {
			t.Errorf("slot frac %g: no artifact pinned at x %g (cm list %v)", want.frac, want.x, tr)
		}
	}
	// The classic even-split x must NOT appear: that would mean the fractions
	// were ignored and the old 1/count path ran.
	for _, m := range tr {
		if math.Abs(m[4]-(pageW-fullW/2)) < 0.05 {
			t.Errorf("even-split placement appeared in an uneven-slice stamp: %v", m)
		}
	}
}

// The UI invariant the plan promises: re-adjusting a seal re-bakes it from the
// clean base asset, so the base never carries a second copy of the artifact
// (pdfcpu's Update flag is deliberately false — see Stamp's comment).
func TestStampFromCleanBaseKeepsSingleCopy(t *testing.T) {
	pngBytes := sealPNG(t, 40, 40)
	inst := []StampInstance{
		{SealID: "s", PNG: pngBytes, Opacity: 0.6, Blend: BlendMultiply, Geom: StampGeom{Scale: 0.2, Aspect: 1, Anchor: AnchorTL}, Pages: []int{1}},
	}
	a := writeStamped(t, stampBytes(t, buildSinglePagePDF(t, 595.25, 841.75), inst))
	b := writeStamped(t, stampBytes(t, buildSinglePagePDF(t, 595.25, 841.75), inst))
	for _, p := range []string{a, b} {
		if n := len(stampStatesOf(t, p, 1)); n != 1 {
			t.Errorf("%s: re-bake left %d stamp states, want 1", filepath.Base(p), n)
		}
	}
}

func TestStampRejectsBadRequests(t *testing.T) {
	pngBytes := sealPNG(t, 40, 40)
	in, doc := writeFixture(t, buildSinglePagePDF(t, 595.25, 841.75))
	f, err := os.Open(in)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	cases := []struct {
		name string
		inst []StampInstance
	}{
		{"no instances", nil},
		{"missing bitmap", []StampInstance{{SealID: "x", Pages: []int{1}}}},
		{"no pages", []StampInstance{{SealID: "x", PNG: pngBytes, Geom: StampGeom{Scale: .2, Aspect: 1}}}},
		{"opacity out of range", []StampInstance{{SealID: "x", PNG: pngBytes, Opacity: 1.5, Geom: StampGeom{Scale: .2, Aspect: 1}, Pages: []int{1}}}},
		{"page beyond the document", []StampInstance{{SealID: "x", PNG: pngBytes, Geom: StampGeom{Scale: .2, Aspect: 1}, Pages: []int{7}}}},
		{"strip slot count mismatch", []StampInstance{{SealID: "x", PNG: pngBytes, Geom: StampGeom{Scale: .2, Aspect: 1, CrossPage: true, Binding: BindingRight, SlotCount: 2}, Pages: []int{1}}}},
		{"binding none with crossPage", []StampInstance{{SealID: "x", PNG: pngBytes, Geom: StampGeom{Scale: .2, Aspect: 1, CrossPage: true, Binding: BindingNone, SlotCount: 1}, Pages: []int{1}}}},
		{"slices length mismatch", []StampInstance{{SealID: "x", PNG: pngBytes, Geom: StampGeom{Scale: .2, Aspect: 1, CrossPage: true, Binding: BindingRight}, Pages: []int{1, 2, 3}, Slices: []float64{0.5, 0.5}}}},
	}
	for _, c := range cases {
		if _, err := Stamp(context.Background(), f, doc, c.inst); err == nil {
			t.Errorf("%s: Stamp accepted the request", c.name)
		}
	}
	if _, err := os.Stat(in); err != nil {
		t.Errorf("Stamp touched the source file it reads: %v", err)
	}
}

// artifactTranslations returns the six numbers of every `cm` inside a stamp
// artifact block: the matrix a viewer uses to place the form XObject. Reading
// the written numbers (rather than pdfcpu's internal model) is the point - it
// is what the rendered page will use.
func artifactTranslations(t *testing.T, content []byte) [][6]float64 {
	t.Helper()
	re := regexp.MustCompile(`([-0-9.]+) ([-0-9.]+) ([-0-9.]+) ([-0-9.]+) ([-0-9.]+) ([-0-9.]+) cm`)
	var out [][6]float64
	for _, block := range strings.Split(string(content), "/Watermark") {
		if i := strings.Index(block, "EMC"); i >= 0 {
			block = block[:i]
		}
		for _, mm := range re.FindAllStringSubmatch(block, -1) {
			var v [6]float64
			for k := 1; k <= 6; k++ {
				f, err := strconv.ParseFloat(mm[k], 64)
				if err != nil {
					t.Fatalf("cm number %q: %v", mm[k], err)
				}
				v[k-1] = f
			}
			out = append(out, v)
		}
	}
	return out
}

// 需求 3 geometry pin: every strip's box belongs to the *whole* seal (width =
// scale x pageWidth divided by the page count, height = scale x pageWidth x the
// whole seal's ratio). Deriving the ratio from the slice bitmap instead makes
// each strip `count` times too tall - measured 2026-11-02, where the strip's
// lower edge landed one strip-height below the frame the UI draws and the
// read-back pixel check found the strip bottom one strip off.
func TestStampStripBoxUsesWholeSealAspect(t *testing.T) {
	// 60x30 whole seal (ratio 0.5) -> 30x30 slices (ratio 1). The box height has
	// to come from the whole seal: 119*0.5, not 119*1.
	const (
		pageW, pageH = 595.0, 842.0 // buildTestPDF's MediaBox
		scale        = 0.2
		startOffset  = 40.0 // N4: percent along the page
	)
	fullW := scale * pageW
	boxH := fullW * (30.0 / 60.0)
	out := stampBytes(t, buildTestPDF(t), []StampInstance{
		{
			SealID: "wide", PNG: sealPNG(t, 60, 30), Opacity: 1,
			Geom:  StampGeom{Scale: scale, CrossPage: true, Binding: BindingRight, StartOffset: startOffset},
			Pages: []int{1, 2},
		},
	})
	path := writeStamped(t, out)
	ctx, err := api.ReadContextFile(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	pageDict, _, _, err := ctx.PageDict(context.Background(), 1, false)
	if err != nil {
		t.Fatal(err)
	}
	content, err := pageContentBytes(ctx, pageDict, 1)
	if err != nil {
		t.Fatal(err)
	}
	tr := artifactTranslations(t, content)
	if len(tr) == 0 {
		t.Fatal("page 1: no stamp artifact found in the written file")
	}
	// The strip's own slot: right edge of the page, y flipped over the display
	// height (newStamp): Dy = pageH - Y - boxH with the display-space
	// Y = (1 - pct/100) x (pageH - boxH), so Dy = pct/100 x (pageH - boxH).
	wantX, wantY := pageW-fullW/2, (startOffset/100)*(pageH-boxH)
	for i, m := range tr {
		if math.Abs(m[4]-wantX) > 0.01 || math.Abs(m[5]-wantY) > 0.01 {
			t.Errorf("artifact %d: placed at %g,%g want %g,%g (条带框高必须来自整枚印章)", i, m[4], m[5], wantX, wantY)
		}
	}
}
