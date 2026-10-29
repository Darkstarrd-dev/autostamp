//go:build windows

package fsx

import (
	"bytes"
	"context"
	"errors"
	"os/exec"
	"strings"
	"syscall"
)

// runPick shows the dialog through powershell.exe.
//
// -STA is required: the shell dialog is an apartment-threaded Win32 call, and
// PowerShell's default MTA apartment makes it hang or throw. -NoProfile keeps a
// user profile from loading, -NonInteractive stops PowerShell from waiting on
// stdin. The script's `exit 3` means "the user pressed Cancel".
//
// CommandContext so an aborted request kills the dialog process instead of
// leaving a modal window on the desktop.
func runPick(ctx context.Context, script string) ([]string, error) {
	cmd := exec.CommandContext(ctx, "powershell.exe",
		"-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass",
		"-WindowStyle", "Hidden", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) && exitErr.ExitCode() == 3 {
			return nil, ErrPickCancelled
		}
		return nil, pickFailure(err, stderr.String())
	}
	return parsePickOutput(stdout.Bytes()), nil
}

// pickFailure keeps the last non-empty line of PowerShell's stderr: the first
// lines are the script echo, the last one is the actual message.
func pickFailure(err error, stderr string) error {
	var lines []string
	for _, l := range strings.Split(strings.ReplaceAll(stderr, "\r\n", "\n"), "\n") {
		if l = strings.TrimSpace(l); l != "" {
			lines = append(lines, l)
		}
	}
	if len(lines) > 0 {
		return errors.New("fsx: 文件选择器失败: " + lines[len(lines)-1])
	}
	return errors.New("fsx: 文件选择器失败: " + err.Error())
}
