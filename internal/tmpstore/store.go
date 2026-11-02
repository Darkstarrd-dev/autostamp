// Package tmpstore owns the session asset store under
// %LOCALAPPDATA%\AutoStamp\session: uploaded PDFs, split results, applied
// results and export results (AGENTS §4). Files live on disk (never in memory)
// so a 2 GiB session does not cost 2 GiB of RAM, and every id is bound to an
// owner so a request from a different window cannot read another window's asset.
package tmpstore

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"autostamp/internal/fsx"
)

// Limits mirrors config.Session at the time the store was opened.
type Limits struct {
	TTL      time.Duration
	MaxFile  int64
	MaxTotal int64
}

// Kind is the asset role recorded in the index (AGENTS §6 asset chain).
type Kind string

const (
	KindSource  Kind = "source"  // original PDF opened from disk
	KindSplit   Kind = "split"   // output of /api/pdf/split
	KindApplied Kind = "applied" // output of /api/pdf/apply (P4)
	KindExport  Kind = "export"  // output of /api/pdf/export (P5)
	KindSeal    Kind = "seal"    // uploaded seal image
	KindPage    Kind = "page"    // page bitmap posted back for raster export
)

// Ext maps a Kind to its file extension.
func (k Kind) Ext() string {
	switch k {
	case KindSource, KindSplit, KindApplied, KindExport:
		return ".pdf"
	case KindSeal, KindPage:
		return ".png"
	default:
		return ".bin"
	}
}

// Asset is one stored file plus its metadata.
type Asset struct {
	ID      string    `json:"id"`
	Kind    Kind      `json:"kind"`
	Owner   string    `json:"owner"`
	Path    string    `json:"path"`
	Origin  string    `json:"origin,omitempty"`
	Size    int64     `json:"size"`
	Created time.Time `json:"created"`
	TTL     string    `json:"ttl,omitempty"`
}

// Grant is a path grant returned by /api/fs/pick (AGENTS §6 pathGrantId).
type Grant struct {
	ID       string    `json:"id"`
	Path     string    `json:"path"`
	Owner    string    `json:"owner"`
	Approved bool      `json:"approved"`
	Created  time.Time `json:"created"`
}

// Store is the on-disk session store with an in-memory index.
type Store struct {
	dir    string
	limits Limits
	log    *slog.Logger

	mu     sync.RWMutex
	assets map[string]*Asset
	grants map[string]*Grant
	used   int64
}

// New prepares the session directory (owner-scoped subtree is created lazily)
// and loads any index.json left by a previous run, then runs one scavenge.
func New(dir string, limits Limits, log *slog.Logger) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("mkdir session dir: %w", err)
	}
	if limits.MaxFile <= 0 {
		limits.MaxFile = 256 << 20
	}
	if limits.MaxTotal <= 0 {
		limits.MaxTotal = 2048 << 20
	}
	if limits.TTL <= 0 {
		limits.TTL = 2 * time.Hour
	}
	s := &Store{
		dir:    dir,
		limits: limits,
		log:    log,
		assets: make(map[string]*Asset),
		grants: make(map[string]*Grant),
	}
	if err := s.loadIndex(); err != nil {
		log.Warn("session index unreadable, starting fresh", "err", err)
		s.assets = make(map[string]*Asset)
		s.used = 0
	}
	s.Scavenge()
	return s, nil
}

// Dir returns the session root.
func (s *Store) Dir() string { return s.dir }

// Limits returns the effective limits.
func (s *Store) Limits() Limits { return s.limits }

// NewID returns a random id (assetId/pathGrantId/token).
func NewID(prefix string) (string, error) {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return prefix + hex.EncodeToString(b[:]), nil
}

