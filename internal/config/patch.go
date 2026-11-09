package config

// Patch is the partial document the POST /api/settings body accepts (AGENTS §6:
// 指针字段按需合并). A nil field means "keep the current value"; nested objects
// merge only when non-nil, so {"apply":{"opacity":0.42}} touches nothing else.
type Patch struct {
	UI          *PatchUI       `json:"ui,omitempty"`
	Security    *PatchSecurity `json:"security,omitempty"`
	Session     *PatchSession  `json:"session,omitempty"`
	Seal        *PatchSeal     `json:"seal,omitempty"`
	Apply       *PatchApply    `json:"apply,omitempty"`
	Split       *PatchSplit    `json:"split,omitempty"`
	Export      *PatchExport   `json:"export,omitempty"`
	Batch       *PatchBatch    `json:"batch,omitempty"`
	RecentFiles *[]RecentRef   `json:"recentFiles,omitempty"`
	// RecentSeals replaces the whole group (HD8: it is the only channel the
	// drop-down has to drop a stale record).
	RecentSeals *[]RecentRef `json:"recentSeals,omitempty"`
}

// PatchUI mirrors UI with pointer leaves.
type PatchUI struct {
	Lang           *string `json:"lang,omitempty"`
	Theme          *string `json:"theme,omitempty"`
	ConsoleVisible *bool   `json:"consoleVisible,omitempty"`
}

// PatchSecurity mirrors Security.
type PatchSecurity struct {
	StrictOrigin *bool `json:"strictOrigin,omitempty"`
}

// PatchSession mirrors Session.
type PatchSession struct {
	TTLMinutes      *int `json:"ttlMinutes,omitempty"`
	MaxFileMB       *int `json:"maxFileMB,omitempty"`
	MaxTotalMB      *int `json:"maxTotalMB,omitempty"`
	ScavengeMinutes *int `json:"scavengeMinutes,omitempty"`
}

// PatchSeal mirrors Seal.
type PatchSeal struct {
	Despill     *bool `json:"despill,omitempty"`
	AlphaTrim   *bool `json:"alphaTrim,omitempty"`
	ResampleDPI *int  `json:"resampleDpi,omitempty"`
}

// PatchApply mirrors Apply.
type PatchApply struct {
	Blend       *string  `json:"blend,omitempty"`
	Opacity     *float64 `json:"opacity,omitempty"`
	Brightness  *float64 `json:"brightness,omitempty"`
	Saturate    *float64 `json:"saturate,omitempty"`
	Scale       *float64 `json:"scale,omitempty"`
	Pos         *string  `json:"pos,omitempty"`
	Anchor      *string  `json:"anchor,omitempty"`
	Offset      *string  `json:"offset,omitempty"`
	Rotation    *float64 `json:"rotation,omitempty"`
	Pages       *string  `json:"pages,omitempty"`
	CrossPage   *bool    `json:"crossPage,omitempty"`
	Binding     *string  `json:"binding,omitempty"`
	StartOffset *float64 `json:"startOffset,omitempty"`
	SliceMode   *string  `json:"sliceMode,omitempty"`
	Cover       *int     `json:"cover,omitempty"`
}

// PatchSplit mirrors Split.
type PatchSplit struct {
	Auto         *bool   `json:"auto,omitempty"`
	Mode         *string `json:"mode,omitempty"`
	Rows         *int    `json:"rows,omitempty"`
	Cols         *int    `json:"cols,omitempty"`
	CutFractions *string `json:"cutFractions,omitempty"`
	Pages        *string `json:"pages,omitempty"`
}

// PatchExport mirrors Export.
type PatchExport struct {
	Mode      *string `json:"mode,omitempty"`
	DPI       *string `json:"dpi,omitempty"`
	CustomDPI *int    `json:"customDpi,omitempty"`
	Quality   *int    `json:"quality,omitempty"`
	Pages     *string `json:"pages,omitempty"`
}

// PatchBatch mirrors Batch (api.batch.*).
type PatchBatch struct {
	PresetName  *string `json:"presetName,omitempty"`
	DPI         *string `json:"dpi,omitempty"`
	CustomDPI   *int    `json:"customDpi,omitempty"`
	Quality     *int    `json:"quality,omitempty"`
	Concurrency *int    `json:"concurrency,omitempty"`
}

