// Command genfix renders the mock fixtures used by docs/ui/mockup.html.
//
// It is a stdlib-only probe (no dependency on the AutoStamp module, which
// exists in P0): docs/ui/ assets are design artifacts and must not depend on
// P1 having shipped. Output:
//
//	docs/ui/fixtures/page.png   A4 page bitmap (595.3x841.9 pt at 150 dpi)
//	docs/ui/fixtures/seal.png   red RGBA seal with alpha (260x260 px)
//
// Run from the repository root:
//
//	go run ./tools/genfix              # writes docs/ui/fixtures/{page.png,seal.png}
//	go run ./tools/genfix -scale 2     # supersample factor for edge quality (1..4)
package main

import (
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"log"
	"math"
	"os"
	"path/filepath"
)

const (
	dpi           = 150 // fixture raster density: 595.3pt/72*150 = 1240 px wide
	pageWpt       = 595.3
	pageHpt       = 841.9
	sealPx        = 260 // seal canvas size in px (matches seal.png)
	sealPtDefault = 120 // nominal printed seal size in pt (mock scale = 120/595)
)

// isRepo 判定 dir 是否为 AutoStamp 仓库根（AGENTS.md + docs/ 同时存在）。
func isRepo(dir string) bool {
	fi, err := os.Stat(filepath.Join(dir, "AGENTS.md"))
	if err != nil || fi.IsDir() {
		return false
	}
	d, err := os.Stat(filepath.Join(dir, "docs"))
	return err == nil && d.IsDir()
}

