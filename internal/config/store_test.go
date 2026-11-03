package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestDefaultPassesSanitize(t *testing.T) {
	s := Default()
	if err := Sanitize(&s); err != nil {
		t.Fatalf("shipped defaults must be self-consistent, got: %v", err)
	}
}

// TestDefaultsMatchSpecVocabulary pins the UI_SPEC §2 default column. A drift
// here means the UI shows one value while the server starts with another.
func TestDefaultsMatchSpecVocabulary(t *testing.T) {
	s := Default()
	cases := []struct {
		name string
		got  string
		want string
	}{
		{"ui.lang", s.UI.Lang, "en"},
		{"ui.density", s.UI.Density, "two-col"},
		{"ui.theme", s.UI.Theme, "light"},
		{"apply.opacity", jsonNum(s.Apply.Opacity), "0.6"},
		{"seal.prepare.resampleDpi", intStr(s.Seal.ResampleDPI), "300"},
		{"apply.blend", s.Apply.Blend, "multiply"},
		{"apply.pos", s.Apply.Pos, "130,480"},
		{"apply.anchor", s.Apply.Anchor, "center"},
		{"apply.pages", s.Apply.Pages, "1-2,5"},
		{"ui.crosspage.binding", s.Apply.Binding, "right"},
		{"split.mode", s.Split.Mode, "v2"},
		{"split.cols", intStr(s.Split.Cols), "2"},
		{"split.cutFractions", s.Split.CutFractions, "0.5"},
		{"export.mode", s.Export.Mode, "vector"},
		{"export.dpi", s.Export.DPI, "150"},
		{"export.quality", intStr(s.Export.Quality), "75"},
		{"session.ttlMinutes", intStr(s.Session.TTLMinutes), "120"},
		{"session.maxFileMB", intStr(s.Session.MaxFileMB), "256"},
		{"session.maxTotalMB", intStr(s.Session.MaxTotalMB), "2048"},
	}
	for _, tc := range cases {
		if tc.got != tc.want {
			t.Errorf("%s = %s, want %s", tc.name, tc.got, tc.want)
		}
	}
	// Booleans the UI_SPEC default column states explicitly.
	if !s.Seal.Despill || !s.Seal.AlphaTrim {
		t.Errorf("seal.prepare.despill/alphaTrim must default to true")
	}
	if s.Apply.CrossPage {
		t.Errorf("apply.crossPage must default to false")
	}
	if !s.Split.Auto {
		t.Errorf("split.auto must default to true (decision D3)")
	}
	if s.Apply.Scale != 0.202 || s.Apply.Opacity != 0.6 {
		t.Errorf("numeric defaults drifted: %+v", s.Apply)
	}
}

func intStr(v int) string { return jsonNum(v) }

func jsonNum(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "?"
	}
	return string(b)
}

func TestSanitizeClampsAndReports(t *testing.T) {
	cases := []struct {
		name   string
		mut    func(*Settings)
		ok     func(*Settings) bool
		wantRe string
	}{
		{
			"opacity above range is clamped to 1",
			func(s *Settings) { s.Apply.Opacity = 1.4 },
			func(s *Settings) bool { return s.Apply.Opacity == 1 },
			"out of 0..1",
		},
		{
			"unknown blend name is rejected not coerced",
			func(s *Settings) { s.Apply.Blend = "multiply-x" },
			func(s *Settings) bool { return s.Apply.Blend == "multiply" },
			"not in the 16 blend names",
		},
		{
			"custom pages vocabulary is rejected",
			func(s *Settings) { s.Apply.Pages = "1-2-5" },
			func(s *Settings) bool { return s.Apply.Pages == "1-2,5" },
			"pages vocabulary",
		},
		{
			"cross-page stamp cannot stay on binding=none (D2)",
			func(s *Settings) { s.Apply.CrossPage = true; s.Apply.Binding = "none" },
			func(s *Settings) bool { return s.Apply.Binding == "right" && s.Apply.CrossPage },
			"binding=none while apply.crossPage=true",
		},
		{
			"quality outside 40..95 is clamped",
			func(s *Settings) { s.Export.Quality = 99 },
			func(s *Settings) bool { return s.Export.Quality == 95 },
			"export.quality",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := Default()
			tc.mut(&s)
			err := Sanitize(&s)
			if err == nil {
				t.Fatal("expected a violation error")
			}
			if !strings.Contains(err.Error(), tc.wantRe) {
				t.Errorf("error %q does not mention %q", err, tc.wantRe)
			}
			if !tc.ok(&s) {
				t.Errorf("value not repaired: %+v", s.Apply)
			}
		})
	}
}

