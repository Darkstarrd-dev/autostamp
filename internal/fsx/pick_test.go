package fsx

import (
	"strings"
	"testing"
)

func TestPickDialogFilterVocabulary(t *testing.T) {
	// The contract has exactly two filter values (UI_SPEC §2 api.fs.pick.filter):
	// the pdf one must offer PDF first with an escape hatch, the all one must not
	// smuggle a PDF-only filter.
	pdf := pickDialog("pdf")
	if !strings.Contains(pdf, "*.pdf") {
		t.Errorf("pdf filter = %q, must offer *.pdf", pdf)
	}
	if strings.HasPrefix(pdf, "所有文件") {
		t.Errorf("pdf filter = %q, PDF must be the default view", pdf)
	}
	all := pickDialog("all")
	if strings.Contains(all, "*.pdf") {
		t.Errorf("all filter = %q, must not restrict to PDF", all)
	}
}

func TestParsePickOutput(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want []string
	}{
		{"C:\\Docs 合同 a.pdf\r\n", []string{"C:\\Docs 合同 a.pdf"}},
		{"\ufeffC:\\a.pdf\n\nC:\\b.pdf\n", []string{"C:\\a.pdf", "C:\\b.pdf"}},
		{"C:\\a.pdf\r\nC:\\b.pdf", []string{"C:\\a.pdf", "C:\\b.pdf"}},
		{"   \n  \n", nil},
		{"", nil},
	} {
		got := parsePickOutput([]byte(tc.in))
		if strings.Join(got, "|") != strings.Join(tc.want, "|") {
			t.Errorf("parsePickOutput(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

// TestPickScriptShape checks the dialog wiring the route relies on. The dialog
// itself cannot run unattended, so the script text is what a reviewer can
// verify: STA apartment, multi-select switch, and the cancel exit code.
func TestPickScriptShape(t *testing.T) {
	script := pickScript(PickOptions{Filter: "pdf", Multi: true, StartDir: "C:\\Docs"})
	for _, want := range []string{
		"System.Windows.Forms.OpenFileDialog",
		"$d.Multiselect = $true",
		"$d.InitialDirectory = 'C:\\Docs'",
		"exit 3",
		"$d.FileNames",
	} {
		if !strings.Contains(script, want) {
			t.Errorf("pick script missing %q:\n%s", want, script)
		}
	}
	// Single-select requests must not leave multi-select on: the handler would
	// then accept a set of paths the caller only uses one of.
	single := pickScript(PickOptions{Filter: "all"})
	if strings.Contains(single, "$d.Multiselect = $true") {
		t.Errorf("single-select script still has Multiselect true:\n%s", single)
	}
	if !strings.Contains(single, "$d.Multiselect = $false") {
		t.Errorf("single-select script must say $false:\n%s", single)
	}
}
