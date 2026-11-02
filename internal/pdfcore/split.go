package pdfcore

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

// Split modes are the frozen UI_SPEC `splitMode` vocabulary.
const (
	// SplitAuto asks the 2-in-1 heuristic to decide per page.
	SplitAuto = "auto"
	// SplitRowsCols uses evenly spaced lines (rows × cols pieces per page).
	SplitRowsCols = "rows-cols"
	// SplitCustom uses the user's own fractions.
	SplitCustom = "custom"
	// SplitUnsplit means "the heuristic was right, keep the page whole" — the
	// 一键否决 decision (UI_SPEC §2.3). It is a mode rather than a boolean so
	// the vocabulary stays the single thing UI, settings file and route share.
	SplitUnsplit = "unsplit"
)

// AutoSpreadRatio is the width/height threshold a page must exceed (on top of
// being wider than tall) to count as a 2-in-1 scan. docs/FACTS.md §6 keeps it
// as a heuristic, not a guarantee; real-scan behaviour is asserted in the
// acceptance test.
const AutoSpreadRatio = 0.7

// SplitSpec is one auto-split request.
//
// CustomCuts fractions are 0..1; a leading "x" marks a vertical line (cutting
// left/right), an unprefixed value is horizontal (cutting top/bottom). The UI
// emits exactly that form in its 切点 chip.
type SplitSpec struct {
	Mode       string
	Rows       int
	Cols       int
	CustomCuts []string
	Veto       bool  // only meaningful with Mode == SplitAuto
	VetoPages  []int // per-page veto (decision D3): page numbers the user un-checked
	Pages      []int // api.split.pages: the pages eligible for cutting (empty = all)
}

// vetoed reports whether this page was vetoed by the user. The global Veto
// flag is the 一键否决 answer; VetoPages is the per-page list the chip row
// produces, and both only matter for Mode == SplitAuto.
func (s SplitSpec) vetoed(pageNr int) bool {
	if s.Veto {
		return true
	}
	for _, n := range s.VetoPages {
		if n == pageNr {
			return true
		}
	}
	return false
}

// eligible answers whether this page may be cut at all (api.split.pages
// vocabulary: `all | none | 1-2,5`). A page outside the selection keeps its
// whole form, which is also what 切分页范围 means in the UI.
func (s SplitSpec) eligible(pageNr int) bool {
	if len(s.Pages) == 0 {
		return true
	}
	for _, n := range s.Pages {
		if n == pageNr {
			return true
		}
	}
	return false
}

// CutPlan is the resolved set of cut lines for one page, in **display space**
// (what the user sees after /Rotate is applied).
type CutPlan struct {
	Vert []float64 // vertical lines: x positions, splitting left/right
	Hor  []float64 // horizontal lines: y positions, splitting top/bottom
}

func (p CutPlan) empty() bool { return len(p.Vert) == 0 && len(p.Hor) == 0 }

// Pieces returns how many page pieces one page becomes under this plan.
func (p CutPlan) Pieces() int { return (len(p.Vert) + 1) * (len(p.Hor) + 1) }

// PageIsSpread reports whether a page looks like a 2-in-1 scan: wider than
// tall *after* applying /Rotate, by at least AutoSpreadRatio. A 595x842 page
// with /Rotate 90 displays landscape, so rotation must be part of the test
// (UI_SPEC §2.3's 横排 condition).
func PageIsSpread(pg Page) bool {
	w, h := pg.Width, pg.Height
	if pg.Rotation%180 != 0 {
		w, h = h, w
	}
	if h <= 0 {
		return false
	}
	return w > h && w/h >= AutoSpreadRatio
}

// CutPlanForPage is the display-space plan, passed through unchanged: pdfcpu
// cuts in the page's **rotation-normalized** space, so a display vertical cut
// (left/right of the spread the user sees) is a `Vert` line even for a page
// that carries /Rotate 90. Measured 2026-10-29 (`_scratch` probe, then
// asserted in TestSplitAutoCutsRotatedSpreadOnly): a 595x842 page with
// /Rotate 90 comes back as 842x595 with rot=0, and the two pieces of a
// `Vert: [0.5]` cut are 421x595 each.
//
// This is the identity mapping on purpose — the day someone is tempted to
// swap the axes by rotation, this comment is the evidence that says don't.
func CutPlanForPage(spec SplitSpec, pg Page) (CutPlan, error) { return PlanForSplit(spec, pg) }

