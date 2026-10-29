package fsx

import (
	"context"
	"errors"
	"strings"
)

// PickOptions describes a native file-open dialog (AGENTS §6 /api/fs/pick).
//
// Filter takes the contract vocabulary: "pdf" limits the dialog to PDF files,
// "all" leaves everything visible. Multi enables multi-selection, which the
// batch queue (P6) uses.
type PickOptions struct {
	Filter   string
	Multi    bool
	StartDir string
}

// ErrPickCancelled is what a runner returns when the user dismissed the dialog
// without choosing anything. The handler maps it to a normal response (the UI
// closes its spinner and shows nothing), not to an error toast.
var ErrPickCancelled = errors.New("fsx: 已取消文件选择")

// ErrPickUnsupported is returned by platforms that have no native dialog; the
// handler turns it into 501 so the UI can fall back to the path box.
var ErrPickUnsupported = errors.New("fsx: 该平台没有原生文件选择器")

// PickFiles opens the native dialog and returns the picked absolute paths.
//
// ctx cancels the dialog: closing the browser tab or aborting the request must
// not leave a modal window on the desktop.
func PickFiles(ctx context.Context, o PickOptions) ([]string, error) {
	if o.Filter == "" {
		o.Filter = "pdf"
	}
	return runPick(ctx, pickScript(o))
}

// pickDialog maps the contract filter onto a Windows filter string. The two
// entries are the only vocabulary the route accepts (UI_SPEC §2
// api.fs.pick.filter), so anything else is a bug, not user input.
func pickDialog(filter string) string {
	if filter == "all" {
		return "所有文件 (*.*)|*.*"
	}
	return "PDF 文件 (*.pdf)|*.pdf|所有文件 (*.*)|*.*"
}

// pickScript builds the PowerShell script that shows the dialog and prints one
// picked path per line. It is generated on every platform so the non-Windows
// runner can report the same "unsupported" error while the script stays
// covered by tests.
//
// STA + System.Windows.Forms is the desktop dialog API shipped with
// PowerShell 5.1 (.NET Framework); -NoProfile keeps user profiles from
// injecting anything into this process.
func pickScript(o PickOptions) string {
	var b strings.Builder
	b.WriteString("$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n")
	b.WriteString("Add-Type -AssemblyName System.Windows.Forms\n")
	b.WriteString("$d = New-Object System.Windows.Forms.OpenFileDialog\n")
	b.WriteString("$d.Title = 'AutoStamp: 选择 PDF 文件'\n")
	b.WriteString("$d.Filter = '" + strings.ReplaceAll(pickDialog(o.Filter), "'", "''") + "'\n")
	b.WriteString("$d.Multiselect = " + boolPS(o.Multi) + "\n")
	b.WriteString("$d.CheckFileExists = $true\n")
	b.WriteString("$d.CheckPathExists = $true\n")
	b.WriteString("$d.DereferenceLinks = $true\n")
	if o.StartDir != "" {
		b.WriteString("$d.InitialDirectory = '" + strings.ReplaceAll(o.StartDir, "'", "''") + "'\n")
	}
	b.WriteString("$r = $d.ShowDialog()\n")
	b.WriteString("if ($r -ne [System.Windows.Forms.DialogResult]::OK) { exit 3 }\n")
	b.WriteString("foreach ($f in $d.FileNames) { Write-Output $f }\n")
	return b.String()
}

func boolPS(v bool) string {
	if v {
		return "$true"
	}
	return "$false"
}

// parsePickOutput turns the dialog's stdout into paths. Blank lines and the
// UTF-8 BOM are dropped: PowerShell writes the BOM once per session, and a
// blank line would otherwise become an empty "file".
func parsePickOutput(out []byte) []string {
	s := strings.ReplaceAll(string(out), "\r\n", "\n")
	s = strings.TrimPrefix(s, "\ufeff")
	var paths []string
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			paths = append(paths, line)
		}
	}
	return paths
}