// Merge applies p onto s (pointer semantics above). It does not validate; call
// Sanitize afterwards so the caller sees one normalized document.
func Merge(s *Settings, p *Patch) {
	if p == nil {
		return
	}
	if p.UI != nil {
		setStr(&s.UI.Lang, p.UI.Lang)
		setStr(&s.UI.Theme, p.UI.Theme)
		if p.UI.ConsoleVisible != nil {
			s.UI.ConsoleVisible = *p.UI.ConsoleVisible
		}
	}
	if p.Security != nil && p.Security.StrictOrigin != nil {
		s.Security.StrictOrigin = *p.Security.StrictOrigin
	}
	if p.Session != nil {
		setInt(&s.Session.TTLMinutes, p.Session.TTLMinutes)
		setInt(&s.Session.MaxFileMB, p.Session.MaxFileMB)
		setInt(&s.Session.MaxTotalMB, p.Session.MaxTotalMB)
		setInt(&s.Session.ScavengeMinutes, p.Session.ScavengeMinutes)
	}
	if p.Seal != nil {
		if p.Seal.Despill != nil {
			s.Seal.Despill = *p.Seal.Despill
		}
		if p.Seal.AlphaTrim != nil {
			s.Seal.AlphaTrim = *p.Seal.AlphaTrim
		}
		setInt(&s.Seal.ResampleDPI, p.Seal.ResampleDPI)
	}
	if p.Apply != nil {
		a := &s.Apply
		setStr(&a.Blend, p.Apply.Blend)
		setFlt(&a.Opacity, p.Apply.Opacity)
		setFlt(&a.Brightness, p.Apply.Brightness)
		setFlt(&a.Saturate, p.Apply.Saturate)
		setFlt(&a.Scale, p.Apply.Scale)
		setStr(&a.Pos, p.Apply.Pos)
		setStr(&a.Anchor, p.Apply.Anchor)
		setStr(&a.Offset, p.Apply.Offset)
		setFlt(&a.Rotation, p.Apply.Rotation)
		setStr(&a.Pages, p.Apply.Pages)
		if p.Apply.CrossPage != nil {
			a.CrossPage = *p.Apply.CrossPage
		}
		setStr(&a.Binding, p.Apply.Binding)
		setFlt(&a.StartOffset, p.Apply.StartOffset)
		setStr(&a.SliceMode, p.Apply.SliceMode)
		setInt(&a.Cover, p.Apply.Cover)
	}
	if p.Split != nil {
		if p.Split.Auto != nil {
			s.Split.Auto = *p.Split.Auto
		}
		setStr(&s.Split.Mode, p.Split.Mode)
		setInt(&s.Split.Rows, p.Split.Rows)
		setInt(&s.Split.Cols, p.Split.Cols)
		setStr(&s.Split.CutFractions, p.Split.CutFractions)
		setStr(&s.Split.Pages, p.Split.Pages)
	}
	if p.Export != nil {
		setStr(&s.Export.Mode, p.Export.Mode)
		setStr(&s.Export.DPI, p.Export.DPI)
		setInt(&s.Export.CustomDPI, p.Export.CustomDPI)
		setInt(&s.Export.Quality, p.Export.Quality)
		setStr(&s.Export.Pages, p.Export.Pages)
	}
	if p.Batch != nil {
		setStr(&s.Batch.PresetName, p.Batch.PresetName)
		setStr(&s.Batch.DPI, p.Batch.DPI)
		setInt(&s.Batch.CustomDPI, p.Batch.CustomDPI)
		setInt(&s.Batch.Quality, p.Batch.Quality)
		setInt(&s.Batch.Concurrency, p.Batch.Concurrency)
	}
	if p.RecentFiles != nil {
		s.RecentFiles = *p.RecentFiles
	}
	if p.RecentSeals != nil {
		s.RecentSeals = *p.RecentSeals
	}
}

func setStr(dst *string, v *string) {
	if v != nil {
		*dst = *v
	}
}

func setInt(dst *int, v *int) {
	if v != nil {
		*dst = *v
	}
}

func setFlt(dst *float64, v *float64) {
	if v != nil {
		*dst = *v
	}
}
