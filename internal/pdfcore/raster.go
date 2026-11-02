// Package pdfcore — P5 raster export writer (AGENTS §5.10, FACTS §4): this
// file assembles the whole-page bitmaps the front-end rendered (pdf.js) into
// a plain full-page-image PDF, using only the stdlib.
//
// 两条契约红线：
//
//   - 不做任何旋转量：前端回传的位图已经是 pdf.js 显示方向的图
//     （getViewport 的输出）。这与 AGENTS §5.17 落盘坐标同理 —— 显示空间
//     直接写进 /MediaBox 和内容流的 cm，不加 /Rotate、不翻转。
//   - 这是手写的经典 PDF：无对象流、无 /Info；xref 偏移、/Length、
//     /Size、startxref、%%EOF 全部精确。/Length 精确还有一层意义：JPEG
//     流是任意二进制，读取方必须按 /Length 截取，不能靠 endstream 关键字。
//
// JPEG 输入按 /DCTDecode 原始字节直传（不重编码，FACTS §4 同款做法）；
// PNG 及其它非 JPEG 输入解码后以 /FlateDecode 写 zlib 压缩的 raw
// scanlines（每行前置一个 filter 字节 0），带 alpha 时另写 /SMask 灰度平面。
package pdfcore

import (
	"bytes"
	"compress/zlib"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"strconv"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/api"
)

// pngHeader is the PNG magic; page bitmaps are told apart by magic bytes, not
// by the multipart part's declared Content-Type (a mislabeled part still
// embeds fine through whichever path its bytes need).
var pngHeader = []byte("\x89PNG\r\n\x1a\n")

// RasterPage is one page bitmap the front-end posted back for raster export.
// Data is the uploaded bytes exactly as received.
type RasterPage struct {
	Number int    // the source page number (1-based), for error messages only
	Data   []byte // JPEG (preferred) or PNG bitmap of the whole page
}

// RasterOptions carries the export parameters the writer needs. Quality is
// deliberately absent: the front-end already encoded the JPEG at that
// quality, and the writer must not re-encode.
type RasterOptions struct {
	Dpi int // resolved export DPI (96..600); the caller clamps, the writer divides by it
}

// pageBitmap is one page prepared for writing: dims in pixels plus either the
// untouched JPEG bytes (dct) or the zlib-compressed RGB scanlines (rgb) and,
// for translucent PNGs, the compressed 8-bit gray alpha plane (mask).
type pageBitmap struct {
	pxW, pxH int
	dct      []byte
	rgb      []byte
	mask     []byte
	hasAlpha bool
}

