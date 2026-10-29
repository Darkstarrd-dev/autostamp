//go:build windows && webview

package main

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"syscall"

	"github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

// openAppWindow opens the native WebView2 window and blocks until it closes.
//
// Threading/COM order is deliberate and must not be reordered: the window needs
// an STA apartment, and the deferred CoUninitialize runs before the deferred
// UnlockOSThread (defer LIFO) because CoUninitialize has to execute on the same
// thread that called CoInitializeEx. The same sequence is used by the reference
// app's host_webview_window.go:117-132.
func openAppWindow(url, title string, log *slog.Logger) (err error) {
	defer func() {
		if r := recover(); r != nil {
			log.Error("webview window panic", "panic", r, "stack", string(debug.Stack()))
			err = fmt.Errorf("webview window crashed: %v", r)
		}
	}()

	// Pin the goroutine to one OS thread for the window's whole lifetime;
	// WebView2 dispatches messages on this thread.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	// COINIT_APARTMENTTHREADED = 0x2.
	//
	// The return values need care (measured 2026-10-29 with
	// tools/verify/comprobe, docs/FACTS §1.7): x/sys/windows turns the
	// S_FALSE/1 "already initialised" code into syscall.Errno(1), which
	// Error() renders as the misleading "Incorrect function." Both that and
	// RPC_E_CHANGED_MODE (0x80010106, the thread entered MTA) are tolerated the
	// same way the reference app does: the apartment is already set up, and the
	// window still pumps correctly.
	const (
		sFalse         = syscall.Errno(1)
		rpcChangedMode = windows.Errno(0x80010106)
	)
	if cerr := windows.CoInitializeEx(0, 0x2); cerr != nil {
		if errors.Is(cerr, sFalse) || errors.Is(cerr, rpcChangedMode) {
			log.Debug("COM already initialised on this thread", "err", cerr)
		} else {
			return fmt.Errorf("CoInitializeEx: %w", cerr)
		}
	}
	defer windows.CoUninitialize()

	wv := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false,
		AutoFocus: true,
		DataPath:  webviewDataPath(log),
		WindowOptions: webview2.WindowOptions{
			Title:  title,
			Width:  1280,
			Height: 800,
			Center: true,
		},
	})
	if wv == nil {
		// Happens when the Evergreen WebView2 runtime is not installed; main
		// then falls back to the system browser instead of dying.
		return errors.New("WebView2 窗口创建失败（Runtime 未安装？）")
	}
	wv.SetTitle(title)
	wv.Navigate(url)
	log.Info("webview window opened", "title", title, "url", url)
	wv.Run()
	log.Info("webview window closed")
	return nil
}

// webviewDataPath keeps the WebView2 profile inside our cache directory: with a
// empty DataPath the runtime creates "<exe>.WebView2" next to the binary, which
// breaks portable usage and leaks profile locks.
func webviewDataPath(log *slog.Logger) string {
	base, err := os.UserCacheDir()
	if err != nil {
		log.Warn("cache dir unavailable, WebView2 will use its default profile path", "err", err)
		return ""
	}
	dir := filepath.Join(base, "AutoStamp", "webview2")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		log.Warn("mkdir webview data path failed, using default", "dir", dir, "err", err)
		return ""
	}
	return dir
}
