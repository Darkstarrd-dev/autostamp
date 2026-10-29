package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"autostamp/internal/api"
	"autostamp/internal/app"
	"autostamp/internal/config"
	"autostamp/internal/console"
	"autostamp/internal/tmpstore"
)

// windowTitle is the WebView2/browser window title.
const windowTitle = "AutoStamp"

func main() {
	var (
		verbose   = flag.Bool("verbose", false, "调试日志（含静态资产请求）")
		noBrowser = flag.Bool("no-browser", false, "不自动打开系统浏览器")
		useWindow = flag.Bool("window", true, "尝试打开 WebView2 窗口（需要 webview 构建标签）")
	)
	flag.Parse()

	log := console.Stderr(*verbose)
	build := app.ReadBuild()
	log.Info("AutoStamp starting", "version", build.String(), "pid", os.Getpid())

	settings := loadSettings(log)

	ln, port, err := app.ListenLoopback()
	if err != nil {
		log.Error("listen failed", "err", err)
		os.Exit(1)
	}

	dir, err := sessionDir()
	if err != nil {
		log.Error("session dir failed", "err", err)
		os.Exit(1)
	}
	store, err := tmpstore.New(dir, tmpLimits(settings.Snapshot()), log)
	if err != nil {
		log.Error("tmpstore init failed", "dir", dir, "err", err)
		os.Exit(1)
	}
	defer store.Close()

	mux := api.NewMux(api.Deps{Version: build, Log: log, Settings: settings, Assets: store})
	srv := app.NewServer(ln, mux, log, port, settings.Snapshot().Security.StrictOrigin)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serveErr := make(chan error, 1)
	go func() { serveErr <- srv.Serve() }()

	// Periodic scavenge keeps a long-running session inside the quota
	// (AGENTS §4: TTL 2h); the interval comes from settings.
	if t := newTicker(time.Duration(settings.Snapshot().Session.ScavengeMinutes) * time.Minute); t != nil {
		defer t.Stop()
		go func() {
			for range t.C {
				store.Scavenge()
			}
		}()
	}

	url := srv.URL()
	log.Info("ready", "url", url)

	if *useWindow {
		if err := openAppWindow(url, windowTitle, log); err == nil {
			// The window owns the process lifetime: openAppWindow returned
			// because the user closed it, so the server goes down with it.
			if err := srv.Graceful(3 * time.Second); err != nil {
				log.Warn("server stop", "err", err)
			}
			return
		} else {
			// WebView2 is missing or the window refused to start; the browser
			// fallback keeps the app usable (AGENTS §2).
			log.Warn("webview window unavailable, using the browser", "err", err)
		}
	}

	if !*noBrowser {
		if err := app.OpenBrowser(url, log); err != nil {
			log.Warn("browser open failed; the page stays reachable", "url", url, "err", err)
		}
	}

	select {
	case err := <-serveErr:
		if err != nil {
			log.Error("server error", "err", err)
			os.Exit(1)
		}
	case <-ctx.Done():
		log.Info("signal received, stopping")
		if err := srv.Graceful(3 * time.Second); err != nil {
			log.Warn("server stop", "err", err)
		}
	}
}

// loadSettings resolves the settings path and loads the document. A load
// problem is logged, not fatal: defaults are already in memory, and the UI
// shows the warning later.
func loadSettings(log *slog.Logger) *config.Store {
	path, err := config.SettingsPath()
	if err != nil {
		path = filepath.Join(os.TempDir(), "AutoStamp", "settings.json")
		log.Warn("config dir unavailable, using temp fallback", "path", path, "err", err)
	}
	store, err := config.Load(path)
	if err != nil {
		log.Warn("settings.json", "path", path, "err", err)
	}
	if store != nil {
		log.Info("settings loaded", "path", store.Path())
	}
	return store
}

// tmpLimits maps the settings document onto the store limits.
func tmpLimits(s config.Settings) tmpstore.Limits {
	return tmpstore.Limits{
		TTL:      time.Duration(s.Session.TTLMinutes) * time.Minute,
		MaxFile:  int64(s.Session.MaxFileMB) << 20,
		MaxTotal: int64(s.Session.MaxTotalMB) << 20,
	}
}

// sessionDir is %LOCALAPPDATA%\AutoStamp\session (AGENTS §4), created 0o700.
func sessionDir() (string, error) {
	base, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	if runtime.GOOS == "darwin" {
		base = filepath.Join(base, "AutoStamp")
	} else {
		base = filepath.Join(base, "AutoStamp", "session")
	}
	return base, os.MkdirAll(base, 0o700)
}

// newTicker guards against a zero or negative interval.
func newTicker(d time.Duration) *time.Ticker {
	if d <= 0 {
		return nil
	}
	return time.NewTicker(d)
}
