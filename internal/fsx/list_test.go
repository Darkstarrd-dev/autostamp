package fsx

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestListMatchingScope pins the batch queue's input rule (UI_SPEC §8 B1): the picked
// folder only, matching extension, no dot-files, stable order.
func TestListMatchingScope(t *testing.T) {
	dir := t.TempDir()
	write := func(rel, body string) {
		t.Helper()
		full := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("b.pdf", "x")
	write("a.pdf", "x")
	write("UPPER.PDF", "x")
	write("notes.txt", "x")
	write(".hidden.pdf", "x")
	write("sub/deep.pdf", "x")
	if err := os.MkdirAll(filepath.Join(dir, "emptydir"), 0o755); err != nil {
		t.Fatal(err)
	}

	got, err := ListMatching(dir, "pdf")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		filepath.Join(dir, "a.pdf"),
		filepath.Join(dir, "b.pdf"),
		filepath.Join(dir, "UPPER.PDF"),
	}
	if len(got) != len(want) {
		t.Fatalf("got %d files %v, want %d", len(got), got, len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("order: got %q want %q (full list %v)", got[i], want[i], got)
		}
	}

	all, err := ListMatching(dir, "all")
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 4 {
		t.Errorf("filter all = %d entries %v, want 4 (dot-files and folders excluded)", len(all), all)
	}

	// The route's default filter is pdf; an empty filter must not mean "everything",
	// otherwise a missing field would batch non-PDF files.
	defaults, err := ListMatching(dir, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(defaults) != 3 {
		t.Errorf("empty filter = %v, want the pdf default", defaults)
	}
}

func TestListMatchingErrors(t *testing.T) {
	if _, err := ListMatching("", "pdf"); err == nil {
		t.Error("empty dir must be an error, not an empty list")
	}
	if _, err := ListMatching(filepath.Join(t.TempDir(), "missing"), "pdf"); err == nil {
		t.Error("a missing folder must report an error")
	}
	dir := t.TempDir()
	if _, err := ListMatching(dir, "exe"); err == nil {
		t.Error("an unknown filter must be rejected, not silently accepted")
	}
}

// The batch dialog is a folder chooser, not a file dialog with the filter switched off:
// a reviewer must be able to see that in the script text.
func TestFolderPickScriptShape(t *testing.T) {
	script := pickScript(PickOptions{Dir: true, StartDir: "C:\\Docs"})
	for _, want := range []string{
		"System.Windows.Forms.FolderBrowserDialog",
		"$d.SelectedPath = 'C:\\Docs'",
		"$d.ShowNewFolderButton = $true",
		"exit 3",
		"$d.SelectedPath",
	} {
		if !strings.Contains(script, want) {
			t.Errorf("folder script missing %q:\n%s", want, script)
		}
	}
	// A folder dialog has no file filter: nothing may leak in from the file branch.
	if strings.Contains(script, "OpenFileDialog") {
		t.Errorf("folder script still opens a file dialog:\n%s", script)
	}
	// And the file branch must stay a file dialog.
	fileScript := pickScript(PickOptions{Filter: "pdf"})
	if !strings.Contains(fileScript, "OpenFileDialog") {
		t.Errorf("file script lost the file dialog:\n%s", fileScript)
	}
}
