package fsx

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestAtomicWriteCreatesAndReplaces(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "sub")
	if err := os.Mkdir(sub, 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(sub, "settings.json")
	if err := AtomicWrite(path, []byte("first"), 0o600); err != nil {
		t.Fatalf("AtomicWrite: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "first" {
		t.Errorf("content = %q, want first", got)
	}
	if err := AtomicWrite(path, []byte("second"), 0o600); err != nil {
		t.Fatalf("replace: %v", err)
	}
	got, _ = os.ReadFile(path)
	if string(got) != "second" {
		t.Errorf("after replace: %q", got)
	}
	// No temp file may be left in the directory (only the target).
	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "settings.json" {
		t.Errorf("directory contents = %v, want just the target", entries)
	}
}

func TestAtomicWriteFuncStreamedLength(t *testing.T) {
	path := filepath.Join(t.TempDir(), "asset.pdf")
	err := AtomicWriteFunc(path, func(f *os.File) (int64, error) {
		n, err := f.Write([]byte("%PDF-1.7 body"))
		return int64(n), err
	}, 0o600)
	if err != nil {
		t.Fatalf("AtomicWriteFunc: %v", err)
	}
	st, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if st.Size() != int64(len("%PDF-1.7 body")) {
		t.Errorf("file has %d bytes, want %d", st.Size(), len("%PDF-1.7 body"))
	}
	// A failed writer must not leave a truncated file behind.
	want := errors.New("writer failed")
	if err := AtomicWriteFunc(path, func(f *os.File) (int64, error) {
		_, _ = f.Write([]byte("partial"))
		return 7, want
	}, 0o600); !errors.Is(err, want) {
		t.Errorf("error = %v, want %v", err, want)
	}
	got, _ := os.ReadFile(path)
	if string(got) != "%PDF-1.7 body" {
		t.Errorf("a failed rewrite corrupted the previous content: %q", got)
	}
	tmps, _ := filepath.Glob(filepath.Join(filepath.Dir(path), ".tmp-*"))
	if len(tmps) != 0 {
		t.Errorf("temp files left after a failed write: %v", tmps)
	}
}

func TestReadIfExists(t *testing.T) {
	dir := t.TempDir()
	missing := filepath.Join(dir, "absent.json")
	data, err := ReadIfExists(missing)
	if err != nil || data != nil {
		t.Errorf("missing file must be (nil, nil), got (%q, %v)", data, err)
	}
	path := filepath.Join(dir, "here.json")
	if err := os.WriteFile(path, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	data, err = ReadIfExists(path)
	if err != nil || string(data) != "{}" {
		t.Errorf("existing file: %q %v", data, err)
	}
	if _, err := ReadIfExists(dir); err == nil {
		t.Error("a directory is not a settings file")
	}
}

func TestTempNameIsUniqueAndInsideDir(t *testing.T) {
	dir := t.TempDir()
	seen := map[string]bool{}
	for i := 0; i < 20; i++ {
		n, err := TempName(dir)
		if err != nil {
			t.Fatal(err)
		}
		if seen[n] {
			t.Fatalf("duplicate temp name %s", n)
		}
		seen[n] = true
		if filepath.Dir(n) != dir || !strings.Contains(filepath.Base(n), ".tmp-") {
			t.Errorf("temp name %s must live in %s and match .tmp-*", n, dir)
		}
	}
	// TempName only builds the staged name; it never touches the filesystem, so
	// the failure surfaces from createTemp instead.
	if _, err := createTemp(filepath.Join(dir, "no-such-dir")); err == nil {
		t.Error("createTemp must fail for a missing directory")
	}
}

func TestEqualPath(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{`C:\Docs\A.pdf`, `C:\Docs\A.pdf`, true},
		{`C:\Docs\A.pdf`, `C:\Docs\B.pdf`, false},
		{`C:\Docs\`, `C:\Docs`, true},
		{"", "", true},
		{"", `C:\x`, false},
	}
	for _, c := range cases {
		if got := EqualPath(c.a, c.b); got != c.want {
			t.Errorf("EqualPath(%q, %q) = %v, want %v", c.a, c.b, got, c.want)
		}
	}
	if runtime.GOOS == "windows" {
		if !EqualPath(`C:\Docs\A.PDF`, `c:\docs\a.pdf`) {
			t.Error("Windows paths must compare case-insensitively")
		}
		if EqualPath(`C:\Docs\A.pdf`, `D:\Docs\A.pdf`) {
			t.Error("different drives must not compare equal")
		}
	} else if EqualPath(`/Docs/a.pdf`, `/Docs/A.pdf`) {
		t.Error("case-sensitive platforms must compare exactly")
	}
}
