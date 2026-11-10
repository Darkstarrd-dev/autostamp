package fsx

import (
	"context"
	"errors"
	"strings"
)

// PickOptions describes a native file-open dialog (AGENTS §6 /api/fs/pick).
//
// Filter takes the contract vocabulary: "pdf" limits the dialog to PDF files,
// "image" to seal pictures (HD8), "all" leaves everything visible. Multi enables
// multi-selection, which the batch queue (P6) uses.
type PickOptions struct {
	Filter   string
	Multi    bool
	StartDir string
	// Dir switches the dialog to a folder chooser (the batch directory, P6). The
	// filter and multi-selection are meaningless there, so the route rejects the
	// combination instead of pretending otherwise.
	Dir bool
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

// SaveOptions describes a native save-as dialog (UI8-SV1): the user picks the
// folder and types the file name in one step, which is what the save modal
// used to emulate with an open-picker + a text box. DefaultName pre-fills the
// name box (same-name-plus-.stamp.pdf when a document is open); StartDir
// starts the browse at the current document's folder.
type SaveOptions struct {
	DefaultName string
	StartDir    string
}

// PickSave shows the save dialog and reports the chosen absolute path. A
// cancelled dialog is ErrPickCancelled like every other picker; the route
// turns it into the same {cancelled:true} response.
func PickSave(ctx context.Context, o SaveOptions) (string, error) {
	paths, err := runPick(ctx, saveScript(o))
	if err != nil {
		return "", err
	}
	if len(paths) == 0 {
		return "", ErrPickCancelled
	}
	return paths[0], nil
}

// saveScript is the SaveFileDialog twin of pickScript. The pdf filter plus
// DefaultExt/AddExtension mean a typed name always ends in exactly one .pdf
// extension (AGENTS §5.21's single-extension rule); OverwritePrompt is the
// native "are you sure" for an existing file, so the UI never asks twice.
func saveScript(o SaveOptions) string {
	var b strings.Builder
	b.WriteString("$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n")
	b.WriteString("Add-Type -AssemblyName System.Windows.Forms\n")
	b.WriteString("$d = New-Object System.Windows.Forms.SaveFileDialog\n")
	b.WriteString("$d.Title = 'AutoStamp: 保存 PDF'\n")
	b.WriteString("$d.Filter = 'PDF 文件 (*.pdf)|*.pdf'\n")
	b.WriteString("$d.DefaultExt = 'pdf'\n")
	b.WriteString("$d.AddExtension = $true\n")
	b.WriteString("$d.OverwritePrompt = $true\n")
	b.WriteString("$d.CheckPathExists = $true\n")
	b.WriteString("$d.DereferenceLinks = $true\n")
	if o.DefaultName != "" {
		b.WriteString("$d.FileName = '" + strings.ReplaceAll(o.DefaultName, "'", "''") + "'\n")
	}
	if o.StartDir != "" {
		b.WriteString("$d.InitialDirectory = '" + strings.ReplaceAll(o.StartDir, "'", "''") + "'\n")
	}
	b.WriteString("$r = $d.ShowDialog()\n")
	b.WriteString("if ($r -ne [System.Windows.Forms.DialogResult]::OK) { exit 3 }\n")
	b.WriteString("Write-Output $d.FileName\n")
	return b.String()
}

// PickDirs opens the native folder dialog and reports the chosen directory. The batch
// queue works on the files directly under this folder, so a folder is the contract
// here rather than a file list (UI_SPEC §2 api.fs.pick.dir).
func PickDirs(ctx context.Context, o PickOptions) (string, error) {
	paths, err := runPick(ctx, pickScript(o))
	if err != nil {
		return "", err
	}
	if len(paths) == 0 {
		return "", ErrPickCancelled
	}
	return paths[0], nil
}

// pickDialog maps the contract filter onto a Windows filter string. The three
// entries are the only vocabulary the route accepts (UI_SPEC §2
// api.fs.pick.filter, HD8 adds "image"), so anything else is a bug, not user input.
func pickDialog(filter string) string {
	switch filter {
	case "all":
		return "所有文件 (*.*)|*.*"
	case "image":
		return "印章图片 (*.png;*.jpg;*.jpeg;*.bmp;*.tif;*.tiff)|*.png;*.jpg;*.jpeg;*.bmp;*.tif;*.tiff|所有文件 (*.*)|*.*"
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
	// A folder selection is a different dialog, not a file dialog with a flag: the
	// batch queue asks for one folder and then enumerates it (fsx.ListMatching).
	if o.Dir {
		return folderPickScript(o)
	}
	var b strings.Builder
	b.WriteString("$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n")
	b.WriteString("Add-Type -AssemblyName System.Windows.Forms\n")
	b.WriteString("$d = New-Object System.Windows.Forms.OpenFileDialog\n")
	title := "AutoStamp: 选择 PDF 文件"
	if o.Filter == "image" {
		title = "AutoStamp: 选择印章图片"
	}
	b.WriteString("$d.Title = '" + title + "'\n")
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

// folderPickScript is the directory dialog the batch queue uses (UI_SPEC §8 B1: the
// picked folder is the batch scope). FolderBrowserDialog auto-upgrades to the
// Vista-style picker, and SelectedPath carries both the start and the result.
func folderPickScript(o PickOptions) string {
	var b strings.Builder
	b.WriteString("$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n")
	b.WriteString("Add-Type -AssemblyName System.Windows.Forms\n")
	b.WriteString("$d = New-Object System.Windows.Forms.FolderBrowserDialog\n")
	b.WriteString("$d.Description = 'AutoStamp: 选择批处理目录'\n")
	b.WriteString("$d.ShowNewFolderButton = $true\n")
	if o.StartDir != "" {
		b.WriteString("$d.SelectedPath = '" + strings.ReplaceAll(o.StartDir, "'", "''") + "'\n")
	}
	b.WriteString("$r = $d.ShowDialog()\n")
	b.WriteString("if ($r -ne [System.Windows.Forms.DialogResult]::OK) { exit 3 }\n")
	b.WriteString("Write-Output $d.SelectedPath\n")
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
