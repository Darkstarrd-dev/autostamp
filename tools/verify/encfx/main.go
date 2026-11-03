// Command encfx writes an AES-256 encrypted one-page PDF for the verify scripts.
//
// Why it exists: the batch acceptance (AGENTS §8.15, BM4) has to prove two
// things a plain print-to-PDF sample cannot — that the open route answers
// `password_required` for an encrypted document, and that the front-end batch
// row reports it as skipped instead of prompting. pdfcpu can encrypt
// (api.EncryptFile + model.NewAESConfiguration), so we generate the fixture
// instead of committing a binary blob.
//
// Usage:
//
//	go run ./tools/verify/encfx <out.pdf> [userPW] [ownerPW]
//
// Defaults: userPW "secret-open", ownerPW "secret-owner".
//
// The page body is produced by internal/pdfcore's own raster writer (the same
// path the raster export uses), so the fixture is a real AutoStamp-shaped file:
// one page holding a JPEG, then encrypted with AES-256 like pdfcpu's corpus.
package main

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"os"

	"autostamp/internal/pdfcore"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: encfx <out.pdf> [userPW] [ownerPW]")
		os.Exit(2)
	}
	out := os.Args[1]
	userPW, ownerPW := "secret-open", "secret-owner"
	if len(os.Args) > 2 {
		userPW = os.Args[2]
	}
	if len(os.Args) > 3 {
		ownerPW = os.Args[3]
	}

	f, err := os.CreateTemp("", "encfx-plain-*.pdf")
	if err != nil {
		fmt.Fprintln(os.Stderr, "encfx:", err)
		os.Exit(1)
	}
	plainPath := f.Name()
	defer os.Remove(plainPath)

	jpegBytes, err := pageJPEG()
	if err != nil {
		fmt.Fprintln(os.Stderr, "encfx: encode page:", err)
		os.Exit(1)
	}
	pages := []pdfcore.RasterPage{{Number: 1, Data: jpegBytes}}
	if err := pdfcore.WriteRaster(f, pages, pdfcore.RasterOptions{Dpi: 72}); err != nil {
		fmt.Fprintln(os.Stderr, "encfx: write plain:", err)
		os.Exit(1)
	}
	if err := f.Close(); err != nil {
		fmt.Fprintln(os.Stderr, "encfx: close:", err)
		os.Exit(1)
	}

	conf := model.NewAESConfiguration(userPW, ownerPW, 256)
	conf.Permissions = model.PermissionsAll
	if err := api.EncryptFile(context.Background(), plainPath, out, conf); err != nil {
		fmt.Fprintln(os.Stderr, "encfx: encrypt:", err)
		os.Exit(1)
	}
	st, err := os.Stat(out)
	if err != nil {
		fmt.Fprintln(os.Stderr, "encfx:", err)
		os.Exit(1)
	}
	fmt.Printf("encfx: %s %d bytes (userPW=%q ownerPW=%q)\n", out, st.Size(), userPW, ownerPW)
}

func pageJPEG() ([]byte, error) {
	var buf bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, 40, 40))
	ink := color.NRGBA{R: 200, G: 24, B: 28, A: 255}
	for y := 0; y < 40; y++ {
		for x := 0; x < 40; x++ {
			img.Set(x, y, ink)
		}
	}
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 85}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
