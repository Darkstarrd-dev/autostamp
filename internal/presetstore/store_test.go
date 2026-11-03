package presetstore

import (
	"bytes"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fatal fails the test on any error, so the assertions below can read as a
// straight-line script instead of a tree of nil checks.
func fatal(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

// newTestStore points a store at a temp dir. The directory itself is created by
// the first Save: an untouched app must not create it.
func newTestStore(t *testing.T) *Store {
	t.Helper()
	return New(filepath.Join(t.TempDir(), "seals"), slog.Default())
}

func TestPresetSaveListReload(t *testing.T) {
	st := newTestStore(t)
	empty, err := st.List()
	fatal(t, err)
	if len(empty) != 0 {
		t.Fatalf("empty library must be empty: %+v", empty)
	}
	params := Params{Blend: "multiply", Opacity: 0.6, Scale: 1, Anchor: "center", Pages: "all", Despill: true, AlphaTrim: true, ResampleDPI: 300}
	_, err = st.Save("公司甲 · 红章", bytes.NewReader([]byte("image-a-bytes")), params)
	fatal(t, err)
	_, err = st.Save("乙 · 财务章", bytes.NewReader([]byte("b")), Params{Blend: "normal"})
	fatal(t, err)

	// The newest updated entry sorts first.
	list, err := st.List()
	fatal(t, err)
	if len(list) != 2 {
		t.Fatalf("want 2 presets, got %d", len(list))
	}
	if list[0].Name != "乙 · 财务章" {
		t.Fatalf("sort order wrong: %q first", list[0].Name)
	}

	// The index on disk is the authority: a fresh store over the same directory
	// sees the same entries and the same image bytes.
	st2 := New(st.Dir(), slog.Default())
	entry, path, err := st2.ImageFile("公司甲 · 红章")
	fatal(t, err)
	if entry.ImageBytes != int64(len("image-a-bytes")) {
		t.Fatalf("ImageBytes = %d, want %d", entry.ImageBytes, len("image-a-bytes"))
	}
	if filepath.Dir(path) != st.Dir() || !strings.HasPrefix(filepath.Base(path), "p-") {
		t.Fatalf("image path outside the library: %s", path)
	}
	raw, err := os.ReadFile(path)
	fatal(t, err)
	if string(raw) != "image-a-bytes" {
		t.Fatalf("image bytes = %q", raw)
	}
	if !entry.Params.Despill || entry.Params.Blend != "multiply" || entry.Params.ResampleDPI != 300 {
		t.Fatalf("params not persisted: %+v", entry.Params)
	}

	// No temp leftovers from the staged copy.
	left, _ := filepath.Glob(filepath.Join(st.Dir(), "*.tmp-*"))
	if len(left) != 0 {
		t.Fatalf("temp files left behind: %v", left)
	}
}

func TestPresetOverwriteSameName(t *testing.T) {
	st := newTestStore(t)
	first, err := st.Save("覆盖", bytes.NewReader([]byte("one")), Params{Opacity: 0.5})
	fatal(t, err)
	time.Sleep(5 * time.Millisecond)
	second, err := st.Save("覆盖", bytes.NewReader([]byte("two-longer")), Params{Opacity: 0.25})
	fatal(t, err)

	list, err := st.List()
	fatal(t, err)
	if len(list) != 1 {
		t.Fatalf("同名 = 覆盖, got %d entries", len(list))
	}
	if !second.CreatedAt.Equal(first.CreatedAt) {
		t.Fatalf("CreatedAt must survive an overwrite: %v vs %v", first.CreatedAt, second.CreatedAt)
	}
	if !second.UpdatedAt.After(first.CreatedAt) {
		t.Fatalf("UpdatedAt must move forward: %v", second.UpdatedAt)
	}
	_, path, err := st.ImageFile("覆盖")
	fatal(t, err)
	raw, err := os.ReadFile(path)
	fatal(t, err)
	if string(raw) != "two-longer" {
		t.Fatalf("overwrite did not replace bytes: %q", raw)
	}
	// The key is the trimmed name, so padded names address the same entry.
	_, err = st.Get("  覆盖   ")
	fatal(t, err)
}

func TestPresetDeleteRemovesImage(t *testing.T) {
	st := newTestStore(t)
	_, err := st.Save("删我", bytes.NewReader([]byte("x")), Params{})
	fatal(t, err)
	_, path, err := st.ImageFile("删我")
	fatal(t, err)
	err = st.Delete("删我")
	fatal(t, err)
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("image file survived the delete: %v", err)
	}
	list, err := st.List()
	fatal(t, err)
	if len(list) != 0 {
		t.Fatalf("entry survived the delete: %+v", list)
	}
	if err := st.Delete("删我"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete must report ErrNotFound, got %v", err)
	}
}

func TestPresetNameValidation(t *testing.T) {

	st := newTestStore(t)
	bad := []string{"", "  ", "a/b", `a\b`, "a:b", "bad.name.", "a\tb", "a\nb", strings.Repeat("n", maxNameLen+1)}
	for _, name := range bad {
		if _, err := st.Save(name, bytes.NewReader([]byte("x")), Params{}); !errors.Is(err, ErrBadName) {
			t.Fatalf("name %q must be rejected, got %v", name, err)
		}
	}
	// Dots inside a name are legitimate; only a trailing dot/space is rejected.
	if _, err := st.Save("章.子.png", bytes.NewReader([]byte("x")), Params{}); err != nil {
		t.Fatalf("dotted name must be accepted, got %v", err)
	}
	// A name that only needs trimming still lands inside the library.
	_, err := st.Save("  正常名字  ", bytes.NewReader([]byte("x")), Params{})
	fatal(t, err)
	_, err = st.Get("正常名字")
	fatal(t, err)
}

func TestPresetIndexCorruptIsTreatedAsEmpty(t *testing.T) {
	st := newTestStore(t)
	_, err := st.Save("好预设", bytes.NewReader([]byte("x")), Params{})
	fatal(t, err)
	err = os.WriteFile(filepath.Join(st.Dir(), "presets.json"), []byte("{not json"), 0o644)
	fatal(t, err)

	st2 := New(st.Dir(), slog.Default())
	list, err := st2.List()
	if err != nil {
		t.Fatalf("corrupt index must not fail the app: %v", err)
	}
	if len(list) != 0 {
		t.Fatalf("corrupt index leaked entries: %+v", list)
	}
}