// PlanForSplit resolves a request against one page's geometry.
func PlanForSplit(spec SplitSpec, pg Page) (CutPlan, error) {
	switch spec.Mode {
	case "", SplitUnsplit:
		return CutPlan{}, nil
	case SplitAuto:
		if !spec.eligible(pg.Number) || spec.vetoed(pg.Number) || !PageIsSpread(pg) {
			return CutPlan{}, nil
		}
		return CutPlan{Vert: []float64{0.5}}, nil
	case SplitRowsCols:
		if !spec.eligible(pg.Number) {
			return CutPlan{}, nil
		}
		rows, cols := spec.Rows, spec.Cols
		if rows < 1 {
			rows = 1
		}
		if cols < 1 {
			cols = 1
		}
		return CutPlan{Hor: evenCuts(rows), Vert: evenCuts(cols)}, nil
	case SplitCustom:
		var p CutPlan
		for _, c := range spec.CustomCuts {
			s := strings.TrimSpace(c)
			if s == "" {
				continue
			}
			vertical := strings.HasPrefix(s, "x")
			f, err := strconv.ParseFloat(strings.TrimPrefix(s, "x"), 64)
			if err != nil {
				return CutPlan{}, fmt.Errorf("切点 %q 不是 0..1 的分数", s)
			}
			if f <= 0 || f >= 1 {
				return CutPlan{}, fmt.Errorf("切点 %g 必须在 0 与 1 之间", f)
			}
			if vertical {
				p.Vert = append(p.Vert, f)
			} else {
				p.Hor = append(p.Hor, f)
			}
		}
		sortFloats(p.Vert)
		sortFloats(p.Hor)
		return p, nil
	default:
		return CutPlan{}, fmt.Errorf("未知的 splitMode %q", spec.Mode)
	}
}

func sortFloats(xs []float64) {
	for i := 1; i < len(xs); i++ {
		for j := 0; j < len(xs)-i; j++ {
			if xs[j] > xs[j+1] {
				xs[j], xs[j+1] = xs[j+1], xs[j]
			}
		}
	}
}

// evenCuts returns n-1 evenly spaced fractions for an n-piece axis.
func evenCuts(n int) []float64 {
	if n < 2 {
		return nil
	}
	out := make([]float64, 0, n-1)
	step := 1 / float64(n)
	for i := 1; i < n; i++ {
		out = append(out, float64(i)*step)
	}
	return out
}

// SplitOnePage cuts page (1-based) of srcPath and returns the trimmed
// single-page pieces in reading order.
//
// The shapes pdfcpu actually produces (docs/FACTS.md §2.3, re-measured):
//
//   - `api.CutFile` writes **one file per selected page**, named
//     `<outFile>_page_<n>.pdf`, and that file contains the original page plus
//     every piece — for a two-piece A4 cut its page count is 3.
//   - `api.ExtractPagesFile` then writes `<inBase>_page_<n>.pdf` files into an
//     outDir, one per selected page, so trimming means extracting pages
//     2..n+1 of the cut file and keeping those files.
//
// Piece order inside the cut file is the reading order pdfcpu produces
// (left→right, top→bottom), which is why extracting by ascending page number
// keeps the strip order the cross-page stamp relies on.
func SplitOnePage(ctx context.Context, srcPath string, page int, plan CutPlan, workDir, base string) ([]string, error) {
	if plan.empty() {
		return nil, fmt.Errorf("切分计划为空")
	}
	cutDir := filepath.Join(workDir, base)
	if err := os.MkdirAll(cutDir, 0o755); err != nil {
		return nil, err
	}
	cut := &model.Cut{Hor: plan.Hor, Vert: plan.Vert}
	if err := api.CutFile(ctx, srcPath, cutDir, base, []string{strconv.Itoa(page)}, cut, DefaultLimits()); err != nil {
		return nil, fmt.Errorf("切分第 %d 页: %w", page, err)
	}
	cutFiles, err := filepath.Glob(filepath.Join(cutDir, "*.pdf"))
	if err != nil {
		return nil, err
	}
	if len(cutFiles) != 1 {
		return nil, fmt.Errorf("切分第 %d 页应产出 1 个文件,实际 %d 个", page, len(cutFiles))
	}
	n, err := api.PageCountFile(ctx, cutFiles[0])
	if err != nil {
		return nil, err
	}
	want := plan.Pieces()
	if n != want+1 {
		return nil, fmt.Errorf("切分产物 %s 页数 = %d, want %d(原页 + %d 块)", filepath.Base(cutFiles[0]), n, want+1, want)
	}
	// Drop the original page (page 1 of the cut file) by extracting 2..n.
	trimDir := filepath.Join(workDir, base+"-trim")
	if err := os.MkdirAll(trimDir, 0o755); err != nil {
		return nil, err
	}
	pages := make([]string, 0, want)
	for i := 2; i <= n; i++ {
		pages = append(pages, strconv.Itoa(i))
	}
	if err := api.ExtractPagesFile(ctx, cutFiles[0], trimDir, pages, DefaultLimits()); err != nil {
		return nil, fmt.Errorf("剔除切分产物里的原页: %w", err)
	}
	trimmed, err := filepath.Glob(filepath.Join(trimDir, "*.pdf"))
	if err != nil {
		return nil, err
	}
	if len(trimmed) != want {
		return nil, fmt.Errorf("剔除原页后应剩 %d 块,实际 %d 块", want, len(trimmed))
	}
	sortByPageTail(trimmed)
	return trimmed, nil
}

