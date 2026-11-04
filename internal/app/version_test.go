package app

import "testing"

// TestPickVersion pins what the user sees in the window title / browser tab /
// topbar title. The bug this guards against: Go stamps a pseudo-version
// (v0.0.0-20261103072915-f46b31ebafd1+dirty) for every untagged commit, and
// that string used to surface as the app version, making the title bar
// unreadable while claiming to be a release.
func TestPickVersion(t *testing.T) {
	cases := []struct {
		name string
		want string
	}{
		{"", devVersion},
		{"devel", devVersion},
		{"(devel)", devVersion},
		{"v0.0.0-20261103072915-f46b31ebafd1", devVersion},
		{"v0.0.0-20261103072915-f46b31ebafd1+dirty", devVersion},
		{"v1.3.0-20261103072915-f46b31ebafd1+unsaved", devVersion},
		{"v1.2.3", "v1.2.3"},
		{"v1.2.3-rc.1", "v1.2.3-rc.1"},
	}
	for _, tc := range cases {
		if got := pickVersion(tc.name, devVersion); got != tc.want {
			t.Errorf("pickVersion(%q) = %q, want %q", tc.name, got, tc.want)
		}
	}
}

// TestReadBuildVersionNeverPseudo asserts the version this checkout reports is
// either a clean tag or the dev banner - never the toolchain pseudo-version.
func TestReadBuildVersionNeverPseudo(t *testing.T) {
	v := ReadBuild().Version
	if v == "" {
		t.Fatal("ReadBuild reports an empty version")
	}
	if goPseudoRe.MatchString(v) {
		t.Errorf("ReadBuild version %q is a Go pseudo-version; the dev banner is expected until a tag exists", v)
	}
}
