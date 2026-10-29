package config

import (
	"fmt"
	"strconv"
	"strings"
)

// BlendModes is the frozen 16-name vocabulary (UI_SPEC §2 16blend词表, PDF
// table 136, FACTS §1.2). A name outside the list is rejected rather than
// coerced: a typo in a blend name would silently change the rendered seal.
var BlendModes = []string{
	"normal", "multiply", "screen", "overlay", "darken", "lighten",
	"color-dodge", "color-burn", "hard-light", "soft-light", "difference",
	"exclusion", "hue", "saturation", "color", "luminosity",
}

// Sanitize clamps every field back into the UI_SPEC §2 range and returns the
// first violation as an error while still fixing the value: the app must keep
// running on a bad PATCH, and the UI only needs to show the toast.
func Sanitize(s *Settings) error {
	var firstErr error
	fail := func(format string, args ...any) {
		if firstErr != nil {
			return
		}
		firstErr = fmt.Errorf(format, args...)
	}

	if s.UI.Lang != "en" && s.UI.Lang != "cn" {
		fail("ui.lang %q not in en|cn", s.UI.Lang)
		s.UI.Lang = Default().UI.Lang
	}
	if s.UI.Theme != "light" && s.UI.Theme != "dark" {
		fail("ui.theme %q not in light|dark", s.UI.Theme)
		s.UI.Theme = Default().UI.Theme
	}
	if s.UI.Density != "two-col" && s.UI.Density != "single-col" && s.UI.Density != "collapsed" {
		fail("ui.density %q not in two-col|single-col|collapsed", s.UI.Density)
		s.UI.Density = Default().UI.Density
	}

	if !inRange(s.Seal.ResampleDPI, 72, 600) {
		fail("seal.resampleDpi %d out of 72..600", s.Seal.ResampleDPI)
	}
	s.Seal.ResampleDPI = clampInt(s.Seal.ResampleDPI, 72, 600)

	a := &s.Apply
	if !oneOf(BlendModes, a.Blend) {
		fail("apply.blend %q not in the 16 blend names", a.Blend)
		a.Blend = Default().Apply.Blend
	}
	if !inRangeF(a.Opacity, 0, 1) {
		fail("apply.opacity %g out of 0..1", a.Opacity)
	}
	a.Opacity = clampFlt(a.Opacity, 0, 1)
	if !inRangeF(a.Brightness, 0, 2) {
		fail("apply.brightness %g out of 0..2", a.Brightness)
	}
	a.Brightness = clampFlt(a.Brightness, 0, 2)
	if !inRangeF(a.Saturate, 0, 3) {
		fail("apply.saturate %g out of 0..3", a.Saturate)
	}
	a.Saturate = clampFlt(a.Saturate, 0, 3)
	if !inRangeF(a.Scale, 0.05, 0.9) {
		fail("apply.scale %g out of 0.05..0.9", a.Scale)
	}
	a.Scale = clampFlt(a.Scale, 0.05, 0.9)
	if a.Anchor != "tl" && a.Anchor != "tr" && a.Anchor != "center" && a.Anchor != "bl" && a.Anchor != "br" {
		fail("apply.anchor %q not in tl|tr|center|bl|br", a.Anchor)
		a.Anchor = "center"
	}
	if !inRangeF(a.Rotation, -180, 180) {
		fail("apply.rotation %g out of -180..180", a.Rotation)
	}
	a.Rotation = clampFlt(a.Rotation, -180, 180)
	if !inRangeF(a.StartOffset, 0, 200) {
		fail("apply.startOffset %g out of 0..200 pt", a.StartOffset)
	}
	a.StartOffset = clampFlt(a.StartOffset, 0, 200)
	if !validPairs(a.Pos) {
		fail("apply.pos %q not x,y", a.Pos)
		a.Pos = Default().Apply.Pos
	}
	if !validPairs(a.Offset) {
		fail("apply.offset %q not dx,dy", a.Offset)
		a.Offset = "0,0"
	}
	if !validPageSpec(a.Pages) {
		fail("apply.pages %q not in pages vocabulary", a.Pages)
		a.Pages = Default().Apply.Pages
	}
	if a.Binding != "right" && a.Binding != "alternate" && a.Binding != "none" {
		fail("ui.crosspage.binding %q not in right|alternate|none", a.Binding)
		a.Binding = "right"
	}
	if a.CrossPage && a.Binding == "none" {
		// UI_SPEC §8 D2: a cross-page stamp cannot stay on "无骑缝章"; the mock
		// applies the same correction (i18n key crosspage.binding.fixed).
		fail("ui.crosspage.binding=none while apply.crossPage=true")
		a.Binding = "right"
	}

	sp := &s.Split
	if sp.Mode != "off" && sp.Mode != "v2" && sp.Mode != "h2" && sp.Mode != "grid" {
		fail("ui.split.mode %q not in off|v2|h2|grid", sp.Mode)
		sp.Mode = "v2"
	}
	sp.Rows = clampInt(sp.Rows, 1, 6)
	sp.Cols = clampInt(sp.Cols, 1, 6)
	if !validFractions(sp.CutFractions) {
		fail("split.cutFractions %q not a 0..1 comma list", sp.CutFractions)
		sp.CutFractions = "0.5"
	}
	if !validPageSpec(sp.Pages) {
		fail("split.pages %q not in pages vocabulary", sp.Pages)
		sp.Pages = "all"
	}

	ex := &s.Export
	if ex.Mode != "vector" && ex.Mode != "raster" {
		fail("export.mode %q not in vector|raster", ex.Mode)
		ex.Mode = "vector"
	}
	if ex.DPI != "72" && ex.DPI != "150" && ex.DPI != "300" && ex.DPI != "custom" {
		fail("export.dpi %q not in 72|150|300|custom", ex.DPI)
		ex.DPI = "150"
	}
	if !inRange(ex.CustomDPI, 96, 600) {
		fail("export.customDpi %d out of 96..600", ex.CustomDPI)
	}
	ex.CustomDPI = clampInt(ex.CustomDPI, 96, 600)
	if !inRange(ex.Quality, 40, 95) {
		fail("export.quality %d out of 40..95", ex.Quality)
	}
	ex.Quality = clampInt(ex.Quality, 40, 95)
	if !validPageSpec(ex.Pages) {
		fail("export.pages %q not in pages vocabulary", ex.Pages)
		ex.Pages = "all"
	}

	if !inRange(s.Session.TTLMinutes, 1, 24*60) {
		fail("session.ttlMinutes %d out of 1..1440", s.Session.TTLMinutes)
	}
	s.Session.TTLMinutes = clampInt(s.Session.TTLMinutes, 1, 24*60)
	if !inRange(s.Session.MaxFileMB, 1, 4096) {
		fail("session.maxFileMB %d out of 1..4096", s.Session.MaxFileMB)
	}
	s.Session.MaxFileMB = clampInt(s.Session.MaxFileMB, 1, 4096)
	if !inRange(s.Session.MaxTotalMB, 1, 32768) {
		fail("session.maxTotalMB %d out of 1..32768", s.Session.MaxTotalMB)
	}
	s.Session.MaxTotalMB = clampInt(s.Session.MaxTotalMB, 1, 32768)
	if !inRange(s.Session.ScavengeMinutes, 1, 60) {
		fail("session.scavengeMinutes %d out of 1..60", s.Session.ScavengeMinutes)
	}
	s.Session.ScavengeMinutes = clampInt(s.Session.ScavengeMinutes, 1, 60)

	for i := range s.RecentFiles {
		s.RecentFiles[i].Path = strings.TrimSpace(s.RecentFiles[i].Path)
	}
	s.RecentFiles = trimRecent(s.RecentFiles, 24)
	return firstErr
}