// sortByPageTail orders `foo_page_10.pdf` after `foo_page_2.pdf`, i.e. by the
// page number in the file name rather than by plain string order.
func sortByPageTail(paths []string) {
	for i := 1; i < len(paths); i++ {
		for j := 0; j < len(paths)-i; j++ {
			if pageTail(paths[j]) > pageTail(paths[j+1]) {
				paths[j], paths[j+1] = paths[j+1], paths[j]
			}
		}
	}
}

func pageTail(p string) int {
	base := filepath.Base(p)
	i := strings.LastIndex(base, "_page_")
	if i < 0 {
		return -1
	}
	n, err := strconv.Atoi(strings.TrimSuffix(base[i+6:], ".pdf"))
	if err != nil {
		return -1
	}
	return n
}

// Split cuts the pages of srcPath according to spec, trims every cut file down
// to its own pieces, and merges the result into outPath in reading order.
// `doc` is the structure the caller already parsed for the open request, which
// is what the auto heuristic reads (per-page MediaBox) — it is required, never
// re-parsed here.
//
// A page the plan leaves alone (the heuristic found no spread, or the user
// vetoed the auto result) still enters the merge as its own one-page file, so
// the output keeps the input's page order.
func Split(ctx context.Context, srcPath, outPath string, spec SplitSpec, doc *Doc) (*Doc, error) {
	if doc == nil {
		return nil, fmt.Errorf("切分需要已解析的文档结构")
	}
	work, err := os.MkdirTemp("", "autostamp-split-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(work)

	var order []string
	for i, pg := range doc.Pages {
		page := i + 1
		plan, err := CutPlanForPage(spec, pg)
		if err != nil {
			return nil, err
		}
		if plan.empty() {
			dir := filepath.Join(work, fmt.Sprintf("page-%03d", page))
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return nil, err
			}
			if err := api.ExtractPagesFile(ctx, srcPath, dir, []string{strconv.Itoa(page)}, DefaultLimits()); err != nil {
				return nil, fmt.Errorf("第 %d 页不需要切分,抽取失败: %w", page, err)
			}
			names, err := filepath.Glob(filepath.Join(dir, "*.pdf"))
			if err != nil {
				return nil, err
			}
			if len(names) != 1 {
				return nil, fmt.Errorf("第 %d 页整页抽取应产出 1 个文件,实际 %d 个", page, len(names))
			}
			order = append(order, names[0])
			continue
		}
		pieces, err := SplitOnePage(ctx, srcPath, page, plan, work, fmt.Sprintf("page-%03d", page))
		if err != nil {
			return nil, err
		}
		order = append(order, pieces...)
	}
	if len(order) == 0 {
		return nil, fmt.Errorf("切分没有产出任何页")
	}
	if err := api.MergeCreateFile(ctx, order, outPath, false, DefaultLimits()); err != nil {
		return nil, fmt.Errorf("合并切分块: %w", err)
	}

	f, err := os.Open(outPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return Inspect(ctx, f, DefaultLimits())
}
