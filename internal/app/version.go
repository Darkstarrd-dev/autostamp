// Package app wires the process: loopback listener, HTTP server, browser
// fallback. It holds the version information that /api/health reports.
package app

import (
	"runtime"
	"runtime/debug"
	"strconv"
)

// BuildInfo is the version triple reported by GET /api/health.
//
// The commit is not injected with -X ldflags: Go stamps VCS information into
// main packages automatically and we read it back here (AGENTS §4).
type BuildInfo struct {
	Version   string `json:"version"`
	Commit    string `json:"commit"`
	Modified  bool   `json:"modified"`
	GoVersion string `json:"go"`
	GOOS      string `json:"os"`
	Arch      string `json:"arch"`
}

// devVersion is what /api/health reports before a release tag exists. It is a
// var so a release build can stamp it without touching the source:
// `go build -ldflags "-X autostamp/internal/app.devVersion=v1.2.3"`.
var devVersion = "0.0.0-dev"

// ReadBuild extracts the version triple from the binary's build info.
//
// `go run` has no VCS stamps: Commit stays empty and Modified is false, so the
// launcher prints "commit n/a" instead of failing.
func ReadBuild() BuildInfo {
	b := BuildInfo{
		Version:   devVersion,
		GoVersion: runtime.Version(),
		GOOS:      runtime.GOOS,
		Arch:      runtime.GOARCH,
	}
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return b
	}
	for _, s := range info.Settings {
		switch s.Key {
		case "vcs.revision":
			if s.Value != "" {
				b.Commit = shorten(s.Value, 7)
			}
		case "vcs.modified":
			b.Modified, _ = strconv.ParseBool(s.Value)
		}
	}
	if v := info.Main.Version; v != "" && v != "devel" && v != "(devel)" {
		b.Version = v
	}
	return b
}

// String renders the one-line version banner used at startup.
func (b BuildInfo) String() string {
	commit := b.Commit
	if commit == "" {
		commit = "n/a"
	}
	if b.Modified {
		commit += " (dirty)"
	}
	return b.Version + " @" + commit + " " + b.GoVersion + " " + b.GOOS + "/" + b.Arch
}

func shorten(s string, n int) string {
	if len(s) < n {
		return s
	}
	return s[:n]
}
