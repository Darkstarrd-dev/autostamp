package pdfcore

// P4: the stamp write path (AGENTS §6 POST /api/pdf/apply). Everything runs in
// one pdfcpu context - read, stamp, patch the /BM entry the stamp layer never
// writes (FACTS §2.2), write - so there is no second parse and no temp-file
// juggling inside pdfcpu.
//
// The contract's coordinate space (top-left, y down, display space after
// /Rotate) lives in stamp.go; this file only hands pdfcpu the anchor + delta it
// expects, because pdfcpu compensates for /Rotate itself (it wraps the page
// content, stamp included, in a rotation matrix), so translating here too would
// rotate twice.

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"sort"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// StampInstance is one resolved seal placement: the prepared PNG (already
// despilled/trimmed/resampled by /api/pdf/seal/prepare), the geometry in
// contract space, and the appearance fields the panel edits.
//
// Pages is the resolved 1-based page list for this instance: a normal stamp
// puts the whole bitmap on every listed page; a cross-page stamp puts the
// slot-th strip of the bitmap on the slot-th page of that list, in order.
type StampInstance struct {
	SealID  string
	PNG     []byte
	Geom    StampGeom
	Rot     float64 // -180..180, the user's own rotation
	Opacity float64 // 0..1
	Blend   Blend
	Pages   []int

	// Brightness/Saturate/Ink are the UI5-B2 bake parameters
	// (api.apply.brightness 0..2 / saturate 0..5 / ink 1..10): the seal bitmap
	// is adjusted by AdjustPNG *before* RotatePNG/Strips, so what the preview
	// bakes is what the page carries. A caller that leaves the whole group at
	// its zero value means "the panel never touched them" -> the identity bake
	// (see bakeParams); the apply route always fills all three.
	Brightness float64
	Saturate   float64
	Ink        float64

	// Slices is the optional per-slot share of the whole-seal width (Z5):
	// len == len(Pages), values 0..1; a 0 entry means the slot's page gets no
	// strip at all. Empty = the even 1/len(Pages) split (the classic behaviour).
	Slices []float64
}

// Stamp puts every instance on the document and returns the new bytes. Nothing
// writes to disk here: the caller hands the result to the session store, so the
// previous asset stays intact and 撤销切分/撤销盖章 is free.
//
// Instances go out in passes. pdfcpu rejects a single pass whose watermarks
// disagree on OnTop or Opacity (measured 2026-10-30: "inconsistent Opacity:
// got 1, want 0.6"), and one pass shares one ExtGState across its watermarks —
// so instances are grouped by (blend, opacity) and each group gets its own
// pass, its own graphic state, and its own /BM. Adjacent identical appearance
// merges into one pass, which keeps page order without reordering instances.
//
// pdfcpu's Update flag (model.Watermark.Update → removePageWatermark,
// stamp.go:1975) is deliberately left false: successive passes *keep* the
// earlier artifacts (measured: two passes on one page both survive), and the
// UI re-bakes every apply from the clean base asset, so re-adjusting one seal
// never stacks two copies of it.
func Stamp(c context.Context, f *os.File, doc *Doc, instances []StampInstance) ([]byte, error) {
	if doc == nil {
		return nil, fmt.Errorf("落盘需要已解析的文档结构")
	}
	if len(instances) == 0 {
		return nil, fmt.Errorf("没有印章可放")
	}
	for _, in := range instances {
		if len(in.PNG) == 0 {
			return nil, fmt.Errorf("印章 %s 缺少位图", in.SealID)
		}
		if len(in.Pages) == 0 {
			return nil, fmt.Errorf("印章 %s 没有作用页", in.SealID)
		}
		if in.Opacity < 0 || in.Opacity > 1 {
			return nil, fmt.Errorf("印章 %s 透明度必须在 0..1 之内，收到 %g", in.SealID, in.Opacity)
		}
		for _, p := range in.Pages {
			if p < 1 || p > doc.PageCount {
				return nil, fmt.Errorf("印章 %s 引用了不存在的页 %d（文档共 %d 页）", in.SealID, p, doc.PageCount)
			}
		}
	}

	conf := DefaultLimits()
	ctx, err := api.ReadValidateAndOptimize(c, f, conf, nil)
	if err != nil {
		return nil, fmt.Errorf("读文档失败: %w", err)
	}

	for _, p := range groupByAppearance(instances) {
		if err := stampPassOf(c, ctx, doc, p); err != nil {
			return nil, err
		}
	}

	var out bytes.Buffer
	if err := api.Write(c, ctx, &out, conf); err != nil {
		return nil, fmt.Errorf("写文档失败: %w", err)
	}
	return out.Bytes(), nil
}

