// Package presetstore owns the seal preset library on disk: one JSON index plus
// one image file per preset (AGENTS §5.20, UI_SPEC §8 PR1/PR2).
//
// Layout (%APPDATA%\AutoStamp\seals\, i.e. config.SealsDir):
//
//	presets.json    index: []Preset, rewritten atomically on every change
//	p-<hash>.png    the seal image of one preset
//
// A preset is the seal image plus the parameter group that was on the panel when
// the user pressed 保存预设 (apply.* plus the seal prepare options). The image is
// copied out of the session store, so a preset survives a session purge and the
// batch path can stamp with it without any browser round trip.
package presetstore

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"autostamp/internal/fsx"
)

// indexFile is the single source of truth for the library. The images beside it
// are named after the preset name, so a name collision means "overwrite the same
// entry" instead of "grow another orphan file".
const indexFile = "presets.json"

// ErrNotFound is what Get/ImageFile answer with for an unknown preset name; the
// route maps it to 404 preset_not_found.
var ErrNotFound = errors.New("presetstore: 预设不存在")

// ErrBadName covers anything the user cannot use as a preset name: empty, too
// long, path separators, control characters. The route maps it to 400
// preset_bad_name rather than guessing a directory name.
var ErrBadName = errors.New("presetstore: 预设名不合法")

// maxNameLen bounds the index entry length: longer names are pasted blobs and
// make the list unreadable.

// maxPresetImageBytes matches the seal upload cap (api.maxSealBody = 20 MiB): a
// preset is a seal copy, so the same bound keeps the library bounded.
const maxPresetImageBytes = 20 << 20

// ErrImageTooLarge is what a copy that exceeds the cap reports.
var ErrImageTooLarge = errors.New("presetstore: 印章图像超过上限")

const maxNameLen = 120

// Params is the preset's parameter group. The field names mirror the frozen
// UI_SPEC §2 vocabulary (apply.* plus the seal.prepare options) because that is
// exactly what the panel holds and what /api/pdf/apply consumes. Concrete values
// (not pointers) are stored: the front end always sends what it is showing, so
// there is no "absent" to disambiguate.
type Params struct {
	Blend       string  `json:"blend"`
	Opacity     float64 `json:"opacity"`
	Scale       float64 `json:"scale"`
	Pos         string  `json:"pos,omitempty"`
	Anchor      string  `json:"anchor,omitempty"`
	Offset      string  `json:"offset,omitempty"`
	Rotation    float64 `json:"rotation"`
	Pages       string  `json:"pages,omitempty"`
	CrossPage   bool    `json:"crossPage"`
	Binding     string  `json:"binding,omitempty"`
	StartOffset float64 `json:"startOffset"`
	Despill     bool    `json:"despill"`
	AlphaTrim   bool    `json:"alphaTrim"`
	ResampleDPI int     `json:"resampleDpi"`
}

