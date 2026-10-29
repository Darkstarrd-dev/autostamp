package fsx

import (
	"path/filepath"
	"runtime"
	"strings"
)

// EqualPath reports whether two path strings refer to the same file.
//
// On Windows the filesystem is case-insensitive (but case-preserving), so a
// recent-file list written as C:\Docs\A.PDF must not gain a duplicate entry for
// c:\docs\a.pdf. On other platforms the compare stays exact, which is what
// case-sensitive filesystems need.
func EqualPath(a, b string) bool {
	if a == "" || b == "" {
		return a == b
	}
	if runtime.GOOS == "windows" {
		return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
	}
	return filepath.Clean(a) == filepath.Clean(b)
}