// fixtureDir 解析素材输出目录：位置参数优先，否则从可执行文件所在目录向上找仓库根
// （双击 dist\genfix.exe 时 cwd = dist\，不能把素材写进 dist\），最后回退到 cwd。
func fixtureDir(explicit string) (string, error) {
	if explicit != "" {
		abs, err := filepath.Abs(explicit)
		if err != nil {
			return "", err
		}
		return abs, nil
	}
	exe, err := os.Executable()
	if err != nil {
		exe = "."
	}
	for dir := filepath.Dir(exe); ; {
		if isRepo(dir) {
			return filepath.Join(dir, "docs", "ui", "fixtures"), nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	if isRepo(".") {
		abs, err := filepath.Abs("docs")
		if err != nil {
			return "", err
		}
		return filepath.Join(abs, "ui", "fixtures"), nil
	}
	return "", fmt.Errorf("找不到 AutoStamp 仓库根（需 AGENTS.md 与 docs/）；请在仓库根运行: powershell -NoProfile -File build.ps1 -Task fixtures")
}

func main() {
	var scale int
	flag.IntVar(&scale, "scale", 3, "supersample factor 1..4 (edge quality)")
	flag.Parse()
	if scale < 1 || scale > 4 {
		log.Fatalf("-scale must be 1..4")
	}
	dir, err := fixtureDir(flag.Arg(0))
	if err != nil {
		log.Fatalf("%v", err)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		log.Fatalf("mkdir %s: %v", dir, err)
	}

	page, err := buildPage(scale)
	if err != nil {
		log.Fatalf("page.png: %v", err)
	}
	if err := writePNG(filepath.Join(dir, "page.png"), page); err != nil {
		log.Fatalf("write page.png: %v", err)
	}

	seal, err := buildSeal(scale)
	if err != nil {
		log.Fatalf("seal.png: %v", err)
	}
	if err := writePNG(filepath.Join(dir, "seal.png"), seal); err != nil {
		log.Fatalf("write seal.png: %v", err)
	}

	pw, ph := page.Bounds().Dx(), page.Bounds().Dy()
	fmt.Printf("page.png %d x %d px (%.1f x %.1f pt @ %d dpi)\n", pw, ph, pageWpt, pageHpt, dpi)
	fmt.Printf("seal.png %d x %d px (nominal print %d pt)\n", sealPx, sealPx, sealPtDefault)
	fmt.Printf("supersample=%d dir=%s\n", scale, dir)
}

// writePNG writes img to path.
func writePNG(path string, img image.Image) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	enc := png.Encoder{CompressionLevel: png.BestCompression}
	return enc.Encode(f, img)
}

// ---------------------------------------------------------------- coverage

// coverage quantizes a [0,1] sample to 8-bit alpha.
func coverage(c float64) uint8 {
	if c < 0 {
		c = 0
	}
	if c > 1 {
		c = 1
	}
	return uint8(math.Round(c * 255))
}

// paint samples shape(fx,fy) at the pixel deviceX,deviceY using ss x ss
// supersampling and composites flat col over dst with that coverage.
func paint(dst *image.RGBA, deviceX, deviceY int, shape func(fx, fy float64) float64, col color.RGBA, ss int) {
	const half = 0.5
	var a uint8
	if ss <= 1 {
		a = coverage(shape(float64(deviceX)+half, float64(deviceY)+half))
	} else {
		step := 1.0 / float64(ss)
		var sum float64
		for k := range ss {
			fy := float64(deviceY) + (float64(k)+half)*step
			for m := range ss {
				fx := float64(deviceX) + (float64(m)+half)*step
				sum += shape(fx, fy)
			}
		}
		a = coverage(sum / float64(ss*ss))
	}
	if a == 0 {
		return
	}
	b := dst.At(deviceX, deviceY)
	c0, _ := b.(color.RGBA)
	af := float64(a) / 255
	dst.Set(deviceX, deviceY, color.RGBA{
		R: uint8(math.Round(float64(col.R)*af + float64(c0.R)*(1-af))),
		G: uint8(math.Round(float64(col.G)*af + float64(c0.G)*(1-af))),
		B: uint8(math.Round(float64(col.B)*af + float64(c0.B)*(1-af))),
		A: coverage(float64(c0.A)/255 + af*(1-float64(c0.A)/255)),
	})
}

// scan fills the device-space bounding box [x0,x1) x [y0,y1) with flat col,
// delegating per-pixel coverage to shape (antialiased by supersampling).
func scan(dst *image.RGBA, x0, y0, x1, y1 float64, shape func(fx, fy float64) float64, col color.RGBA, ss int) {
	// classic loops: non-zero start, so the range-int form does not apply
	for y := int(math.Floor(y0)); y < int(math.Ceil(y1)); y++ {
		for x := int(math.Floor(x0)); x < int(math.Ceil(x1)); x++ {
			paint(dst, x, y, shape, col, ss)
		}
	}
}

// fillRect paints an axis-aligned device-space rect with flat col.
func fillRect(dst *image.RGBA, x0, y0, x1, y1 float64, col color.RGBA, ss int) {
	scan(dst, x0, y0, x1, y1, func(fx, fy float64) float64 {
		if fx >= x0 && fx < x1 && fy >= y0 && fy < y1 {
			return 1
		}
		return 0
	}, col, ss)
}

// fillRing paints an annulus [ri,ro] with flat col; edges ramp over ~1px.
func fillRing(dst *image.RGBA, cx, cy, ri, ro float64, col color.RGBA, ss int) {
	scan(dst, cx-ro-2, cy-ro-2, cx+ro+3, cy+ro+3, func(fx, fy float64) float64 {
		d := math.Hypot(fx-cx, fy-cy)
		outer := clamp01(ro + 1.5 - d)
		inner := clamp01(d - ri + 0.5)
		return outer * inner
	}, col, ss)
}

// inPolygon is the standard ray-crossing inside test.
func inPolygon(pts [][2]float64, x, y float64) bool {
	in := false
	for i := range pts {
		a, b := pts[i], pts[(i+1)%len(pts)]
		if (a[1] > y) != (b[1] > y) {
			xi := a[0] + (y-a[1])*(b[0]-a[0])/(b[1]-a[1])
			if x < xi {
				in = !in
			}
		}
	}
	return in
}

// starPoints returns the 10 vertices of a 5-pointed star (outer ro, inner ri)
// with one tip at angle rot (radians, counter-clockwise from +x).
func starPoints(cx, cy, ro, ri, rot float64) [][2]float64 {
	const points = 5
	pts := make([][2]float64, 0, 2*points)
	for k := range points {
		ao := rot + float64(k)*(2*math.Pi/points)
		ai := ao + math.Pi/points
		pts = append(pts,
			[2]float64{cx + math.Cos(ao)*ro, cy + math.Sin(ao)*ro},
			[2]float64{cx + math.Cos(ai)*ri, cy + math.Sin(ai)*ri})
	}
	return pts
}

// fillStar paints a solid 5-pointed star with flat col (exact polygon fill).
func fillStar(dst *image.RGBA, cx, cy, ro, ri, rot float64, col color.RGBA, ss int) {
	pts := starPoints(cx, cy, ro, ri, rot)
	scan(dst, cx-ro-2, cy-ro-2, cx+ro+3, cy+ro+3, func(fx, fy float64) float64 {
		if inPolygon(pts, fx, fy) {
			return 1
		}
		return 0
	}, col, ss)
}

// fillDisc paints a filled disc of radius r centred at (cx,cy) with flat col.
func fillDisc(dst *image.RGBA, cx, cy, r float64, col color.RGBA, ss int) {
	scan(dst, cx-r-1, cy-r-1, cx+r+2, cy+r+2, func(fx, fy float64) float64 {
		return clamp01(r + 1.0 - math.Hypot(fx-cx, fy-cy))
	}, col, ss)
}

// fillArcDiscs paints n discs of radius barR along an arc from a0 to a1
// (radians, counter-clockwise from +x) at band radius bandR.
func fillArcDiscs(dst *image.RGBA, cx, cy, bandR, a0, a1 float64, n int, barR float64, col color.RGBA, ss int) {
	for i := range n {
		a := a0 + (a1-a0)*float64(i)/float64(n-1)
		fillDisc(dst, cx+math.Cos(a)*bandR, cy-math.Sin(a)*bandR, barR, col, ss)
	}
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

// ---------------------------------------------------------------- page

var (
	white   = color.RGBA{255, 255, 255, 255}
	ink     = color.RGBA{32, 34, 37, 255}
	hair    = color.RGBA{214, 218, 224, 255}
	body    = color.RGBA{96, 101, 108, 255}
	faint   = color.RGBA{170, 175, 182, 255}
	blueish = color.RGBA{217, 230, 255, 255} // FACTS §1.3 multiply-test background
)

// buildPage renders the mock A4 "contract" page bitmap (fake text blocks,
// never legible copy — it is a design fixture, not document content).
func buildPage(scale int) (*image.RGBA, error) {
	pagePxW := pageWpt / 72 * dpi // 1240.21 px
	pagePxH := pageHpt / 72 * dpi // 1753.94 px
	w, h := int(pagePxW+0.5), int(pagePxH+0.5)
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			img.Set(x, y, white)
		}
	}

	// left binding-edge tick column (scan artefact look)
	for _, ty := range []float64{90, 180, 300, 460, 640, 900, 1180, 1400, 1620} {
		fillRect(img, 26, ty, 40, ty+2, hair, scale)
	}

	// title block
	fillRect(img, 120, 96, 520, 152, ink, scale)
	fillRect(img, 120, 172, 420, 188, body, scale)
	fillRect(img, 120, 202, 300, 218, faint, scale)
	// blueish swatch: the exact background used for the FACTS §1.3 pixel test
	fillRect(img, 700, 96, 1120, 190, blueish, scale)
	fillRect(img, 716, 118, 900, 132, body, scale)
	fillRect(img, 716, 146, 1000, 160, body, scale)

	// meta rule + form fields
	fillRect(img, 80, 236, 1160, 238, hair, scale)
	for _, f := range []struct{ x0, x1, y float64 }{
		{210, 470, 276}, {640, 900, 276}, {210, 470, 316}, {640, 900, 316},
	} {
		fillRect(img, f.x0, f.y, f.x1, f.y+1.6, faint, scale)
		fillRect(img, 120, f.y-14, 190, f.y-2, body, scale)
	}

	// body paragraphs: ragged line widths
	y := 380.0
	li := 0
	for range 7 {
		for range 5 {
			li++
			x1 := 1160 - float64((li*37)%240) - 40
			fillRect(img, 120, y, x1, y+13, body, scale)
			y += 26
		}
		y += 22
	}
	fillRect(img, 120, y, 360, y+18, ink, scale)
	y += 40
	for l := range 4 {
		x1 := 1160 - float64((l*91)%180)
		fillRect(img, 120, y, x1, y+13, body, scale)
		y += 26
	}

	// dashed stamp placeholder box (bottom-right) — where the seal lands
	const bx, by, bw, bh = 700.0, 1400.0, 300.0, 240.0
	const seg = 22.0
	for x := bx; x < bx+bw; x += seg * 2 {
		fillRect(img, x, by, minF(x+seg, bx+bw), by+2, faint, scale)
		fillRect(img, x, by+bh, minF(x+seg, bx+bw), by+bh+2, faint, scale)
	}
	for yy := by; yy < by+bh; yy += seg * 2 {
		fillRect(img, bx, yy, bx+2, minF(yy+seg, by+bh), faint, scale)
		fillRect(img, bx+bw, yy, bx+bw+2, minF(yy+seg, by+bh), faint, scale)
	}

	// signature block + footer
	fillRect(img, 120, 1560, 300, 1576, body, scale)
	fillRect(img, 120, 1600, 260, 1601.6, faint, scale)
	fillRect(img, 120, 1640, 340, 1656, body, scale)
	fillRect(img, 80, 1690, 1160, 1692, hair, scale)
	fillRect(img, 600, 1706, 640, 1720, faint, scale)

	return img, nil
}

