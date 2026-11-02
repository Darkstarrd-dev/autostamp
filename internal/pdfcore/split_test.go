package pdfcore

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"testing"
)

// buildSinglePagePDF is the one-page fixture the geometry tests need: a plain
// MediaBox w×h page with an empty content stream.
func buildSinglePagePDF(t *testing.T, w, h float64) []byte {
	t.Helper()
	var b bytes.Buffer
	fmt.Fprintf(&b, "%%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
	fmt.Fprintf(&b, "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 %g %g] /Rotate 0 >>\nendobj\n", w, h)
	b.WriteString("3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n")
	b.WriteString("4 0 obj\n<< /Length 4 >>\nstream\nq Q\nendstream\nendobj\n")
	xref := len(b.String())
	b.WriteString("xref\n0 5\n0000000000 65535 f \n")
	for i := 1; i <= 4; i++ {
		fmt.Fprintf(&b, "%010d 00000 n \n", xref)
	}
	b.WriteString("trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n")
	fmt.Fprintf(&b, "%d\n%%%%EOF\n", len(b.String()))
	return b.Bytes()
}

// writeFixture puts src bytes into a temp file and returns the path plus the
// already-parsed structure (the shape the API layer hands to Split).
func writeFixture(t *testing.T, src []byte) (string, *Doc) {
	t.Helper()
	dir := t.TempDir()
	p := filepath.Join(dir, "src.pdf")
	if err := os.WriteFile(p, src, 0o644); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	doc, err := Inspect(context.Background(), f, DefaultLimits())
	if err != nil {
		t.Fatal(err)
	}
	return p, doc
}

func runSplit(t *testing.T, src []byte, spec SplitSpec) *Doc {
	t.Helper()
	in, doc := writeFixture(t, src)
	out := filepath.Join(t.TempDir(), "split.pdf")
	got, err := Split(context.Background(), in, out, spec, doc)
	if err != nil {
		t.Fatalf("Split(%+v): %v", spec, err)
	}
	// P4 owns internal/pdfcore/validate.go; the cut output is validated with
	// pdfcpu directly in the meantime (AGENTS §5.11 limits).
	if err := api.ValidateFile(context.Background(), out, DefaultLimits(), nil); err != nil {
		t.Fatalf("切分产物没有通过 ValidateFile: %v", err)
	}
	return got
}

func dims(doc *Doc) [][2]float64 {
	out := make([][2]float64, 0, len(doc.Pages))
	for _, p := range doc.Pages {
		out = append(out, [2]float64{p.Width, p.Height})
	}
	return out
}

// AGENTS §8.3 的页尺寸断言。fixture 的第 3 页带 /Rotate 90,pdfcpu 的切分会把
// 旋转折进切块 MediaBox 并把 rotation 归零(实测 2026-10-29,FACTS §2.3):
// 595x842 rot=90 → 切块 842x595 rot=0 → 纵切成 421x595。
func TestSplitA4ToHalves(t *testing.T) {
	got := runSplit(t, buildTestPDF(t), SplitSpec{Mode: SplitRowsCols, Rows: 1, Cols: 2})
	if got.PageCount != 6 {
		t.Fatalf("pageCount = %d, want 6(每页 2 块 × 3 页)", got.PageCount)
	}
	want := [][2]float64{
		{297.5, 842}, {297.5, 842},
		{297.5, 842}, {297.5, 842},
		{421, 595}, {421, 595}, // 第 3 页带 /Rotate 90:归一后按显示方向切
	}
	have := dims(got)
	for i, w := range want {
		if have[i] != w {
			t.Errorf("piece %d dims = %v, want %v", i, have[i], w)
		}
	}
}

// 四拼:每页 4 块,页 1/2 是 [297.5 421],页 3(/Rotate 90)归一后是 [421 297.5]。
func TestSplitQuarterGrid(t *testing.T) {
	got := runSplit(t, buildTestPDF(t), SplitSpec{Mode: SplitRowsCols, Rows: 2, Cols: 2})
	if got.PageCount != 12 {
		t.Fatalf("pageCount = %d, want 12", got.PageCount)
	}
	want := [][2]float64{
		{297.5, 421}, {297.5, 421}, {297.5, 421}, {297.5, 421},
		{297.5, 421}, {297.5, 421}, {297.5, 421}, {297.5, 421},
		{421, 297.5}, {421, 297.5}, {421, 297.5}, {421, 297.5},
	}
	have := dims(got)
	for i, w := range want {
		if have[i] != w {
			t.Errorf("piece %d dims = %v, want %v", i, have[i], w)
		}
	}
}

// 自定义切点:x 前缀 = 纵切(左右),无前缀 = 横切(上下)。只断言块的尺寸
// **集合**:pdfcpu 的行列顺序不在契约里(页内顺序由前端按 reading order 排)。
func TestSplitCustomFractions(t *testing.T) {
	got := runSplit(t, buildSinglePagePDF(t, 595, 842), SplitSpec{Mode: SplitCustom, CustomCuts: []string{"x0.3", "0.25"}})
	if got.PageCount != 4 {
		t.Fatalf("pageCount = %d, want 4(2 列 × 2 行)", got.PageCount)
	}
	want := map[[2]float64]bool{{178.5, 210.5}: true, {416.5, 210.5}: true, {178.5, 631.5}: true, {416.5, 631.5}: true}
	for _, d := range dims(got) {
		if !want[d] {
			t.Errorf("切块尺寸 %v 不在期望集合里", d)
		}
		delete(want, d)
	}
	if len(want) != 0 {
		t.Errorf("缺少切块 %v", want)
	}
}

// fixture 的第 3 页是 /Rotate 90 的横排 2 拼:自动档只该切那一页,切块尺寸
// 归一后是 421x595(pdfcpu 已把旋转折进 MediaBox,所以不需要额外交换轴)。
func TestSplitAutoCutsRotatedSpreadOnly(t *testing.T) {
	got := runSplit(t, buildTestPDF(t), SplitSpec{Mode: SplitAuto})
	if got.PageCount != 4 {
		t.Fatalf("pageCount = %d, want 4(2 页竖排原样 + 1 页横排切成 2 块)", got.PageCount)
	}
	d := dims(got)
	if d[0] != [2]float64{595, 842} || d[1] != [2]float64{595, 842} {
		t.Errorf("前两页应原样, got %v / %v", d[0], d[1])
	}
	for _, piece := range d[2:] {
		if piece[0] != 421 || piece[1] != 595 {
			t.Errorf("横拼切块 dims = %v, want [421 595](pdfcpu 切分已归一化 /Rotate)", piece)
		}
	}
}

// 一键否决(auto + veto)必须完全不切。
func TestSplitAutoVetoKeepsPages(t *testing.T) {
	got := runSplit(t, buildTestPDF(t), SplitSpec{Mode: SplitAuto, Veto: true})
	if got.PageCount != 3 {
		t.Fatalf("pageCount = %d, want 3(veto 必须完全不切)", got.PageCount)
	}
	for i, d := range dims(got) {
		if d != [2]float64{595, 842} {
			t.Errorf("page %d dims = %v, want [595 842]", i, d)
		}
	}
}

// 逐页否决（D3）：只有被点掉的页不切，其余判定页照旧切分。
func TestSplitAutoVetoByPageKeepsOnlyThatPage(t *testing.T) {
	got := runSplit(t, buildTestPDF(t), SplitSpec{Mode: SplitAuto, VetoPages: []int{3}})
	if got.PageCount != 3 {
		t.Fatalf("pageCount = %d, want 3（否决第 3 页后不应切分）", got.PageCount)
	}
	for i, d := range dims(got) {
		if d == [2]float64{210.5, 595} || d == [2]float64{421.5, 595} {
			t.Errorf("page %d was cut (%v) although it was vetoed", i, d)
		}
	}
	if d := dims(got)[2]; d[0] != 595 || d[1] != 842 {
		t.Errorf("vetoed page dims = %v, want the untouched 595x842 spread (rotated)", d)
	}
	if got.Pages[2].Rotation != 90 {
		t.Errorf("vetoed page rotation = %d, want 90（否决不应改动页的旋转）", got.Pages[2].Rotation)
	}

	// 否决一个没有被判定为 2 拼的页：切分结果不变。
	kept := runSplit(t, buildTestPDF(t), SplitSpec{Mode: SplitAuto, VetoPages: []int{1}})
	if kept.PageCount != 4 {
		t.Errorf("pageCount = %d, want 4（第 1 页本来就不切，否决它不改变结果）", kept.PageCount)
	}
}

// 切分页范围（api.split.pages）：只有所在页参与切分，其余页原样进入结果。
func TestSplitPagesSelectsCuttablePages(t *testing.T) {
	got := runSplit(t, buildTestPDF(t), SplitSpec{Mode: SplitRowsCols, Rows: 2, Cols: 1, Pages: []int{1}})
	d := dims(got)
	if len(d) != 4 { // page 1 -> 2 halves, pages 2+3 whole
		t.Fatalf("pageCount = %d, want 4: %v", len(d), d)
	}
	for _, piece := range d[:2] {
		if piece[0] != 595 || piece[1] != 421 {
			t.Errorf("page-1 half = %v, want [595 421]", piece)
		}
	}
	for _, piece := range d[2:] {
		if piece != [2]float64{595, 842} {
			t.Errorf("untouched page = %v, want [595 842]", piece)
		}
	}

	// auto 的选择范围不含 2 拼页时：完全不切。
	kept := runSplit(t, buildTestPDF(t), SplitSpec{Mode: SplitAuto, Pages: []int{1, 2}})
	if kept.PageCount != 3 {
		t.Errorf("pageCount = %d, want 3（2 拼页不在选择范围就不切）", kept.PageCount)
	}
}

func TestSplitRejectsUnknownMode(t *testing.T) {
	in, doc := writeFixture(t, buildTestPDF(t))
	out := filepath.Join(t.TempDir(), "split.pdf")
	if _, err := Split(context.Background(), in, out, SplitSpec{Mode: "sideways"}, doc); err == nil || !bytes.Contains([]byte(err.Error()), []byte("splitMode")) {
		t.Fatalf("err = %v, want it to name splitMode", err)
	}
}

// 切分产物的文件名带 `_page_<n>`,10 必须排在 2 之后(纯字符串序会反过来)。
func TestSortByPageTailOrdersNumericTails(t *testing.T) {
	got := []string{"/d/page-10_page_10.pdf", "/d/page-1_page_2.pdf", "/d/page-2_page_1.pdf"}
	sortByPageTail(got)
	want := []string{"/d/page-2_page_1.pdf", "/d/page-1_page_2.pdf", "/d/page-10_page_10.pdf"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("sorted = %v, want %v", got, want)
		}
	}
}

// 实测(FACTS §2.3,2026-10-29):pdfcpu 的 Cut 在「旋转归一后」的空间里做 ——
// 595x842 且 /Rotate 90 的页,切完的块是 842x595 且 rot=0。也就是说 display
// 的纵切永远是 `Vert`,不需要按 /Rotate 交换轴。这条断言锁死那个事实:
// 谁要是想在这里发明轴交换,几何就会切错方向(切块会变成 842x297.5)。
func TestCutPlanForPageKeepsDisplayAxes(t *testing.T) {
	rotated := Page{Width: 595, Height: 842, Rotation: 90} // displays as 842x595
	plan, err := CutPlanForPage(SplitSpec{Mode: SplitAuto}, rotated)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Vert) != 1 || len(plan.Hor) != 0 {
		t.Fatalf("plan = %+v, want one display vertical line (Vert), no axis swap", plan)
	}
}