// WriteRaster writes a complete PDF with one full-page image per entry of
// pages, in order. The catalog and page tree get the highest object numbers
// and are written at the end of the file — legal PDF (readers walk the xref,
// not the byte order), and it lets the writer number objects gaplessly
// without knowing up front how many /SMask objects the PNG pages will need.
func WriteRaster(w io.Writer, pages []RasterPage, opts RasterOptions) error {
	if opts.Dpi <= 0 {
		return fmt.Errorf("raster: dpi 必须是正数，得到 %d", opts.Dpi)
	}
	if len(pages) == 0 {
		return fmt.Errorf("raster: 没有可写入的页")
	}

	// Prepare every page first: the PNG path needs the pixel walk to know
	// whether an /SMask object exists, and gapless object numbering needs
	// that answer before any object reference is written.
	prep := make([]pageBitmap, len(pages))
	for i, p := range pages {
		if len(p.Data) == 0 {
			return fmt.Errorf("第 %d 页没有位图数据", p.Number)
		}
		pb, err := preparePageBitmap(p.Data)
		if err != nil {
			return fmt.Errorf("第 %d 页: %w", p.Number, err)
		}
		prep[i] = *pb
	}

	// Object layout: catalog=1, page tree=2, then per page [page, contents,
	// image, smask?] in order. The prep pass already knows every page's alpha
	// state, so all object numbers — and therefore the /Kids list — are
	// known before the first byte is written.
	catalog, tree := 1, 2
	n := tree
	type slot struct{ page, cont, img, mask int }
	slots := make([]slot, len(prep))
	for i, pp := range prep {
		slots[i] = slot{page: n + 1, cont: n + 2, img: n + 3}
		n += 3
		if pp.hasAlpha {
			slots[i].mask = n + 1
			n++
		}
	}

	var kids strings.Builder
	for i := range slots {
		fmt.Fprintf(&kids, "%d 0 R ", slots[i].page)
	}

	rw := &rasterOut{w: w, offsets: make([]int64, n+1)}
	rw.write([]byte("%PDF-1.7\n"))
	rw.beginObj(catalog)
	rw.printf("<< /Type /Catalog /Pages %d 0 R >>\nendobj\n", tree)
	rw.beginObj(tree)
	rw.printf("<< /Type /Pages /Kids [%s] /Count %d >>\nendobj\n", strings.TrimRight(kids.String(), " "), len(slots))
	for i, pp := range prep {
		s := slots[i]
		wpt := ptString(pp.pxW, opts.Dpi)
		hpt := ptString(pp.pxH, opts.Dpi)
		content := fmt.Sprintf("q %s 0 0 %s 0 0 cm /Im0 Do Q", wpt, hpt)

		// No /Rotate on purpose: the bitmap is already in display
		// orientation (file comment, AGENTS §5.17).
		rw.beginObj(s.page)
		rw.printf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %s %s] /Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>\nendobj\n", wpt, hpt, s.img, s.cont)

		rw.beginObj(s.cont)
		rw.printf("<< /Length %d >>\n", len(content))
		rw.stream([]byte(content))

		filter, data := "/FlateDecode", pp.rgb
		if pp.dct != nil {
			filter, data = "/DCTDecode", pp.dct
		}
		smask := ""
		if pp.hasAlpha {
			smask = fmt.Sprintf(" /SMask %d 0 R", s.mask)
		}
		rw.beginObj(s.img)
		rw.printf("<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter %s%s /Length %d >>\n",
			pp.pxW, pp.pxH, filter, smask, len(data))
		rw.stream(data)

		if pp.hasAlpha {
			rw.beginObj(s.mask)
			rw.printf("<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length %d >>\n",
				pp.pxW, pp.pxH, len(pp.mask))
			rw.stream(pp.mask)
		}
	}

	// Classic xref table: 20-byte entries, free head, exact trailer.
	xrefOff := rw.off
	rw.printf("xref\n0 %d\n", n+1)
	rw.printf("0000000000 65535 f \n")
	for k := 1; k <= n; k++ {
		rw.printf("%010d 00000 n \n", rw.offsets[k])
	}
	rw.printf("trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n", n+1, catalog, xrefOff)
	return rw.err
}

// rasterOut writes the PDF while recording every object's byte offset.
type rasterOut struct {
	w       io.Writer
	off     int64
	offsets []int64
	err     error
}

func (rw *rasterOut) printf(format string, args ...any) {
	if rw.err != nil {
		return
	}
	n, err := fmt.Fprintf(rw.w, format, args...)
	rw.off += int64(n)
	if err != nil {
		rw.err = err
	}
}

func (rw *rasterOut) write(p []byte) {
	if rw.err != nil {
		return
	}
	n, err := rw.w.Write(p)
	rw.off += int64(n)
	if err != nil {
		rw.err = err
	}
}

func (rw *rasterOut) beginObj(num int) {
	rw.offsets[num] = rw.off
	rw.printf("%d 0 obj\n", num)
}

// stream writes "stream\n" + data + "\nendstream\nendobj\n". /Length counts
// exactly the data bytes; the EOL before endstream is not stream content.
func (rw *rasterOut) stream(data []byte) {
	rw.printf("stream\n")
	rw.write(data)
	rw.printf("\nendstream\nendobj\n")
}