// stampPassOf is one (blend, opacity) group: its watermarks go through one
// pdfcpu pass, and only the graphic states that pass created get the /BM.
func stampPassOf(c context.Context, ctx *model.Context, doc *Doc, p stampPass) error {
	m := map[int][]*model.Watermark{}
	var pages []int
	for _, in := range p.insts {
		if err := addInstance(m, doc, in); err != nil {
			return err
		}
	}
	for pg := range m {
		pages = append(pages, pg)
	}
	sort.Ints(pages)

	// The footprint a pass leaves is its own ExtGState resource names: pdfcpu
	// appends one fresh entry per pass (measured 2026-10-30: GS0 for the first
	// pass, GS1 for the second), so the key diff says which states this pass
	// owns. Intersecting that with the artifact scan keeps the page's *own*
	// graphic states out, and pages that share one ExtGState object (measured:
	// a fixture whose pages all point at the same content stream) see no fresh
	// name the second time round — the first page already wrote the /BM there.
	before := map[int]map[string]bool{}
	for _, pg := range pages {
		keys, err := ExtGStateKeysOf(c, ctx, pg)
		if err != nil {
			return err
		}
		before[pg] = keys
	}
	if err := pdfcpu.AddWatermarksSliceMap(c, ctx, m); err != nil {
		return fmt.Errorf("落盘印章失败: %w", err)
	}
	if p.blend.Empty() {
		return nil // Normal is the PDF default: there is no /BM to write
	}
	for _, pg := range pages {
		after, err := ExtGStateKeysOf(c, ctx, pg)
		if err != nil {
			return err
		}
		used, err := StampGraphicStatesOf(c, ctx, pg)
		if err != nil {
			return err
		}
		fresh := map[string]bool{}
		for name := range after {
			if !before[pg][name] && used[name] {
				fresh[name] = true
			}
		}
		if len(fresh) == 0 {
			continue // a page sharing the object had it handled by the first one
		}
		if err := BlendApplyNames(c, ctx, pg, p.blend, fresh); err != nil {
			return fmt.Errorf("页 %d 注入 /BM 失败: %w", pg, err)
		}
	}
	return nil
}

// stampPass is one pdfcpu pass: every instance in it shares the same blend and
// the same opacity, which is what pdfcpu's shared-settings check demands.
type stampPass struct {
	blend   Blend
	opacity float64
	insts   []StampInstance
}

// groupByAppearance merges adjacent instances that share appearance instead of
// re-sorting them: page order and instance order stay exactly as the UI lists
// them.
func groupByAppearance(instances []StampInstance) []stampPass {
	var out []stampPass
	for _, in := range instances {
		if n := len(out); n > 0 && out[n-1].blend == in.Blend && out[n-1].opacity == in.Opacity {
			out[n-1].insts = append(out[n-1].insts, in)
			continue
		}
		out = append(out, stampPass{blend: in.Blend, opacity: in.Opacity, insts: []StampInstance{in}})
	}
	return out
}

// addInstance fills the per-page watermark map for one instance. The box is
// computed per page (each page carries its own size and /Rotate), which mirrors
// what the preview draws: the same contract values on every page of a
// heterogeneous document.
func addInstance(m map[int][]*model.Watermark, doc *Doc, in StampInstance) error {
	// UI5-B2 (2026-11-09, 用户确认): the colour sliders bake into the bitmap,
	// and they bake **first**: adjust -> rotate -> slice, the same order
	// app-overlay.js effectiveBitmap composes (adjustedBitmap -> rotCache ->
	// strip columns). Identity parameters skip the bake, so a stamp nobody
	// adjusted still carries the prepared bytes byte-for-byte.
	base := in.PNG
	if bright, sat, ink := bakeParams(in); bright != 1 || sat != 1 || ink != 1 {
		adjusted, err := AdjustPNG(in.PNG, bright, sat, ink)
		if err != nil {
			return fmt.Errorf("调色烘焙: %w", err)
		}
		base = adjusted
	}
	if !in.Geom.CrossPage {
		for _, p := range in.Pages {
			// A plain seal keeps its rotation live: pdfcpu rotates the bitmap
			// about the box (no raster bake - the vector stays untouched).
			// base, not in.PNG: the bake already ran (identity = same bytes).
			w, err := newStamp(in, doc.Pages[p-1], in.Geom, base, normalizeAngle(in.Rot))
			if err != nil {
				return err
			}
			m[p] = append(m[p], w)
		}
		return nil
	}

	count := len(in.Pages)
	// The slot count is the page list: it is never a second number that can
	// drift away from it. A caller that sends one must send the same value.
	if in.Geom.SlotCount > 0 && in.Geom.SlotCount != count {
		return fmt.Errorf("骑缝实例的 slotCount %d 与作用页数 %d 不一致", in.Geom.SlotCount, count)
	}
	// Z4 (2026-11-09, 用户指令): the strip order is **rotate the whole seal,
	// then slice** - the rotation is baked into the bitmap before Strips, and
	// every page gets a vertical column of the *rotated* seal. Slicing first
	// and rotating each column in place (the old behaviour) tore the mark in
	// halves and left the strips rotated against the binding gutter.
	// The mirror on the preview side is app-overlay.js effectiveBitmap.
	if rot := normalizeAngle(in.Rot); rot != 0 {
		rotated, err := RotatePNG(base, rot)
		if err != nil {
			return fmt.Errorf("骑缝旋转整章: %w", err)
		}
		base = rotated
	}
	// Z5 (2026-11-09, 用户指令): the panel's 平均|随机 switch produces explicit
	// per-slot fractions (api.apply.slices); a fraction of 0 means the page was
	// picked as a gap (real bindings leave some pages unsealable). Without a
	// slice list the classic even split runs unchanged — Strips' integer
	// division is the byte-exact mirror of the preview's index/count columns,
	// which is what the P3 seam assertion pins down.
	even := len(in.Slices) == 0
	var strips [][]byte
	var err error
	fracs := make([]float64, count)
	for i := range fracs {
		fracs[i] = 1 / float64(count)
	}
	if even {
		strips, err = Strips(base, count)
	} else {
		if len(in.Slices) != count {
			return fmt.Errorf("骑缝实例的切片数 %d 与作用页数 %d 不一致", len(in.Slices), count)
		}
		copy(fracs, in.Slices)
		strips, err = StripsFractions(base, fracs)
	}
	if err != nil {
		return fmt.Errorf("骑缝条带: %w", err)
	}
	// The strip box belongs to the *whole* seal, not to one slice: the slices
	// reassemble into a single box of width scale x pageWidth and height
	// fullWidth x (whole-seal aspect). Deriving the aspect from the slice bytes
	// would make every strip count x too tall (measured 2026-11-02: a wide seal
	// on a 2-page spread drew its half-seal box, and the read-back pixel check
	// found the strip bottom exactly one strip-height off). With Z4 the aspect
	// comes from the *rotated* whole bitmap - the bbox dims RotatePNG grows the
	// canvas to, the same formula the preview canvas computes with.
	pw0, ph0 := pxDims(base)
	if pw0 < 1 || ph0 < 1 {
		return fmt.Errorf("印章 %s 的位图尺寸非法", in.SealID)
	}
	wholeAspect := SealAspect(pw0, ph0)
	allGap := true
	for _, s := range strips {
		if s != nil {
			allGap = false
			break
		}
	}
	if allGap {
		return fmt.Errorf("骑缝实例的切片全为 0，没有任何页面可盖章")
	}
	for slot, p := range in.Pages {
		if strips[slot] == nil {
			continue // Z5 gap page: the binding left this page unsealable
		}
		g := in.Geom
		g.Aspect = wholeAspect
		g.Slot = slot
		g.SlotCount = count
		if !even {
			g.SlotFrac = fracs[slot] // Z5; even path keeps the classic division in Box
		}
		g.PageNumber = p
		// Rotation is already baked into the strip bitmap: the strip pass
		// places it upright (0 degrees).
		w, err := newStamp(in, doc.Pages[p-1], g, strips[slot], 0)
		if err != nil {
			return err
		}
		m[p] = append(m[p], w)
	}
	return nil
}

