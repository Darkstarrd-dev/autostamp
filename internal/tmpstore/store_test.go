package tmpstore

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"autostamp/internal/console"
)

func newStore(t *testing.T, ttl time.Duration, maxFile, maxTotal int64) *Store {
	t.Helper()
	s, err := New(t.TempDir(), Limits{TTL: ttl, MaxFile: maxFile, MaxTotal: maxTotal}, console.Stderr(false))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestKindExt(t *testing.T) {
	for _, tc := range []struct {
		k    Kind
		want string
	}{
		{KindSource, ".pdf"}, {KindSplit, ".pdf"}, {KindApplied, ".pdf"}, {KindExport, ".pdf"},
		{KindSeal, ".png"}, {KindPage, ".png"}, {Kind("bogas"), ".bin"},
	} {
		if got := tc.k.Ext(); got != tc.want {
			t.Errorf("Kind(%q).Ext() = %s, want %s", tc.k, got, tc.want)
		}
	}
}

func TestAddGetRoundTripAndOwner(t *testing.T) {
	s := newStore(t, time.Hour, 1<<20, 10<<20)
	a, err := s.Add("as1", KindSource, "win-a", bytes.NewReader([]byte("%PDF-1.7 fake")))
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if a.Size != int64(len("%PDF-1.7 fake")) || !strings.HasSuffix(a.Path, "as1.pdf") {
		t.Errorf("asset meta = %+v", a)
	}
	if got, err := s.Get("as1", "win-a"); err != nil || got.ID != "as1" {
		t.Errorf("owner read failed: %v %+v", err, got)
	}
	if _, err := s.Get("as1", "win-b"); !errors.Is(err, ErrOwner) {
		t.Errorf("other window must not read another owner's asset, got %v", err)
	}
	if _, err := s.Get("nope", "win-a"); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown id: want ErrNotFound, got %v", err)
	}
	// An unowned asset (created before any window claimed ownership) is readable
	// by whoever asks, and the first window to claim it becomes the owner.
	if _, err := s.Add("as2", KindSeal, "", bytes.NewReader([]byte("x"))); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get("as2", "anyone"); err != nil {
		t.Errorf("unowned asset must be readable, got %v", err)
	}
	if n := s.TakeOwnership("win-a"); n != 1 {
		t.Errorf("TakeOwnership adopted %d, want 1", n)
	}
	if _, err := s.Get("as2", "win-b"); !errors.Is(err, ErrOwner) {
		t.Errorf("after adoption a second window must not read it, got %v", err)
	}
}

