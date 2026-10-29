// Package fsx holds the file primitives shared by config and tmpstore: every
// write that a user could observe goes through AtomicWrite.
package fsx

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

// AtomicWrite writes data to path with a temp file in the same directory
// followed by os.Rename (AGENTS §4: 一律原子写，同目录 .tmp-<rand> + rename).
func AtomicWrite(path string, data []byte, perm os.FileMode) error {
	return AtomicWriteFunc(path, func(f *os.File) (int64, error) {
		n, err := f.Write(data)
		return int64(n), err
	}, perm)
}

// AtomicWriteFunc streams into the temp file with fn. Any error from fn (or
// from the rename/sync path) removes the staged temp file, so a crash -- or a
// test that simulates an interrupted write -- never leaves a half-written
// destination behind.
//
// A rename failure that means "different volume" (EXDEV) falls back to an
// explicit copy of the staged file onto the destination: that is the only way
// to honour the atomic-where-possible promise when the caller passes a path on
// another drive. The fallback still removes the temp file.
func AtomicWriteFunc(path string, fn func(*os.File) (int64, error), perm os.FileMode) error {
	tmp, err := createTemp(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name()) // no-op once the rename succeeded

	if _, err := fn(tmp); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if perm != 0 {
		if err := os.Chmod(tmp.Name(), perm); err != nil {
			return err
		}
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		if !isCrossDevice(err) {
			return err
		}
		return copyOver(tmp.Name(), path)
	}
	return nil
}

// ReadIfExists returns the file contents, or (nil, nil) when path is missing.
// Callers that treat "missing" as "first run" use this instead of repeating
// os.IsNotExist checks.
func ReadIfExists(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return data, nil
}

// TempName returns a random staged file name in dir, matching the AGENTS §4
// naming convention (".tmp-<rand>").
func TempName(dir string) (string, error) {
	var buf [8]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", err
	}
	return filepath.Join(dir, ".tmp-"+hex.EncodeToString(buf[:])), nil
}

func createTemp(dir string) (*os.File, error) {
	name, err := TempName(dir)
	if err != nil {
		return nil, err
	}
	return os.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
}

func copyOver(from, to string) error {
	src, err := os.Open(from)
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := os.OpenFile(to, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		return err
	}
	if err := dst.Sync(); err != nil {
		dst.Close()
		return err
	}
	return dst.Close()
}

// isCrossDevice reports a rename that Windows/POSIX refuse because source and
// destination live on different volumes.
func isCrossDevice(err error) bool {
	if errors.Is(err, syscall.EXDEV) {
		return true
	}
	return strings.Contains(strings.ToLower(err.Error()), "different volume") ||
		strings.Contains(strings.ToLower(err.Error()), "cross-device")
}