// newStamp converts one contract box into pdfcpu's anchor+delta placement.
//
// The anchor is the page's lower-left corner; Dx/Dy are the box's own
// lower-left, in the space pdfcpu places the artifact in. Because the stamp
// layer compensates for /Rotate itself (model.Watermark.PageRot +
// ContentBytesForPageRotation wrap the whole page content, the stamp included),
// those numbers are *display* space coordinates - what the panel, the ruler and
// the overlay all speak - translated only by the y-flip over the display
// height, never by a rotation. The seal's own rotation (rot) is passed through
// as-is for the same reason; a cross-page strip passes 0 (its rotation is
// baked into the strip bitmap by RotatePNG, Z4).
func newStamp(in StampInstance, pg Page, g StampGeom, png []byte, rot float64) (*model.Watermark, error) {
	if pg.Width <= 0 || pg.Height <= 0 {
		return nil, fmt.Errorf("页 %d 尺寸未知，无法放印章 %s", pg.Number, in.SealID)
	}
	pw, ph := pxDims(png)
	if pw < 1 || ph < 1 {
		return nil, fmt.Errorf("印章 %s 的位图尺寸非法", in.SealID)
	}
	// The aspect the preview used: for a single seal that is the bitmap's own
	// ratio, recomputed from the very same bytes so the two cannot drift apart.
	// A cross-page strip keeps the *whole seal's* ratio (addInstance sets it);
	// the slice's own ratio is deliberately not used here, because the slice is
	// only part of the artifact the box describes.
	if !g.CrossPage {
		g.Aspect = SealAspect(pw, ph)
	} else if g.Aspect <= 0 {
		return nil, fmt.Errorf("骑缝实例缺少整枚印章的纵横比(条带框由印章整体决定)")
	}
	box, err := g.Box(pg)
	if err != nil {
		return nil, err
	}
	_, dispH := pg.DisplaySize()
	return &model.Watermark{
		OnTop: true, // a seal sits on top of the page content, not behind it
		Mode:  model.WMImage,
		Image: bytes.NewReader(png),
		Pos:   types.BottomLeft,
		Dx:    box.X,
		Dy:    dispH - box.Y - box.H,
		// ScaleAbs: the factor maps bitmap pixels to points; the aspect stays
		// with the bitmap, so the drawn height follows the same ratio the
		// preview computed from the very same PNG.
		Scale:    box.W / float64(pw),
		ScaleAbs: true,
		InpUnit:  types.POINTS,
		Rotation: rot,
		Opacity:  in.Opacity,
	}, nil
}
