//go:build windows

package fsx

import (
	"context"
	"errors"
	"testing"
)

// TestRunPickPowerShellContract runs the real powershell.exe command line that
// runPick builds, with the dialog replaced by plain output. This is what pins
// the wiring: the -STA/-NoProfile/-NonInteractive/-Command flags, stdout
// decoding, and the exit-code-3 cancel channel. A dialog itself cannot be
// driven from a test harness, so the script text is asserted in
// pick_test.go instead.
func TestRunPickPowerShellContract(t *testing.T) {
	ctx := context.Background()
	got, err := runPick(ctx, `
$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Output 'C:\Documents 合同\a.pdf'
Write-Output 'C:\b.pdf'`)
	if err != nil {
		t.Fatalf("runPick: %v", err)
	}
	if len(got) != 2 || got[0] != `C:\Documents 合同\a.pdf` || got[1] != `C:\b.pdf` {
		t.Errorf("picked = %q, want the two printed paths", got)
	}

	if _, err := runPick(ctx, "exit 3\n"); !errors.Is(err, ErrPickCancelled) {
		t.Errorf("cancel err = %v, want ErrPickCancelled", err)
	}

	if _, err := runPick(ctx, "Stop-PSFault -Bad\n"); err == nil {
		t.Fatal("runPick accepted a failing script")
	} else if !errors.Is(err, ErrPickCancelled) && err.Error() == "" {
		t.Error("failure without a message")
	}

	// Cancelling the context must not hang: the process is killed and the error
	// is the context's, so an aborted HTTP request closes the dialog.
	cancelCtx, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := runPick(cancelCtx, "Start-Sleep -Seconds 30\n"); err == nil {
		t.Fatal("runPick on a cancelled context returned no error")
	} else if !errors.Is(err, context.Canceled) {
		t.Errorf("cancelled err = %v, want context.Canceled", err)
	}
}