// trimRecent keeps the newest keep entries (the list is stored oldest first).
func trimRecent(in []RecentRef, keep int) []RecentRef {
	if keep <= 0 || len(in) <= keep {
		return in
	}
	return in[len(in)-keep:]
}

// validPageSpec accepts the pages vocabulary: all | none | 1 | 1-2 | 1-2,5.
func validPageSpec(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return false
	}
	if s == "all" || s == "none" {
		return true
	}
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			return false
		}
		lo, hi, ok := strings.Cut(part, "-")
		if !ok {
			if _, err := strconv.Atoi(part); err != nil {
				return false
			}
			continue
		}
		if _, err := strconv.Atoi(strings.TrimSpace(lo)); err != nil {
			return false
		}
		if _, err := strconv.Atoi(strings.TrimSpace(hi)); err != nil {
			return false
		}
	}
	return true
}

// validFractions accepts the split vocabulary: 0..1 floats separated by commas.
func validFractions(s string) bool {
	for _, part := range strings.Split(strings.TrimSpace(s), ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			return false
		}
		v, err := strconv.ParseFloat(part, 64)
		if err != nil || !(v > 0 && v < 1) {
			return false
		}
	}
	return strings.TrimSpace(s) != ""
}

// validPairs accepts "x,y" and "dx,dy" (allowing a leading sign).
func validPairs(s string) bool {
	lo, hi, ok := strings.Cut(strings.TrimSpace(s), ",")
	if !ok || lo == "" || hi == "" {
		return false
	}
	for _, p := range []string{lo, hi} {
		if _, err := strconv.ParseFloat(strings.TrimSpace(p), 64); err != nil {
			return false
		}
	}
	return true
}

// ParsePairs splits "x,y" into floats (used by api handlers, not validation).
func ParsePairs(s string) (float64, float64, error) {
	if !validPairs(s) {
		return 0, 0, fmt.Errorf("not x,y: %q", s)
	}
	lo, hi, _ := strings.Cut(strings.TrimSpace(s), ",")
	a, err := strconv.ParseFloat(strings.TrimSpace(lo), 64)
	if err != nil {
		return 0, 0, err
	}
	b, err := strconv.ParseFloat(strings.TrimSpace(hi), 64)
	if err != nil {
		return 0, 0, err
	}
	return a, b, nil
}

// ParseFractions splits the cut-fraction vocabulary into floats.
func ParseFractions(s string) ([]float64, error) {
	if !validFractions(s) {
		return nil, fmt.Errorf("not a 0..1 list: %q", s)
	}
	var out []float64
	for _, part := range strings.Split(s, ",") {
		v, err := strconv.ParseFloat(strings.TrimSpace(part), 64)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

func inRange(v, lo, hi int) bool { return v >= lo && v <= hi }

func inRangeF(v, lo, hi float64) bool { return v >= lo && v <= hi }

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func clampFlt(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func oneOf(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}