func minF(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

// ---------------------------------------------------------------- seal

// buildSeal renders the alpha-red seal fixture (ring + arc text bands + star).
func buildSeal(scale int) (*image.RGBA, error) {
	img := image.NewRGBA(image.Rect(0, 0, sealPx, sealPx))
	cx, cy := float64(sealPx)/2, float64(sealPx)/2
	red := color.RGBA{200, 24, 28, 255}

	// outer ring + inner hairline
	fillRing(img, cx, cy, 104, 118, red, scale)
	fillRing(img, cx, cy, 96, 99, red, scale)

	// perforated rim: discs straddling the outer edge (real-stamp look)
	for i := range 40 {
		a := float64(i) * math.Pi / 20
		fillDisc(img, cx+math.Cos(a)*119, cy-math.Sin(a)*119, 2.4, red, scale)
	}
	// arc legends: glyph stand-in discs between the rings
	fillArcDiscs(img, cx, cy, 101, 0.20, math.Pi-0.20, 11, 3.2, red, scale)
	fillArcDiscs(img, cx, cy, 111, 0.34, math.Pi-0.34, 9, 2.6, red, scale)
	// straight text bands + centre star + rule lines
	fillRect(img, cx-52, cy+66, cx+52, cy+80, red, scale)
	fillRect(img, cx-30, cy+84, cx+30, cy+94, red, scale)
	fillStar(img, cx, cy-14, 34, 15, -math.Pi/2, red, scale)
	fillRect(img, cx-46, cy+30, cx+46, cy+38, red, scale)
	fillRect(img, cx-30, cy+44, cx+30, cy+50, red, scale)
	return img, nil
}
