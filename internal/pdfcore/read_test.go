package pdfcore

import (
	"bytes"
	"context"
	"fmt"
	"strconv"
	"strings"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

// buildTestPDF assembles a 3-page document with real byte offsets:
//   - /MediaBox and /Rotate live on the /Pages node (inherited)
//   - page 1 has a font resource, page 2 an image XObject, page 3 has no
//     resources and overrides /Rotate to 90
//
// The geometry is A4 (595x842) because that is the shape every later stage
// asserts on (AGENTS §8.2).
func buildTestPDF(t *testing.T) []byte {
	t.Helper()
	objs := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 /MediaBox [0 0 595 842] /Rotate 0 >>",
		"<< /Type /Page /Parent 2 0 R /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> /ProcSet [/PDF /Text] >> >>",
		"<< /Type /Page /Parent 2 0 R /Contents 6 0 R /Resources << /XObject << /Im1 8 0 R >> /ProcSet [/PDF /Image] >> >>",
		"<< /Type /Page /Parent 2 0 R /Contents 6 0 R /Rotate 90 >>",
		"<< /Length 4 >>\nstream\nq Q\nendstream",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		"<< /Length 12 /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 >>\nstream\n000000000000\nendstream",
	}
	var b bytes.Buffer
	b.WriteString("%PDF-1.7\n")
	offsets := make([]int, len(objs)+1)
	for i, body := range objs {
		nr := i + 1
		offsets[nr] = b.Len()
		b.WriteString(strconv.Itoa(nr) + " 0 obj\n" + body + "\nendobj\n")
	}
	xref := b.Len()
	b.WriteString("xref\n0 " + strconv.Itoa(len(objs)+1) + "\n0000000000 65535 f \n")
	for nr := 1; nr <= len(objs); nr++ {
		fmt.Fprintf(&b, "%010d 00000 n \n", offsets[nr])
	}
	b.WriteString("trailer\n<< /Size " + strconv.Itoa(len(objs)+1) + " /Root 1 0 R >>\nstartxref\n" +
		strconv.Itoa(xref) + "\n%%EOF\n")
	return b.Bytes()
}

func TestInspectStructure(t *testing.T) {
	pdf := buildTestPDF(t)
	doc, err := Inspect(context.Background(), bytes.NewReader(pdf), nil)
	if err != nil {
		t.Fatalf("Inspect: %v", err)
	}
	if doc.PageCount != 3 || len(doc.Pages) != 3 {
		t.Fatalf("page count = %d, pages = %d", doc.PageCount, len(doc.Pages))
	}
	if doc.Version == "" {
		t.Error("version not reported")
	}
	if doc.Encrypted {
		t.Error("plaintext document reported as encrypted")
	}
	for i, p := range doc.Pages {
		if p.Number != i+1 {
			t.Errorf("page %d has number %d", i+1, p.Number)
		}
		if p.Width != 595 || p.Height != 842 {
			t.Errorf("page %d size = %vx%v, want 595x842 inherited from the /Pages node", i+1, p.Width, p.Height)
		}
	}
	if got := doc.Pages[2].Rotation; got != 90 {
		t.Errorf("page 3 rotation = %d, want 90 (leaf overrides the inherited 0)", got)
	}
	if doc.Pages[0].Rotation != 0 || doc.Pages[1].Rotation != 0 {
		t.Errorf("pages 1-2 rotation = %d, %d, want the inherited 0", doc.Pages[0].Rotation, doc.Pages[1].Rotation)
	}
	if !doc.Pages[0].HasFonts || doc.Pages[0].HasXObject {
		t.Errorf("page 1 hints = fonts:%v xobj:%v, want fonts:true xobj:false", doc.Pages[0].HasFonts, doc.Pages[0].HasXObject)
	}
	if !doc.Pages[1].HasXObject || doc.Pages[1].HasFonts {
		t.Errorf("page 2 hints = fonts:%v xobj:%v, want fonts:false xobj:true", doc.Pages[1].HasFonts, doc.Pages[1].HasXObject)
	}
	if doc.Pages[2].HasFonts || doc.Pages[2].HasXObject {
		t.Error("page 3 declares no resources, so both hints must be false")
	}
}

func TestInspectRejectsGarbage(t *testing.T) {
	if _, err := Inspect(context.Background(), strings.NewReader("not a pdf at all"), nil); err == nil {
		t.Fatal("Inspect accepted a non-PDF stream")
	}
}

func TestInspectNilReader(t *testing.T) {
	if _, err := Inspect(context.Background(), nil, nil); err == nil {
		t.Fatal("Inspect accepted a nil reader")
	}
}

func TestNormalizeRotation(t *testing.T) {
	for in, want := range map[int]int{0: 0, 90: 90, 270: 270, 360: 0, -90: 270, -270: 90, 45: 45} {
		if got := normalizeRotation(in); got != want {
			t.Errorf("normalizeRotation(%d) = %d, want %d", in, got, want)
		}
	}
}

func TestDefaultLimitsAreTighter(t *testing.T) {
	conf := DefaultLimits()
	def := model.DefaultResourceLimits()
	if conf.Limits.MaxImageBytes >= def.MaxImageBytes {
		t.Errorf("MaxImageBytes = %d, want below pdfcpu's own %d", conf.Limits.MaxImageBytes, def.MaxImageBytes)
	}
	if conf.Limits.MaxImagePixels >= def.MaxImagePixels {
		t.Errorf("MaxImagePixels = %d, want below pdfcpu's own %d", conf.Limits.MaxImagePixels, def.MaxImagePixels)
	}
	if conf.Limits.MaxInputBytes <= 0 {
		t.Error("MaxInputBytes must be capped: a spool must not grow past the upload cap")
	}
}
