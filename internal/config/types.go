// Package config owns settings.json: defaults, load, atomic save and the
// pointer-field merge that the /api/settings PATCH body relies on (AGENTS §6).
package config

import (
	"time"
)

// SchemaVersion bumps when the on-disk layout changes incompatibly.
const SchemaVersion = 1

// Settings is the persisted document (settings.json in %APPDATA%\AutoStamp).
//
// Field names mirror the UI_SPEC §2 vocabulary, so the front-end sends the same
// names it puts on data-field and no second mapping layer appears.
type Settings struct {
	Version     int         `json:"version"`
	UI          UI          `json:"ui"`
	Security    Security    `json:"security"`
	Session     Session     `json:"session"`
	Seal        Seal        `json:"seal"`
	Apply       Apply       `json:"apply"`
	Split       Split       `json:"split"`
	Export      Export      `json:"export"`
	Batch       Batch       `json:"batch"`
	RecentFiles []RecentRef `json:"recentFiles,omitempty"`
}

// UI is the client-side view state (ui.* in UI_SPEC §2; never sent to the API).
type UI struct {
	Lang  string `json:"lang"`  // en|cn
	Theme string `json:"theme"` // light|dark
}

// Security gates the loopback hardening (AGENTS §5.11; P7 enforces it).
type Security struct {
	StrictOrigin bool `json:"strictOrigin"`
}

// Session bounds the tmpstore (AGENTS §4: TTL 2h, 256MiB/file, 2GiB total).
type Session struct {
	TTLMinutes      int `json:"ttlMinutes"`
	MaxFileMB       int `json:"maxFileMB"`
	MaxTotalMB      int `json:"maxTotalMB"`
	ScavengeMinutes int `json:"scavengeMinutes"`
}

// Seal maps api.seal.prepare.* (UI_SPEC §2).
type Seal struct {
	Despill     bool `json:"despill"`
	AlphaTrim   bool `json:"alphaTrim"`
	ResampleDPI int  `json:"resampleDpi"`
}

// Apply maps api.apply.* plus ui.crosspage.binding (UI_SPEC §2).
type Apply struct {
	Blend       string  `json:"blend"`
	Opacity     float64 `json:"opacity"`
	Brightness  float64 `json:"brightness"`
	Saturate    float64 `json:"saturate"`
	Scale       float64 `json:"scale"`
	Pos         string  `json:"pos"`
	Anchor      string  `json:"anchor"`
	Offset      string  `json:"offset"`
	Rotation    float64 `json:"rotation"`
	Pages       string  `json:"pages"`
	CrossPage   bool    `json:"crossPage"`
	Binding     string  `json:"binding"` // right|alternate|none (UI_SPEC §8 D2)
	StartOffset float64 `json:"startOffset"`
}

// Split maps api.split.* plus ui.split.mode.
type Split struct {
	Auto         bool   `json:"auto"`
	Mode         string `json:"mode"` // off|v2|h2|grid
	Rows         int    `json:"rows"`
	Cols         int    `json:"cols"`
	CutFractions string `json:"cutFractions"`
	Pages        string `json:"pages"`
}

// Export maps api.export.*.
type Export struct {
	Mode      string `json:"mode"`      // vector|raster
	DPI       string `json:"dpi"`       // 72|150|300|custom
	CustomDPI int    `json:"customDpi"` // 96..600
	Quality   int    `json:"quality"`   // 40..95
	Pages     string `json:"pages"`
}

// Batch maps api.batch.* (UI_SPEC §2): the front-end run-queue's own settings
// group. Which preset to stamp with, the raster dpi/quality the export step
// will really use (BM1), and how many files may run at once (BR6/BR3).
type Batch struct {
	PresetName  string `json:"presetName"`  // BR6: required; empty = no run
	DPI         string `json:"dpi"`         // 72|150|300|custom
	CustomDPI   int    `json:"customDpi"`   // 96..600
	Quality     int    `json:"quality"`     // 40..95
	Concurrency int    `json:"concurrency"` // 1..8 (BR3: default 2)
}

// RecentRef is one entry of the most-recently-opened list (P6).
type RecentRef struct {
	Path     string    `json:"path"`
	OpenedAt time.Time `json:"openedAt"`
}