func TestSanitizeAcceptsValidVocabulary(t *testing.T) {
	for _, pages := range []string{"all", "none", "1", "1-2", "1-2,5", "3-7,10-12"} {
		s := Default()
		s.Apply.Pages = pages
		if err := Sanitize(&s); err != nil {
			t.Errorf("pages %q must be valid: %v", pages, err)
		}
	}
	for _, f := range []string{"0.5", "0.5,0.25", "0.34"} {
		s := Default()
		s.Split.CutFractions = f
		if err := Sanitize(&s); err != nil {
			t.Errorf("cutFractions %q must be valid: %v", f, err)
		}
	}
	// pdfcpu rejects >= 1 (FACTS §2.3): the validator must agree.
	for _, bad := range []string{"1", "0.5,1", "0", "-0.2", "abc", "0.5;0.5"} {
		s := Default()
		s.Split.CutFractions = bad
		if err := Sanitize(&s); err == nil {
			t.Errorf("cutFractions %q must be rejected", bad)
		}
	}
	for _, pos := range []string{"130,480", "-10,-20", "0,0"} {
		s := Default()
		s.Apply.Pos = pos
		if err := Sanitize(&s); err != nil {
			t.Errorf("pos %q must be valid: %v", pos, err)
		}
	}
}

func TestParseHelpers(t *testing.T) {
	x, y, err := ParsePairs("-4,12.5")
	if err != nil || x != -4 || y != 12.5 {
		t.Fatalf("ParsePairs: %v %v %v", x, y, err)
	}
	fs, err := ParseFractions("0.5,0.25")
	if err != nil || len(fs) != 2 || fs[0] != 0.5 || fs[1] != 0.25 {
		t.Fatalf("ParseFractions: %v %v", fs, err)
	}
	if _, _, err := ParsePairs("130"); err == nil {
		t.Error("ParsePairs must reject a single number")
	}
	if _, err := ParseFractions("0.5,"); err == nil {
		t.Error("ParseFractions must reject a trailing comma")
	}
}

func TestPatchMergeKeepsOtherGroups(t *testing.T) {
	s := Default()
	before := s
	p := Patch{Apply: &PatchApply{Opacity: new(0.42)}}
	Merge(&s, &p)
	if s.Apply.Opacity != 0.42 {
		t.Errorf("apply.opacity = %v, want 0.42", s.Apply.Opacity)
	}
	if s.Apply.Blend != before.Apply.Blend || s.Apply.Scale != before.Apply.Scale {
		t.Errorf("sibling apply fields changed: %+v", s.Apply)
	}
	if s.Export != before.Export || s.Split != before.Split || s.UI != before.UI {
		t.Errorf("other groups changed by an apply-only patch")
	}
}

func TestStoreFirstRunWritesDefaults(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	st, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("first run must create the file: %v", err)
	}
	var back Settings
	if err := json.Unmarshal(data, &back); err != nil {
		t.Fatalf("written settings unparsable: %v", err)
	}
	if back.Version != SchemaVersion || back.Apply.Blend != "multiply" {
		t.Errorf("defaults not written: %+v", back)
	}
	if st.Snapshot().Session.TTLMinutes != 120 {
		t.Errorf("store snapshot lost defaults")
	}
}

func TestStoreApplyPersistsAndWarns(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	st, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	saved, clampErr := st.Apply(&Patch{Export: &PatchExport{CustomDPI: new(9000), Quality: new(80)}})
	if clampErr == nil {
		t.Fatal("out-of-range customDpi must report a clamp warning")
	}
	if saved.Export.CustomDPI != 600 || saved.Export.Quality != 80 {
		t.Errorf("clamp/merge wrong: %+v", saved.Export)
	}
	st2, err := Load(path)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got := st2.Snapshot(); got.Export.CustomDPI != 600 {
		t.Errorf("persisted customDpi = %d, want 600", got.Export.CustomDPI)
	}
	tmps, _ := filepath.Glob(filepath.Join(filepath.Dir(path), ".tmp-*"))
	if len(tmps) != 0 {
		t.Errorf("temp files left behind: %v", tmps)
	}
}

func TestStoreCorruptFileIsBackedUp(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	st, err := Load(path)
	if err == nil {
		t.Fatal("expected an error naming the backup")
	}
	if !strings.Contains(err.Error(), ".corrupt-") {
		t.Errorf("error must mention the backup file: %v", err)
	}
	if st == nil {
		t.Fatal("store must still be usable with defaults")
	}
	if st.Snapshot().Apply.Opacity != 0.6 {
		t.Errorf("corrupt file must fall back to defaults")
	}
	backs, _ := filepath.Glob(filepath.Join(dir, "*.corrupt-*"))
	if len(backs) != 1 {
		t.Errorf("backup file count = %d, want 1", len(backs))
	}
}