// Preset is one library entry. ImageFile is relative to the store directory, so
// the whole folder stays portable (PR2: no zip import/export - the directory
// itself is the data).
type Preset struct {
	Name       string    `json:"name"`
	ImageFile  string    `json:"imageFile"`
	ImageBytes int64     `json:"imageBytes"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
	Params     Params    `json:"params"`
}

// Store is the on-disk library with an in-memory index.
type Store struct {
	dir string
	log *slog.Logger

	mu     sync.RWMutex
	list   []Preset
	loaded bool
}

// New builds a store over dir. The directory is created on first write, not
// here: the app may never touch presets, and then there is nothing to create.
func New(dir string, log *slog.Logger) *Store {
	if log == nil {
		log = slog.Default()
	}
	return &Store{dir: dir, log: log}
}

// Dir is the library directory, exposed for logging and tests.
func (s *Store) Dir() string { return s.dir }

// List returns a copy of the library, newest updated first.
func (s *Store) List() ([]Preset, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.loadLocked(); err != nil {
		return nil, err
	}
	out := make([]Preset, len(s.list))
	copy(out, s.list)
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out, nil
}

// Get returns one entry by exact (trimmed) name.
func (s *Store) Get(name string) (Preset, error) {
	n, err := ValidateName(name)
	if err != nil {
		return Preset{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.loadLocked(); err != nil {
		return Preset{}, err
	}
	p, ok := s.findIndex(n)
	if !ok {
		return Preset{}, ErrNotFound
	}
	return p, nil
}

// Save writes the image bytes (from src) plus the parameter group under name,
// replacing any existing entry with the same name (PR2: 同名 = 覆盖).
//
// The image is staged in a temp file first: if the copy fails, the index still
// points at the previous bytes, which is what AGENTS §4 ("一律原子写") means for
// a two-file write.
func (s *Store) Save(name string, src io.Reader, p Params) (out Preset, err error) {
	n, err := ValidateName(name)
	if err != nil {
		return Preset{}, err
	}
	if src == nil {
		return Preset{}, errors.New("presetstore: 没有印章图像可以写入")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.loadLocked(); err != nil {
		return Preset{}, err
	}
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return Preset{}, fmt.Errorf("presetstore: 建预设目录: %w", err)
	}

	imageName := imageFileName(n)
	dst := filepath.Join(s.dir, imageName)
	tmp, err := os.CreateTemp(s.dir, imageName+".tmp-*")
	if err != nil {
		return Preset{}, fmt.Errorf("presetstore: 预设图像临时文件: %w", err)
	}
	tmpPath := tmp.Name()
	size, err := io.Copy(tmp, src)
	if err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
		return Preset{}, fmt.Errorf("presetstore: 写预设图像: %w", err)
	}
	if size == 0 {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
		return Preset{}, errors.New("presetstore: 印章图像是空的")
	}
	if size > maxPresetImageBytes {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
		return Preset{}, fmt.Errorf("%w: 写入 %d 字节", ErrImageTooLarge, size)
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return Preset{}, fmt.Errorf("presetstore: 关闭预设图像: %w", err)
	}
	// The final name is stable per preset, so a re-save overwrites the old bytes
	// in one rename (same directory, same volume).
	if err := os.Rename(tmpPath, dst); err != nil {
		_ = os.Remove(tmpPath)
		return Preset{}, fmt.Errorf("presetstore: 换入预设图像: %w", err)
	}

	now := time.Now()
	entry := Preset{Name: n, ImageFile: imageName, ImageBytes: size, CreatedAt: now, UpdatedAt: now, Params: p}
	if old, ok := s.findIndex(n); ok {
		entry.CreatedAt = old.CreatedAt
		s.list = s.removeEntry(n)
	}
	s.list = append(s.list, entry)
	if err := s.saveIndexLocked(); err != nil {
		// The index is the authority; if it could not be written the image is an
		// orphan file. Force a reload so the next read matches what is on disk.
		s.loaded = false
		return Preset{}, err
	}
	s.log.Info("seal preset saved", "name", n, "bytes", size, "file", imageName)
	return entry, nil
}

// Delete drops the entry and its image file. Unknown names report ErrNotFound.
func (s *Store) Delete(name string) error {
	n, err := ValidateName(name)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.loadLocked(); err != nil {
		return err
	}
	entry, ok := s.findIndex(n)
	if !ok {
		return ErrNotFound
	}
	if err := os.Remove(filepath.Join(s.dir, entry.ImageFile)); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("presetstore: 删预设图像: %w", err)
	}
	s.list = s.removeEntry(n)
	if err := s.saveIndexLocked(); err != nil {
		s.loaded = false
		return err
	}
	s.log.Info("seal preset deleted", "name", n, "file", entry.ImageFile)
	return nil
}

// SaveFile copies an existing file (a session seal asset's PNG) into the library
// under name. The client never re-uploads the image, which is what lets the batch
// path stamp from a preset without any browser round trip.
func (s *Store) SaveFile(name, srcPath string, p Params) (out Preset, err error) {
	f, err := os.Open(srcPath)
	if err != nil {
		return Preset{}, fmt.Errorf("presetstore: 读印章原图: %w", err)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return Preset{}, fmt.Errorf("presetstore: 读印章原图信息: %w", err)
	}
	if info.Size() > maxPresetImageBytes {
		return Preset{}, fmt.Errorf("%w: 原图 %d 字节", ErrImageTooLarge, info.Size())
	}
	return s.Save(name, io.LimitReader(f, maxPresetImageBytes+1), p)
}

// ImageFile resolves a preset to the absolute path of its image. A preset whose
// image file has gone missing reports ErrNotFound: the index is the authority,
// so a dangling entry is a broken preset, not a partial success.
func (s *Store) ImageFile(name string) (entry Preset, path string, err error) {
	p, err := s.Get(name)
	if err != nil {
		return Preset{}, "", err
	}
	path = filepath.Join(s.dir, p.ImageFile)
	if _, err := os.Stat(path); err != nil {
		return Preset{}, "", fmt.Errorf("%w: 图像文件不见了: %v", ErrNotFound, err)
	}
	return p, path, nil
}

// ValidateName trims and checks a preset name; the cleaned name is what the whole
// store keys on. It rejects separators and control characters so a name can
// never escape the library directory (AGENTS §5.11).
func ValidateName(name string) (string, error) {
	n := strings.TrimSpace(name)
	if n == "" {
		return "", ErrBadName
	}
	if len(n) > maxNameLen {
		return "", fmt.Errorf("%w: 名字太长（%d 字符）", ErrBadName, len(n))
	}
	if strings.ContainsAny(n, `/\:`) {
		return "", fmt.Errorf("%w: 名字里不能有路径分隔符", ErrBadName)
	}
	for _, r := range n {
		if r < 0x20 || r == 0x7f {
			return "", fmt.Errorf("%w: 名字里有控制字符", ErrBadName)
		}
	}
	// Windows refuses names ending in a dot or a space.
	if strings.ContainsAny(n[len(n)-1:], ". ") {
		return "", fmt.Errorf("%w: 名字不能以点或空格结尾", ErrBadName)
	}
	return n, nil
}

// imageFileName is deterministic per name, so a re-save overwrites the same image
// instead of leaving orphan files behind.
func imageFileName(name string) string {
	sum := sha1.Sum([]byte(strings.ToLower(name)))
	return "p-" + hex.EncodeToString(sum[:])[:16] + ".png"
}

// loadLocked reads the index once. A missing file is "empty library", not an
// error; a corrupt one is logged and treated as empty so the app keeps working.
func (s *Store) loadLocked() error {
	if s.loaded {
		return nil
	}
	s.loaded = true
	s.list = nil
	raw, err := os.ReadFile(filepath.Join(s.dir, indexFile))
	switch {
	case errors.Is(err, os.ErrNotExist):
		return nil
	case err != nil:
		s.log.Warn("预设索引读不出来", "err", err)
		return fmt.Errorf("presetstore: 读预设索引: %w", err)
	}
	var list []Preset
	if err := json.Unmarshal(raw, &list); err != nil {
		s.log.Warn("预设索引损坏,按空库处理", "err", err)
		return nil
	}
	s.list = list
	return nil
}

// saveIndexLocked rewrites the index atomically (temp + rename, AGENTS §4).
func (s *Store) saveIndexLocked() error {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return fmt.Errorf("presetstore: 建预设目录: %w", err)
	}
	raw, err := json.MarshalIndent(s.list, "", "  ")
	if err != nil {
		return fmt.Errorf("presetstore: 编码预设索引: %w", err)
	}
	return fsx.AtomicWrite(filepath.Join(s.dir, indexFile), raw, 0o644)
}

func (s *Store) findIndex(name string) (p Preset, found bool) {
	for _, p := range s.list {
		if p.Name == name {
			return p, true
		}
	}
	return Preset{}, false
}

// removeEntry drops one entry by name, keeping the slice's capacity bounded.
func (s *Store) removeEntry(name string) []Preset {
	out := make([]Preset, 0, len(s.list))
	for _, p := range s.list {
		if p.Name != name {
			out = append(out, p)
		}
	}
	return out
}