// Add stores r under id and kind, enforcing the per-file and total quotas.
//
// An empty owner means "unowned" (an asset created before any window took
// ownership), which any owner may read but nobody may overwrite.
func (s *Store) Add(id string, kind Kind, owner string, r io.Reader) (*Asset, error) {
	if id == "" {
		return nil, errors.New("tmpstore: empty id")
	}
	name := id + kind.Ext()
	dst := filepath.Join(s.dir, name)
	tmp, err := os.CreateTemp(s.dir, ".tmp-*")
	if err != nil {
		return nil, fmt.Errorf("tmpstore temp: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)

	var size int64
	buf := make([]byte, 1<<20)
	for {
		n, rerr := r.Read(buf)
		if n > 0 {
			size += int64(n)
			if size > s.limits.MaxFile {
				tmp.Close()
				return nil, fmt.Errorf("tmpstore: %s exceeds per-file limit %d bytes", id, s.limits.MaxFile)
			}
			if _, err := tmp.Write(buf[:n]); err != nil {
				tmp.Close()
				return nil, fmt.Errorf("tmpstore write: %w", err)
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			tmp.Close()
			return nil, fmt.Errorf("tmpstore read: %w", rerr)
		}
	}
	if size == 0 {
		tmp.Close()
		return nil, fmt.Errorf("tmpstore: %s is empty", id)
	}
	if err := tmp.Close(); err != nil {
		return nil, err
	}

	s.mu.Lock()
	if s.used+size > s.limits.MaxTotal {
		s.mu.Unlock()
		return nil, fmt.Errorf("tmpstore: session total limit %d bytes exceeded (adding %d)", s.limits.MaxTotal, size)
	}
	if err := os.Rename(tmpName, dst); err != nil {
		s.mu.Unlock()
		return nil, fmt.Errorf("tmpstore rename: %w", err)
	}
	a := &Asset{ID: id, Kind: kind, Owner: owner, Path: dst, Size: size, Created: time.Now().UTC()}
	s.assets[id] = a
	s.used += size
	errIdx := s.writeIndexLocked()
	s.mu.Unlock()
	if errIdx != nil {
		s.log.Warn("session index write failed", "err", errIdx)
	}
	return a, nil
}

// AddFile registers an existing file (e.g. the source PDF the user picked) as
// an asset without copying it in; the file stays where it is.
func (s *Store) AddFile(id string, kind Kind, owner, path string) (*Asset, error) {
	st, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if st.IsDir() {
		return nil, fmt.Errorf("tmpstore: %s is a directory", path)
	}
	if st.Size() > s.limits.MaxFile {
		return nil, fmt.Errorf("tmpstore: %s exceeds per-file limit %d bytes", path, s.limits.MaxFile)
	}
	a := &Asset{ID: id, Kind: kind, Owner: owner, Path: path, Size: st.Size(), Created: time.Now().UTC()}
	s.mu.Lock()
	s.assets[id] = a
	s.used += st.Size()
	errIdx := s.writeIndexLocked()
	s.mu.Unlock()
	if errIdx != nil {
		s.log.Warn("session index write failed", "err", errIdx)
	}
	return a, nil
}

// Get returns the asset metadata.
//
// ErrNotFound / ErrOwner are returned for unknown ids and for owner mismatches;
// both map to the same HTTP status (404) on purpose -- whether an id exists is
// not something we tell other windows about.
func (s *Store) Get(id, owner string) (*Asset, error) {
	s.mu.RLock()
	a, ok := s.assets[id]
	s.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrNotFound, id)
	}
	if a.Owner != "" && owner != "" && a.Owner != owner {
		return nil, fmt.Errorf("%w: %s", ErrOwner, id)
	}
	return a, nil
}

// Open opens the asset file for reading (Range serving, pdfcpu input).
func (s *Store) Open(id, owner string) (*os.File, *Asset, error) {
	a, err := s.Get(id, owner)
	if err != nil {
		return nil, nil, err
	}
	f, err := os.Open(a.Path)
	if err != nil {
		return nil, nil, fmt.Errorf("%w: %s (%v)", ErrNotFound, id, err)
	}
	return f, a, nil
}

// Path returns the on-disk path of an asset after the owner check.
func (s *Store) Path(id, owner string) (string, error) {
	a, err := s.Get(id, owner)
	if err != nil {
		return "", err
	}
	return a.Path, nil
}

// SetOrigin records which disk file an asset descends from. Derived assets
// (split, apply, export) carry their parent's origin forward, so
// replaceOriginal keeps working after any number of intermediate steps. An
// empty origin means "there is no disk original" (a drag/drop upload), which
// the save route reports instead of guessing a path.
func (s *Store) SetOrigin(id, origin string) error {
	s.mu.Lock()
	a, ok := s.assets[id]
	if !ok {
		s.mu.Unlock()
		return fmt.Errorf("%w: %s", ErrNotFound, id)
	}
	a.Origin = origin
	errIdx := s.writeIndexLocked()
	s.mu.Unlock()
	return errIdx
}

// OriginOf returns the disk path an asset descends from after the owner check
// ("" = no disk original).
func (s *Store) OriginOf(id, owner string) (string, error) {
	a, err := s.Get(id, owner)
	if err != nil {
		return "", err
	}
	return a.Origin, nil
}

// Delete removes an asset from the store and the filesystem. Assets registered
// with AddFile are only dropped from the index (their source file stays).
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	a, ok := s.assets[id]
	if !ok {
		s.mu.Unlock()
		return fmt.Errorf("%w: %s", ErrNotFound, id)
	}
	delete(s.assets, id)
	s.used -= a.Size
	inSession := strings.HasPrefix(a.Path, s.dir+string(filepath.Separator))
	errIdx := s.writeIndexLocked()
	s.mu.Unlock()
	if inSession {
		if err := os.Remove(a.Path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return errIdx
}

// List returns the assets owned by owner (empty owner lists everything).
func (s *Store) List(owner string) []*Asset {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]*Asset, 0, len(s.assets))
	for _, a := range s.assets {
		if owner == "" || a.Owner == "" || a.Owner == owner {
			cp := *a
			out = append(out, &cp)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Created.Before(out[j].Created) })
	return out
}

