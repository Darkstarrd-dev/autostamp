package config

// Default returns the shipped defaults. Every value here is the UI_SPEC §2
// "default" column; changing one here without changing the spec is a contract
// break that tools/verify/ui-contract.mjs does not catch, so keep them synced.
func Default() Settings {
	return Settings{
		Version:  SchemaVersion,
		UI:       UI{Lang: "en", Theme: "light", Density: "two-col"},
		Security: Security{StrictOrigin: false},
		Session: Session{
			TTLMinutes:      120, // AGENTS §4: TTL 2h
			MaxFileMB:       256,
			MaxTotalMB:      2048,
			ScavengeMinutes: 5,
		},
		Seal: Seal{Despill: true, AlphaTrim: true, ResampleDPI: 300},
		Apply: Apply{
			Blend:       "multiply",
			Opacity:     0.6,
			Brightness:  1,
			Saturate:    1,
			Scale:       0.202, // = seal 120 pt / A4 page 595 pt (UI_SPEC §2)
			Pos:         "130,480",
			Anchor:      "center",
			Offset:      "0,0",
			Rotation:    0,
			Pages:       "1-2,5",
			CrossPage:   false,
			Binding:     "right",
			StartOffset: 0,
		},
		Split:  Split{Auto: true, Mode: "v2", Rows: 1, Cols: 2, CutFractions: "0.5", Pages: "all"},
		Export: Export{Mode: "vector", DPI: "150", CustomDPI: 150, Quality: 75, Pages: "all"},
	}
}
