// Command comprobe measures how COM init and WebView2 behave on this machine,
// in the order the app uses them. It is a probe, not a test: docs/FACTS.md
// records what it prints. Run:
//
//	go run ./tools/verify/comprobe             // COM only
//	go run ./tools/verify/comprobe -window     // plus a real window, closed after 3s
//	go run ./tools/verify/comprobe -order=com-first
package main

import (
	"flag"
	"fmt"
	"os"
	"runtime"
	"syscall"
	"time"

	"github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

func coinit(label string, flags uint32) {
	err := windows.CoInitializeEx(0, flags)
	if err == nil {
		fmt.Printf("%s flags=0x%x: ok\n", label, flags)
		return
	}
	errno := syscall.Errno(0)
	if e, ok := err.(syscall.Errno); ok {
		errno = e
	}
	fmt.Printf("%s flags=0x%x: err=%v errno=0x%x (format_message=%q)\n", label, flags, err, uint32(errno), errno.Error())
}

func main() {
	order := flag.String("order", "locked-first", "locked-first|com-first|none")
	window := flag.Bool("window", false, "create a real WebView2 window after COM init")
	flag.Parse()

	if *order == "com-first" {
		coinit("CoInitializeEx before LockOSThread", 0x2)
	}
	if *order != "none" {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
	}
	if *order != "com-first" {
		coinit("CoInitializeEx after LockOSThread", 0x2)
	}

	if !*window {
		windows.CoUninitialize()
		return
	}

	wv := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:         false,
		AutoFocus:     true,
		DataPath:      os.TempDir(),
		WindowOptions: webview2.WindowOptions{Title: "AutoStamp COM probe", Width: 420, Height: 300, Center: true},
	})
	if wv == nil {
		fmt.Println("webview2.NewWithOptions returned nil (WebView2 runtime missing?)")
		windows.CoUninitialize()
		os.Exit(2)
	}
	fmt.Println("webview window created")
	wv.SetTitle("AutoStamp COM probe")
	wv.Navigate("data:text/html,probe")
	go func() {
		time.Sleep(3 * time.Second)
		wv.Terminate()
	}()
	wv.Run()
	fmt.Println("webview window closed")
	windows.CoUninitialize()
}
