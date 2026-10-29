package app

import (
	"fmt"
	"log/slog"
	"os/exec"
	"runtime"
)

// OpenBrowser asks the OS to open url in the default browser; it is the
// fallback path used when WebView2 is unavailable (AGENTS §2 / D5).
func OpenBrowser(url string, log *slog.Logger) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		// rundll32 hands the URL to the shell without going through cmd.exe,
		// which would need quoting for a URL the user did not type.
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		log.Error("open browser failed", "url", url, "err", err)
		return fmt.Errorf("open browser: %w", err)
	}
	log.Info("opened system browser", "url", url)
	return nil
}