// preparePageBitmap sniffs the bitmap format and produces the PDF payloads.
func preparePageBitmap(data []byte) (*pageBitmap, error) {
	switch {
	case len(data) >= 2 && data[0] == 0xFF && data[1] == 0xD8:
		cfg, err := jpeg.DecodeConfig(bytes.NewReader(data))
		if err != nil {
			return nil, fmt.Errorf("不是可解码的 JPEG: %w", err)
		}
		// 前端 canvas.toBlob('image/jpeg') 产出 3 分量 JPEG，按 /DeviceRGB
		// 声明直传（FACTS §4 的 writer 同款，pdf.js 渲染正确）。
		return &pageBitmap{pxW: cfg.Width, pxH: cfg.Height, dct: data}, nil
	case bytes.HasPrefix(data, pngHeader):
		img, err := png.Decode(bytes.NewReader(data))
		if err != nil {
			return nil, fmt.Errorf("不是可解码的 PNG: %w", err)
		}
		return pngToPlanes(img)
	default:
		return nil, fmt.Errorf("页面位图既不是 JPEG 也不是 PNG")
	}
}

// pngToPlanes converts a decoded PNG into the PDF image payloads: zlib
// compressed RGB scanlines (each row prefixed by filter byte 0) and, when any
// pixel is translucent, an 8-bit gray alpha plane for /SMask. *image.NRGBA
// gets a direct path; every other model (RGBA is premultiplied, paletted may
// carry tRNS) goes through color.NRGBAModel so the written RGB is straight,
// never premultiplied.
func pngToPlanes(img image.Image) (*pageBitmap, error) {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= 0 || h <= 0 {
		return nil, fmt.Errorf("PNG 尺寸为 0")
	}
	src, direct := img.(*image.NRGBA)
	rgb := make([]byte, 0, h*(1+w*3))
	mask := make([]byte, 0, h*(1+w))
	hasAlpha := false
	row := make([]byte, 0, 1+w*3)
	arow := make([]byte, 0, 1+w)
	for y := b.Min.Y; y < b.Max.Y; y++ {
		row = append(row[:0], 0)
		arow = append(arow[:0], 0)
		for x := b.Min.X; x < b.Max.X; x++ {
			var c color.NRGBA
			if direct {
				i := src.PixOffset(x, y)
				c = color.NRGBA{src.Pix[i], src.Pix[i+1], src.Pix[i+2], src.Pix[i+3]}
			} else {
				c = color.NRGBAModel.Convert(img.At(x, y)).(color.NRGBA)
			}
			row = append(row, c.R, c.G, c.B)
			arow = append(arow, c.A)
			if c.A != 0xFF {
				hasAlpha = true
			}
		}
		rgb = append(rgb, row...)
		mask = append(mask, arow...)
	}
	out := &pageBitmap{pxW: w, pxH: h, hasAlpha: hasAlpha}
	var err error
	if out.rgb, err = flateBytes(rgb); err != nil {
		return nil, err
	}
	if hasAlpha {
		if out.mask, err = flateBytes(mask); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// flateBytes zlib-compresses raw scanlines: PDF /FlateDecode expects the zlib
// wrapper (RFC 1950), which is exactly what compress/zlib produces.
func flateBytes(raw []byte) ([]byte, error) {
	var buf bytes.Buffer
	zw := zlib.NewWriter(&buf)
	if _, err := zw.Write(raw); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// ptString renders a pixel length at dpi as PostScript points with exactly
// two decimals (contract: 1239px @ 150dpi ⇒ "594.72").
func ptString(px, dpi int) string {
	return strconv.FormatFloat(float64(px)*72/float64(dpi), 'f', 2, 64)
}

// TrimPages writes the one-file page subset the vector export route serves.
// pdfcpu's api.ExtractPagesFile hands back one single-page PDF per page into
// a directory, while the export route needs ONE subset asset — exactly what
// api.Trim produces (it runs pdfcpu.ExtractPages internally and writes a
// single output). Limits are DefaultLimits, like every other pdfcpu call.
func TrimPages(ctx context.Context, src io.ReadSeeker, dst io.Writer, pages []int) error {
	sel := make([]string, 0, len(pages))
	for _, n := range pages {
		sel = append(sel, strconv.Itoa(n))
	}
	return api.Trim(ctx, src, dst, sel, DefaultLimits())
}
