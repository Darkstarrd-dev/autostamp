// Package console wraps log/slog so the app never calls the standard log
// package directly (AGENTS §7).
package console

import (
	"io"
	"log/slog"
	"os"
)

// New returns a logger writing key=value lines to w.
//
// A GUI-less desktop app starts either from a console window or from Explorer;
// in both cases stderr is the only channel the user can see, so the level is
// decided by the -verbose flag rather than a config file (settings.json has not
// been read yet when the first lines are logged).
func New(w io.Writer, verbose bool) *slog.Logger {
	lvl := slog.LevelInfo
	if verbose {
		lvl = slog.LevelDebug
	}
	h := slog.NewTextHandler(w, &slog.HandlerOptions{Level: lvl, AddSource: false})
	return slog.New(h)
}

// Stderr is the default sink.
func Stderr(verbose bool) *slog.Logger { return New(os.Stderr, verbose) }