func TestAddQuotas(t *testing.T) {
	s := newStore(t, time.Hour, 8, 16)
	if _, err := s.Add("big", KindSource, "w", bytes.NewReader(bytes.Repeat([]byte("x"), 100))); err == nil {
		t.Error("per-file limit must reject 100 bytes")
	} else if !strings.Contains(err.Error(), "per-file limit") {
		t.Errorf("error = %v", err)
	}
	if _, err := s.Add("empty", KindSource, "w", bytes.NewReader(nil)); err == nil {
		t.Error("empty asset must be rejected")
	}
	// First two fit (8 bytes each), the third crosses the 16-byte total.
	for _, id := range []string{"a", "b"} {
		if _, err := s.Add(id, KindSource, "w", bytes.NewReader(bytes.Repeat([]byte("y"), 8))); err != nil {
			t.Fatalf("Add %s: %v", id, err)
		}
	}
	if _, err := s.Add("c", KindSource, "w", bytes.NewReader(bytes.Repeat([]byte("y"), 8))); err == nil {
		t.Error("total limit must reject the third asset")
	}
	if s.Used() != 16 {
		t.Errorf("Used = %d, want 16", s.Used())
	}
	if err := s.Delete("a"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if s.Used() != 8 {
		t.Errorf("Used after delete = %d, want 8", s.Used())
	}
	if _, err := s.Add("c", KindSource, "w", bytes.NewReader(bytes.Repeat([]byte("y"), 8))); err != nil {
		t.Errorf("after deleting one asset the next must fit: %v", err)
	}
	// Quota rejections must not leave a partial file or a phantom asset.
	if got, err := s.Get("big", "w"); err == nil {
		t.Errorf("rejected asset still indexed: %+v", got)
	}
	left, _ := filepath.Glob(filepath.Join(s.Dir(), ".tmp-*"))
	if len(left) != 0 {
		t.Errorf("temp files left behind after quota rejection: %v", left)
	}
}

func TestIndexSurvivesRestartAndScavengesExpired(t *testing.T) {
	dir := t.TempDir()
	s1, err := New(dir, Limits{TTL: 30 * time.Minute, MaxFile: 1 << 20, MaxTotal: 1 << 20}, console.Stderr(false))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s1.Add("keep", KindSource, "w", bytes.NewReader([]byte("pdf"))); err != nil {
		t.Fatal(err)
	}
	if _, err := s1.Add("old", KindSource, "w", bytes.NewReader([]byte("pdf"))); err != nil {
		t.Fatal(err)
	}
	// Backdate one asset past the TTL; the index on disk carries that
	// timestamp into the next run, which is what a dead session looks like.
	s1.mu.Lock()
	s1.assets["keep"].Created = time.Now().UTC().Add(-2 * time.Hour)
	s1.mu.Unlock()
	if err := s1.Close(); err != nil {
		t.Fatal(err)
	}

	s2, err := New(dir, Limits{TTL: 30 * time.Minute, MaxFile: 1 << 20, MaxTotal: 1 << 20}, console.Stderr(false))
	if err != nil {
		t.Fatal(err)
	}
	defer s2.Close()
	if _, err := s2.Get("keep", "w"); !errors.Is(err, ErrNotFound) {
		t.Errorf("expired asset must be gone after a restart, got %v", err)
	}
	if _, err := s2.Get("old", "w"); err != nil {
		t.Errorf("fresh asset must survive a restart, got %v", err)
	}
	if _, err := s2.Get("old", ""); err != nil {
		t.Errorf("owner check must allow the owner view, got %v", err)
	}
}

func TestScavengeRemovesOrphanTemps(t *testing.T) {
	s := newStore(t, time.Millisecond, 1<<20, 1<<20)
	if _, err := s.Add("gone", KindSource, "w", bytes.NewReader([]byte("pdf"))); err != nil {
		t.Fatal(err)
	}
	orphan := filepath.Join(s.Dir(), ".tmp-hanged")
	if err := writeFile(orphan, "half written"); err != nil {
		t.Fatal(err)
	}
	time.Sleep(3 * time.Millisecond)
	n := s.Scavenge()
	if n < 1 {
		t.Errorf("Scavenge removed %d assets, want >= 1", n)
	}
	if _, err := s.Get("gone", "w"); !errors.Is(err, ErrNotFound) {
		t.Errorf("TTL asset must be scavenget, got %v", err)
	}
	if _, err := statPath(orphan); err == nil {
		t.Error("orphan .tmp-* file must be removed by Scavenge")
	}
	if s.Used() != 0 {
		t.Errorf("Used = %d after scavenge, want 0", s.Used())
	}
}

func TestPathGrants(t *testing.T) {
	s := newStore(t, time.Millisecond, 1<<20, 1<<20)
	pending, err := s.GrantPath("g1", "", "w", false)
	if err != nil {
		t.Fatal(err)
	}
	if pending.Approved {
		t.Error("a pending grant must not be approved")
	}
	if _, err := s.CheckGrant("g1", "w"); !errors.Is(err, ErrNotFound) {
		t.Errorf("unapproved grant must fail, got %v", err)
	}
	if _, err := s.GrantPath("g1", `C:\docs\a.pdf`, "w", true); err != nil {
		t.Fatal(err)
	}
	if p, err := s.CheckGrant("g1", "w"); err != nil || p != `C:\docs\a.pdf` {
		t.Errorf("approved grant: %s %v", p, err)
	}
	if _, err := s.CheckGrant("g1", "other-window"); !errors.Is(err, ErrOwner) {
		t.Errorf("grant owner binding violated: %v", err)
	}
	time.Sleep(2 * time.Millisecond)
	if _, err := s.CheckGrant("g1", "w"); !errors.Is(err, ErrExpired) {
		t.Errorf("grant TTL violated: %v", err)
	}
	s.DropGrant("g1")
	if _, err := s.CheckGrant("g1", "w"); !errors.Is(err, ErrNotFound) {
		t.Errorf("dropped grant must be gone, got %v", err)
	}
}

func TestAddFileKeepsSourceInPlace(t *testing.T) {
	s := newStore(t, time.Hour, 1<<20, 1<<20)
	src := filepath.Join(t.TempDir(), "contract.pdf")
	if err := writeFile(src, "%PDF-1.7 src"); err != nil {
		t.Fatal(err)
	}
	a, err := s.AddFile("src1", KindSource, "w", src)
	if err != nil {
		t.Fatal(err)
	}
	if a.Path != src {
		t.Errorf("AddFile must keep the file where it is, got %s", a.Path)
	}
	if _, err := statPath(src); err != nil {
		t.Errorf("source file must still exist: %v", err)
	}
	if err := s.Delete("src1"); err != nil {
		t.Fatal(err)
	}
	if _, err := statPath(src); err != nil {
		t.Errorf("deleting an AddFile asset must not delete the user's file: %v", err)
	}
	if _, err := s.AddFile("dir", KindSource, "w", t.TempDir()); err == nil {
		t.Error("a directory is not an asset")
	}
	if _, err := s.AddFile("missing", KindSource, "w", filepath.Join(t.TempDir(), "nope.pdf")); err == nil {
		t.Error("a missing file must fail")
	}
}

func TestListIsOwnerScoped(t *testing.T) {
	s := newStore(t, time.Hour, 1<<20, 1<<20)
	for _, o := range []string{"a", "b"} {
		if _, err := s.Add("x"+o, KindSource, o, bytes.NewReader([]byte("pdf"))); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Add("loose", KindSeal, "", bytes.NewReader([]byte("png"))); err != nil {
		t.Fatal(err)
	}
	only := s.List("a")
	if len(only) != 2 { // x a + the unowned one
		t.Errorf("List(a) = %d entries, want 2: %+v", len(only), only)
	}
	for _, e := range only {
		if e.Owner == "b" {
			t.Errorf("List leaked another owner's asset: %+v", e)
		}
	}
	if all := s.List(""); len(all) != 3 {
		t.Errorf("List(\"\") = %d, want all 3", len(all))
	}
}

// readFile/writeFile/statPath keep the tests focused on store behaviour instead
// of repeating the os.WriteFile([]byte(...)) dance.
func readFile(p string) ([]byte, error) { return os.ReadFile(p) }

func writeFile(p, content string) error { return os.WriteFile(p, []byte(content), 0o600) }

func statPath(p string) (os.FileInfo, error) { return os.Stat(p) }