func TestStoreClampsOnLoad(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	if err := os.WriteFile(path, []byte(`{"version":1,"apply":{"opacity":9,"blend":"nope"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := Load(path)
	if err == nil || !strings.Contains(err.Error(), "out-of-range") {
		t.Fatalf("expected a clamp error, got %v", err)
	}
	st, _ := Load(path)
	got := st.Snapshot()
	if got.Apply.Opacity != 1 || got.Apply.Blend != "multiply" {
		t.Errorf("on-load clamp failed: %+v", got.Apply)
	}
}

func TestSetRecentDedupesAndTrims(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	st, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	st.SetRecent(`C:\Docs\A.pdf`)
	st.SetRecent(`C:\Docs\B.pdf`)
	again := `C:\Docs\A.pdf`
	if runtime.GOOS == "windows" {
		again = `c:\docs\a.pdf` // case-insensitive filesystem
	}
	st.SetRecent(again)
	got := st.Snapshot().RecentFiles
	if len(got) != 2 {
		t.Fatalf("recent list = %+v, want 2 entries", got)
	}
	if got[0].Path != `C:\Docs\B.pdf` {
		t.Errorf("list is oldest-first: got[0] = %s, want C:\\Docs\\B.pdf", got[0].Path)
	}
	if got[1].Path != again {
		t.Errorf("re-opening A must move it to the end, got %+v", got)
	}
	for i := 0; i < 30; i++ {
		st.SetRecent(fmt.Sprintf(`C:\y\f%02d.pdf`, i))
	}
	list := st.Snapshot().RecentFiles
	if n := len(list); n != 24 {
		t.Errorf("recent list = %d, want the 24 newest of 32", n)
	}
	if list[0].Path == `C:\Docs\B.pdf` {
		t.Errorf("the oldest entry should have been trimmed, still there: %s", list[0].Path)
	}
}

func TestSnapshotCopiesSlice(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	st, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	st.SetRecent(`C:\Docs\A.pdf`)
	snap := st.Snapshot()
	snap.RecentFiles[0].Path = "mutated"
	if st.Snapshot().RecentFiles[0].Path == "mutated" {
		t.Error("Snapshot must not alias the stored slice")
	}
}

// The batch group is the front-end run-queue's own settings (api.batch.*). Its
// dpi/quality really drive the per-file raster export (AGENTS §5.21 BM1), so the
// defaults are pinned to what UI_SPEC §8 BR3/BR6 confirm, and the clamp rules
// guard against a silent "stamped at an unexpected resolution".
func TestBatchDefaultsMatchVocabulary(t *testing.T) {
	b := Default().Batch
	if b.DPI != "150" || b.CustomDPI != 150 || b.Quality != 75 {
		t.Errorf("batch defaults = %+v, want dpi 150 / customDpi 150 / quality 75", b)
	}
	if b.Concurrency != 2 {
		t.Errorf("batch.concurrency = %d, want the BR3 default 2", b.Concurrency)
	}
	if b.PresetName != "" {
		t.Errorf("batch.presetName = %q, want empty (BR6: chosen, not guessed)", b.PresetName)
	}
	s := Default()
	if err := Sanitize(&s); err != nil {
		t.Fatalf("Default() must sanitize clean: %v", err)
	}
}

func TestBatchSanitizeClamps(t *testing.T) {
	for _, tc := range []struct {
		name string
		mut  func(*Settings)
		ok   func(*Settings) bool
	}{
		{"dpi out of the three-step vocabulary falls back to 150", func(s *Settings) { s.Batch.DPI = "999" }, func(s *Settings) bool { return s.Batch.DPI == "150" }},
		{"custom dpi below 96 clamps up", func(s *Settings) { s.Batch.CustomDPI = 10 }, func(s *Settings) bool { return s.Batch.CustomDPI == 96 }},
		{"quality above 95 clamps down", func(s *Settings) { s.Batch.Quality = 200 }, func(s *Settings) bool { return s.Batch.Quality == 95 }},
		{"concurrency above 8 clamps down (BR3)", func(s *Settings) { s.Batch.Concurrency = 64 }, func(s *Settings) bool { return s.Batch.Concurrency == 8 }},
		{"concurrency below 1 clamps up", func(s *Settings) { s.Batch.Concurrency = 0 }, func(s *Settings) bool { return s.Batch.Concurrency == 1 }},
	} {
		s := Default()
		tc.mut(&s)
		if err := Sanitize(&s); err == nil {
			t.Errorf("%s: want a warning", tc.name)
		}
		if !tc.ok(&s) {
			t.Errorf("%s: clamp did not land, batch = %+v", tc.name, s.Batch)
		}
	}
}

func TestBatchPatchMergesOnlySentFields(t *testing.T) {
	s := Default()
	p := Patch{Batch: &PatchBatch{Quality: intp(90), Concurrency: intp(4)}}
	Merge(&s, &p)
	if err := Sanitize(&s); err != nil {
		t.Fatalf("patched batch must stay in vocabulary: %v", err)
	}
	if s.Batch.Quality != 90 || s.Batch.Concurrency != 4 {
		t.Errorf("batch after patch = %+v, want quality 90 / concurrency 4", s.Batch)
	}
	if s.Batch.DPI != "150" || s.Batch.CustomDPI != 150 {
		t.Errorf("un-sent batch fields must survive: %+v", s.Batch)
	}
	if s.Export.Quality != 75 {
		t.Errorf("batch patch must not touch export: %+v", s.Export)
	}
}

func intp(v int) *int { return &v }