// Used reports the tracked total size in bytes.
func (s *Store) Used() int64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.used
}

// TakeOwnership rebinds unowned assets to owner (first window wins). It returns
// how many assets were adopted so the log can show the handover.
func (s *Store) TakeOwnership(owner string) int {
	if owner == "" {
		return 0
	}
	s.mu.Lock()
	n := 0
	for _, a := range s.assets {
		if a.Owner == "" {
			a.Owner = owner
			n++
		}
	}
	if n > 0 {
		if err := s.writeIndexLocked(); err != nil {
			s.log.Warn("session index write failed", "err", err)
		}
	}
	s.mu.Unlock()
	return n
}

// GrantPath records a user-approved path for later operations. An empty path
// means "awaiting the picker answer" (the UI shows the chip before the pick).
func (s *Store) GrantPath(id, path, owner string, approved bool) (*Grant, error) {
	if id == "" {
		return nil, errors.New("tmpstore: empty grant id")
	}
	g := &Grant{ID: id, Path: path, Owner: owner, Approved: approved, Created: time.Now().UTC()}
	s.mu.Lock()
	s.grants[id] = g
	s.mu.Unlock()
	return g, nil
}

// CheckGrant returns the approved path of id, or an error when the grant is
// unknown, unapproved, bound to another owner, or expired.
func (s *Store) CheckGrant(id, owner string) (string, error) {
	s.mu.RLock()
	g, ok := s.grants[id]
	s.mu.RUnlock()
	if !ok || !g.Approved {
		return "", fmt.Errorf("%w: grant %s", ErrNotFound, id)
	}
	if g.Owner != "" && owner != "" && g.Owner != owner {
		return "", fmt.Errorf("%w: grant %s", ErrOwner, id)
	}
	if time.Since(g.Created) > s.limits.TTL {
		return "", fmt.Errorf("%w: grant %s expired", ErrExpired, id)
	}
	return g.Path, nil
}

// DropGrant removes a path grant (used when the UI cancels the chooser).
func (s *Store) DropGrant(id string) {
	s.mu.Lock()
	delete(s.grants, id)
	s.mu.Unlock()
}

