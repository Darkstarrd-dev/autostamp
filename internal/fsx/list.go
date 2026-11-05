package fsx

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// ListMatching returns the files directly under dir whose extension matches the pick
// filter vocabulary ("pdf" = .pdf, "image" = seal pictures (HD8), "all" = any file).
// Subdirectories are skipped, as are dot-files: the batch queue (P6, 需求 6)
// enumerates a picked folder, and the browser must not be the one deciding which
// files exist on the user's disk.
//
// One level only, on purpose - a recursive walk over a user's whole tree would turn a
// 20-file batch into a surprise. The picked folder is the scope (UI_SPEC §8 B1).
func ListMatching(dir, filter string) ([]string, error) {
	if dir == "" {
		return nil, fmt.Errorf("fsx: 目录路径为空")
	}
	switch filter {
	case "":
		filter = "pdf" // the route default (AGENTS §6 /api/fs/pick)
	case "pdf", "image", "all":
	default:
		return nil, fmt.Errorf("fsx: 未知的 filter %q", filter)
	}
	f, err := filepath.Abs(dir)
	if err != nil {
		return nil, fmt.Errorf("fsx: 解析目录: %w", err)
	}
	entries, err := os.ReadDir(f)
	if err != nil {
		return nil, fmt.Errorf("fsx: 读目录: %w", err)
	}
	var out []string
	for _, e := range entries {
		if e.IsDir() {
			continue // one level only (UI_SPEC §8 B1)
		}
		name := e.Name()
		if strings.HasPrefix(name, ".") {
			continue // dot-files are not batch input
		}
		switch filter {
		case "pdf":
			if !strings.EqualFold(filepath.Ext(name), ".pdf") {
				continue
			}
		case "image":
			if !IsImageName(name) {
				continue
			}
		}
		out = append(out, filepath.Join(f, name))
	}

	// The queue order is what the report shows, so it has to be stable. Windows is
	// case-insensitive, so the comparison is too: UPPER.PDF sorts after a.pdf, the
	// way the folder itself is listed in Explorer.
	sort.Slice(out, func(i, j int) bool {
		a := strings.ToLower(filepath.Base(out[i]))
		b := strings.ToLower(filepath.Base(out[j]))
		if a != b {
			return a < b
		}
		return out[i] < out[j]
	})
	return out, nil
}

// isImageName reports the seal-picture extensions accepted by the seal channels
// (HD8; the pdf/djvu-family is intentionally absent — PrepareSeal only decodes
// raster images).
func IsImageName(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff":
		return true
	}
	return false
}
