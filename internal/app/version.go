// Package app wires the process: loopback listener, HTTP server, browser
// fallback. It holds the version information that /api/health reports.
package app

import (
	"regexp"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
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

// devVersion is the version string AutoStamp shows while no release tag
// exists: the window title, the browser tab, the topbar title and /api/health.
// It is a var so a release build can stamp it without touching the source:
// `go build -ldflags "-X autostamp/internal/app.devVersion=v1.2.3"`.
var devVersion = "0.1-dev"

// ReadBuild extracts the version triple from the binary's build info. The
// version is only taken from the module path when that is a real release tag:
// what Go stamps for an untagged commit (v0.0.0-<date>-<hash>+dirty) says
// "unreleased", and letting it into the title bar would be noise.
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
	b.Version = pickVersion(info.Main.Version, devVersion)
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

// goPseudoRe matches the version fragment the Go toolchain derives for a commit
// with no tag: the "-<14-digit date>-<hash>" tail inside v0.0.0-…
var goPseudoRe = regexp.MustCompile(`-\d{14}-[0-9a-f]{8,}`)

// pickVersion keeps a real release tag and falls back to dev for everything the
// toolchain invented: a devel stand-in, an untagged pseudo-version, or a dirty
// work tree ("+dirty"/"+unsaved" never names a release either).
func pickVersion(main, dev string) string {
	switch {
	case main == "" || main == "devel" || main == "(devel)":
		return dev
	case strings.Contains(main, "+") || goPseudoRe.MatchString(main):
		return dev
	default:
		return main
	}
}
