// Package pdfcore reads and mutates PDF documents. This file owns the
// structural summary every open request returns (AGENTS §6): page count, per
// page size in pt and rotation, plus resource hints.
//
// Text/image detection is NOT done here: pdfcpu has no text extractor and no
// rasterizer (FACTS §2.4), so the front-end's pdf.js results are the source of
// truth for the "text / scanned / mixed" badge. The hints below only tell the
// UI whether a page declares fonts or XObjects, which is what the server can
// know without rendering.
package pdfcore

import (
	"context"
	"errors"
	"fmt"
	"io"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// ErrNeedsPassword / ErrBadPassword re-export pdfcpu's password signals so the
// API layer never imports pdfcpu just to map a contract code (AGENTS §6:
// password_required / password_invalid). pdfcpu only reports that a password is
// missing, never which kind, so the UI asks for one and the server tries it as
// both UserPW and OwnerPW (FACTS §2.4).
var (
	ErrNeedsPassword = pdfcpu.ErrOwnerPasswordRequired
	ErrBadPassword   = pdfcpu.ErrWrongPassword
)

// Page is one page's structural metadata.
//
// Width/Height are MediaBox extents in PostScript points (1/72 inch) as the
// source declares them — rotation is reported separately, not folded in, so
// the front-end can mirror pdf.js' viewport math instead of guessing.
type Page struct {
	Number     int     `json:"number"`
	Width      float64 `json:"width"`
	Height     float64 `json:"height"`
	Rotation   int     `json:"rotation"`
	HasFonts   bool    `json:"hasFonts"`
	HasXObject bool    `json:"hasXObject"`
}

// Doc is the structural summary of an opened PDF.
type Doc struct {
	PageCount int    `json:"pageCount"`
	Version   string `json:"version"`
	Encrypted bool   `json:"encrypted"`
	Pages     []Page `json:"pages"`
}

// Inspect reads a PDF and returns its structure. The reader must be a
// ReadSeeker because pdfcpu walks the xref table in place.
//
// conf == nil means DefaultLimits (AGENTS §5.11: pdfcpu's own 512 MB / 100 MP
// image limits are far too wide for a local app). A document that fails
// validation is rejected here rather than half-opened.
func Inspect(c context.Context, rs io.ReadSeeker, conf *model.Configuration) (*Doc, error) {
	if rs == nil {
		return nil, errors.New("pdfcore: nil reader")
	}
	if conf == nil {
		conf = DefaultLimits()
	}
	ctx, err := api.ReadAndValidate(c, rs, conf)
	if err != nil {
		return nil, fmt.Errorf("pdfcore: read/validate: %w", err)
	}
	doc := &Doc{
		PageCount: ctx.PageCount,
		Encrypted: ctx.Encrypt != nil,
		Version:   versionString(ctx),
		Pages:     make([]Page, 0, ctx.PageCount),
	}
	for i := 1; i <= ctx.PageCount; i++ {
		pageDict, _, pAttrs, err := ctx.PageDict(c, i, false)
		if err != nil {
			return nil, fmt.Errorf("pdfcore: page %d: %w", i, err)
		}
		if pageDict == nil {
			return nil, fmt.Errorf("pdfcore: page %d: not found in the page tree", i)
		}
		if pAttrs == nil {
			return nil, fmt.Errorf("pdfcore: page %d: no inherited attributes", i)
		}
		p := Page{Number: i, Rotation: normalizeRotation(pAttrs.Rotate)}
		box := pAttrs.MediaBox
		// Inherited MediaBox/CropBox are resolved by pdfcpu while it walks the
		// page tree. A file without any MediaBox is a broken file: report zero
		// extents and let the front-end fall back to the pdf.js viewport.
		if box != nil {
			p.Width = box.UR.X - box.LL.X
			p.Height = box.UR.Y - box.LL.Y
		}
		res := pAttrs.Resources
		if res == nil {
			// A page can carry its resources directly; PageDict keeps them in
			// InheritedPageAttrs only when they are reachable through the tree.
			if o, err := ctx.DereferenceDictEntry(pageDict, "Resources"); err == nil {
				if d, ok := o.(types.Dict); ok {
					res = d
				}
			}
		}
		if res != nil {
			p.HasFonts = res.HasEntry("Font")
			p.HasXObject = res.HasEntry("XObject")
		}
		doc.Pages = append(doc.Pages, p)
	}
	return doc, nil
}

// DefaultLimits is the configuration every pdfcpu call in this app should use:
// resource caps that keep a hostile or corrupt document from eating the machine.
func DefaultLimits() *model.Configuration {
	conf := model.NewDefaultConfiguration()
	// pdfcpu's own defaults are 512 MB / 100 MP (AGENTS §5.11); a local app has
	// no business spending that, so the caps are named here instead of
	// inherited: anything past them is a document we refuse to open.
	limits := model.DefaultResourceLimits()
	limits.MaxInputBytes = 256 << 20 // the same cap the upload route enforces
	limits.MaxImageBytes = 64 << 20
	limits.MaxImagePixels = 50_000_000
	conf.Limits = limits
	return conf
}

func versionString(ctx *model.Context) string {
	if ctx.HeaderVersion == nil {
		return ""
	}
	return ctx.HeaderVersion.String()
}

// normalizeRotation keeps /Rotate in the 0..359 range PDF requires while
// leaving anything that is not a multiple of 90 visible (the UI must be able
// to tell the user the file is odd, not silently fix it).
func normalizeRotation(r int) int {
	r = r % 360
	if r < 0 {
		r += 360
	}
	return r
}
