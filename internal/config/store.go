package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"autostamp/internal/fsx"
)

// Store is the settings.json document plus its on-disk location.
//
// It is safe for concurrent use: the HTTP handlers hold a single *Store.
type Store struct {
	path string
	mu   sync.RWMutex
	s    Settings
}

// Load reads settings.json, falling back to Default() when the file is missing
// or unparsable. A corrupt file is renamed to settings.json<suffix>.corrupt-<ts>
// instead of being overwritten, so a bad hand-edit is still recoverable.
func Load(path string) (*Store, error) {
	st := &Store{path: path, s: Default()}
	data, err := fsx.ReadIfExists(path)
	if err != nil {
		return nil, err
	}
	if data == nil {
		// First run: create the file so the user has something to edit.
		if err := st.saveLocked(); err != nil {
			return nil, err
		}
		return st, nil
	}
	var got Settings
	if err := json.Unmarshal(data, &got); err != nil {
		backup := path + ".corrupt-" + time.Now().UTC().Format("20060102T150405")
		_ = os.Rename(path, backup)
		st.s = Default()
		if serr := st.saveLocked(); serr != nil {
			return nil, serr
		}
		return st, fmt.Errorf("settings.json unreadable (renamed to %s, defaults written): %w", backup, err)
	}
	st.s = got
	if err := Sanitize(&st.s); err != nil {
		// Values were clamped; persist the corrected document once.
		if serr := st.saveLocked(); serr != nil {
			return st, serr
		}
		return st, fmt.Errorf("settings.json contained out-of-range values (clamped): %w", err)
	}
	return st, nil
}

// Path returns the absolute settings path.
func (s *Store) Path() string { return s.path }

// Snapshot returns a copy of the current document (json-encoded by handlers).
func (s *Store) Snapshot() Settings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	cp := s.s
	cp.RecentFiles = append([]RecentRef(nil), s.s.RecentFiles...)
	cp.RecentSeals = append([]RecentRef(nil), s.s.RecentSeals...)
	return cp
}

// Apply merges p into the document, clamps, then saves atomically. It returns
// the sanitized document plus the clamp error (if any) so the API can echo a
// warning without failing the request.
func (s *Store) Apply(p *Patch) (Settings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	Merge(&s.s, p)
	clampErr := Sanitize(&s.s)
	if err := s.saveLocked(); err != nil {
		return s.s, err
	}
	return s.s, clampErr
}

// SetRecentSeal records one opened seal path (most recent last) and saves —
// the drop-down's record channel (HD8); the file shape mirrors SetRecent.
func (s *Store) SetRecentSeal(path string) {
	if path == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	out := make([]RecentRef, 0, len(s.s.RecentSeals)+1)
	for _, r := range s.s.RecentSeals {
		if fsx.EqualPath(r.Path, path) {
			continue
		}
		out = append(out, r)
	}
	out = append(out, RecentRef{Path: path, OpenedAt: now})
	s.s.RecentSeals = trimRecent(out, 24)
	_ = s.saveLocked()
}

// SetRecent records one opened path (most recent last) and saves.
func (s *Store) SetRecent(path string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	out := make([]RecentRef, 0, len(s.s.RecentFiles)+1)
	for _, r := range s.s.RecentFiles {
		if fsx.EqualPath(r.Path, path) {
			continue
		}
		out = append(out, r)
	}
	out = append(out, RecentRef{Path: path, OpenedAt: now})
	s.s.RecentFiles = trimRecent(out, 24)
	_ = s.saveLocked()
}

func (s *Store) saveLocked() error {
	data, err := json.MarshalIndent(s.s, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return fmt.Errorf("mkdir settings dir: %w", err)
	}
	return fsx.AtomicWrite(s.path, append(data, '\n'), 0o600)
}

// Dir returns the per-user config directory (%APPDATA%\AutoStamp on Windows;
// $XDG_CONFIG_HOME or ~/.config/AutoStamp elsewhere -- AGENTS §4).
func Dir() (string, error) {
	switch runtime.GOOS {
	case "windows":
		appdata := os.Getenv("APPDATA")
		if appdata == "" {
			return "", fmt.Errorf("APPDATA is empty")
		}
		return filepath.Join(appdata, "AutoStamp"), nil
	case "darwin":
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, "Library", "Application Support", "AutoStamp"), nil
	default:
		if x := os.Getenv("XDG_CONFIG_HOME"); x != "" {
			return filepath.Join(x, "AutoStamp"), nil
		}
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, ".config", "AutoStamp"), nil
	}
}

// SettingsPath is <config dir>/settings.json.
func SettingsPath() (string, error) {
	d, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(d, "settings.json"), nil
}

// SealsDir is <config dir>/seals (P6 preset store).
func SealsDir() (string, error) {
	d, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(d, "seals"), nil
}