// Scavenge drops assets and grants past the TTL, and removes orphan temp
// files (a killed process can leave ".tmp-*" behind). It returns the number of
// removed assets.
func (s *Store) Scavenge() int {
	now := time.Now().UTC()
	type doomed struct {
		id        string
		path      string
		size      int64
		inSession bool
	}
	var kill []doomed
	s.mu.Lock()
	for id, a := range s.assets {
		if now.Sub(a.Created) <= s.limits.TTL {
			continue
		}
		kill = append(kill, doomed{id: id, path: a.Path, size: a.Size, inSession: strings.HasPrefix(a.Path, s.dir+string(filepath.Separator))})
		delete(s.assets, id)
		s.used -= a.Size
	}
	for id, g := range s.grants {
		if now.Sub(g.Created) > s.limits.TTL {
			delete(s.grants, id)
		}
	}
	indexErr := s.writeIndexLocked()
	s.mu.Unlock()

	removed := 0
	for _, k := range kill {
		if !k.inSession {
			continue
		}
		if err := os.Remove(k.path); err == nil {
			removed++
		} else if !errors.Is(err, os.ErrNotExist) {
			s.log.Warn("scavenge remove failed", "path", k.path, "err", err)
		}
	}
	// Orphan temp files older than the TTL, from any interrupted write.
	if entries, err := os.ReadDir(s.dir); err == nil {
		for _, e := range entries {
			if !strings.HasPrefix(e.Name(), ".tmp-") {
				continue
			}
			fi, err := e.Info()
			if err != nil {
				continue
			}
			if now.Sub(fi.ModTime()) <= s.limits.TTL {
				continue
			}
			_ = os.Remove(filepath.Join(s.dir, e.Name()))
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		s.log.Warn("scavenge readdir failed", "err", err)
	}
	if len(kill) > 0 {
		s.log.Info("session scavenge", "dropped", len(kill), "removed", removed, "usedBytes", s.Used())
	}
	if indexErr != nil {
		s.log.Warn("session index write failed", "err", indexErr)
	}
	return len(kill)
}

// Close flushes the index so a clean exit does not resurrect deleted assets.
func (s *Store) Close() error {
	s.mu.Lock()
	err := s.writeIndexLocked()
	s.mu.Unlock()
	return err
}

func (s *Store) indexPath() string { return filepath.Join(s.dir, "index.json") }

func (s *Store) loadIndex() error {
	data, err := fsx.ReadIfExists(s.indexPath())
	if err != nil || data == nil {
		return err
	}
	var doc struct {
		Assets []Asset `json:"assets"`
		Grants []Grant `json:"grants"`
	}
	if err := json.Unmarshal(data, &doc); err != nil {
		return err
	}
	used := int64(0)
	for _, a := range doc.Assets {
		cp := a
		if _, err := os.Stat(cp.Path); err != nil {
			continue // file already gone (manual cleanup, drive change)
		}
		s.assets[cp.ID] = &cp
		used += cp.Size
	}
	for _, g := range doc.Grants {
		cp := g
		s.grants[cp.ID] = &cp
	}
	s.used = used
	return nil
}

// writeIndexLocked persists the index; callers must hold s.mu (write).
func (s *Store) writeIndexLocked() error {
	doc := struct {
		Assets []*Asset `json:"assets"`
		Grants []*Grant `json:"grants"`
		Used   int64    `json:"usedBytes"`
	}{
		Assets: make([]*Asset, 0, len(s.assets)),
		Grants: make([]*Grant, 0, len(s.grants)),
		Used:   s.used,
	}
	for _, a := range s.assets {
		doc.Assets = append(doc.Assets, a)
	}
	for _, g := range s.grants {
		doc.Grants = append(doc.Grants, g)
	}
	data, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	return fsx.AtomicWrite(s.indexPath(), append(data, '\n'), 0o600)
}

// Errors callers branch on.
var (
	ErrNotFound = errors.New("tmpstore: not found")
	ErrOwner    = errors.New("tmpstore: owner mismatch")
	ErrExpired  = errors.New("tmpstore: expired")
)
