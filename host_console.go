//go:build !windows || !webview

package main

import (
	"errors"
	"log/slog"
)

// openAppWindow is the no-window build path. WebView2 is compiled in only on
// Windows with -tags webview (AGENTS §2, §5: 非 Windows / 无 WebView2 → 回退浏览器),
// so this build reports the window as unavailable and main falls back to opening
// the system browser (AGENTS §3: host_console.go).
func openAppWindow(url, title string, log *slog.Logger) error {
	log.Info("window not compiled in this build; using the system browser", "title", title, "url", url)
	return errors.New("webview window unavailable (build with -tags webview on Windows)")
}
