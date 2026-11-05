package api

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"autostamp/internal/config"
	"autostamp/internal/fsx"
	"autostamp/internal/pdfcore"
	"autostamp/internal/tmpstore"
	"autostamp/internal/webx"
)

// maxPDFBody caps what an upload may carry (AGENTS §5.11: 256 MiB, the same
// value pdfcore.DefaultLimits sets for MaxInputBytes).
const maxPDFBody = 256 << 20

// openBody is the request for opening a file chosen through the picker
// (AGENTS §6: POST /api/pdf/open by pathGrantId).
type openBody struct {
	PathGrantID string `json:"pathGrantId"`
	// PW is tried as both UserPW and OwnerPW (FACTS §2.4). AES-256 is still
	// UNVERIFIED (FACTS §6), so an encrypted document is reported, never guessed.
	PW string `json:"pw"`
	// Name is only the display name; the server never opens it.
	Name string `json:"name"`
}

// pickBody is the request for POST /api/fs/pick.
type pickBody struct {
	Filter   string `json:"filter"`
	Multi    bool   `json:"multi"`
	StartDir string `json:"startDir"`
	// FilePath is the typed-path channel (UI_SPEC §2 api.fs.pick.filePath):
	// the caller shows a path box instead of a dialog, and the server only
	// grants what is already on disk. An empty value means "show the dialog".
	FilePath string `json:"filePath"`

	// Dir asks for a folder instead of files (P6 批处理, UI_SPEC §2 api.fs.pick.dir):
	// the response then carries dirPath plus the PDFs directly under it, each with
	// its own pathGrantId so the batch queue can open them without re-asking.
	Dir bool
}

// pickResult is one picked path plus the grant the caller must use later.
type pickResult struct {
	Path        string `json:"path"`
	PathGrantID string `json:"pathGrantId"`
	Size        int64  `json:"size"`
	Modified    string `json:"modified"`
	IsDir       bool   `json:"isDir"`
}

// openResult is the POST /api/pdf/open response. The embedded Doc keeps the
// page metadata flat next to the asset ids, which is what the front-end and
// tools/verify read (UI_SPEC §2 asset hooks).
type openResult struct {
	AssetID string `json:"assetId"`
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	Kind    string `json:"kind"`
	pdfcore.Doc
}

// handlePick answers POST /api/fs/pick: show the native dialog and return a
// pathGrantId per path, bound to this session (owner).
//
// A cancel is a normal outcome, not an error: the UI closes its spinner and
// does nothing. On platforms without a dialog the route answers 501 so the UI
// can fall back to the path box instead of pretending the click worked.
func handlePick(store *tmpstore.Store, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		owner, err := webx.SessionOf(r)
		if err != nil {
			webx.Fail(w, http.StatusBadRequest, "bad_session", err.Error())
			return
		}
		var body pickBody
		if err := webx.DecodeJSON(r, &body, 1<<20); err != nil {
			webx.Fail(w, http.StatusBadRequest, "bad_body", "请求体不是合法的 pick 请求: "+err.Error())
			return
		}
		switch body.Filter {
		case "", "pdf", "image", "all":
		default:
			webx.Fail(w, http.StatusBadRequest, "bad_body", "filter 只允许 pdf/image/all")
			return
		}
		var paths []string
		dirPath := ""
		if body.FilePath != "" {
			// No dialog for a typed path, but the grant must resolve to a real
			// file: handing out a capability for a missing path would let the
			// UI look like it opened something.
			st, err := os.Stat(body.FilePath)
			if err != nil {
				webx.Fail(w, http.StatusBadRequest, "path_denied", "路径不可读: "+err.Error())
				return
			}
			if body.Dir {
				if !st.IsDir() {
					webx.Fail(w, http.StatusBadRequest, "bad_body", "dir 为真时 filePath 必须是目录")
					return
				}
				dirPath = body.FilePath
			} else {
				if st.IsDir() {
					webx.Fail(w, http.StatusBadRequest, "path_denied", "需要文件路径，不是目录")
					return
				}
				paths = []string{body.FilePath}
			}
		} else if body.Dir {
			// A typed dir is the fallback for platforms with no native dialog, so
			// 批处理 works everywhere; the dialog itself is one folder deep.
			dir, err := fsx.PickDirs(r.Context(), fsx.PickOptions{Dir: true, Filter: body.Filter, StartDir: body.StartDir})
			if pickDialogError(w, log, err) {
				return
			}
			dirPath = dir
		} else {
			picked, err := fsx.PickFiles(r.Context(), fsx.PickOptions{
				Filter:   body.Filter,
				Multi:    body.Multi,
				StartDir: body.StartDir,
			})
			if pickDialogError(w, log, err) {
				return
			}
			paths = picked
		}
		if dirPath != "" {
			// The server enumerates the folder (one level): the browser must not be
			// the one deciding which files exist on the user's disk (fsx.ListMatching).
			listed, err := fsx.ListMatching(dirPath, body.Filter)
			if err != nil {
				webx.Fail(w, http.StatusBadRequest, "path_denied", "无法列出该目录: "+err.Error())
				return
			}
			paths = listed
		}
		out := make([]pickResult, 0, len(paths))
		for _, p := range paths {
			id, err := tmpstore.NewID("pg")
			if err != nil {
				webx.Fail(w, http.StatusInternalServerError, "internal_error", err.Error())
				return
			}
			if _, err := store.GrantPath(id, p, owner, true); err != nil {
				webx.Fail(w, http.StatusBadRequest, "path_denied", "无法登记该路径: "+err.Error())
				return
			}
			res := pickResult{Path: p, PathGrantID: id}
			if st, err := os.Stat(p); err == nil {
				res.Size = st.Size()
				res.IsDir = st.IsDir()
				res.Modified = st.ModTime().UTC().Format(time.RFC3339)
			}
			out = append(out, res)
		}
		if dirPath != "" {
			webx.OK(w, map[string]any{"cancelled": false, "dirPath": dirPath, "picks": out})
			return
		}
		webx.OK(w, map[string]any{"cancelled": false, "picks": out})
	}
}

// pickDialogError maps the dialog failures onto the registered codes and reports
// whether the handler must stop. A cancel is a normal answer, not an error: the UI
// closes its spinner and shows nothing (AGENTS §6 /api/fs/pick).
func pickDialogError(w http.ResponseWriter, log *slog.Logger, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, fsx.ErrPickCancelled):
		webx.OK(w, map[string]any{"cancelled": true, "picks": []pickResult{}})
		return true
	case errors.Is(err, fsx.ErrPickUnsupported):
		webx.Fail(w, http.StatusNotImplemented, "pick_unsupported", "该平台没有原生文件选择器，请改用路径输入框")
		return true
	case errors.Is(err, context.Canceled):
		return true // the request was aborted; nothing more to write
	default:
		log.Error("file picker failed", "err", err)
		webx.Fail(w, http.StatusInternalServerError, "pick_failed", err.Error())
		return true
	}
}

// handleOpen answers POST /api/pdf/open. Two shapes are accepted:
//
//	application/json     {"pathGrantId":"pg…","pw":"…","name":"…"}
//	multipart/form-data  file=<pdf> — the drag/drop and file-input path
//
// The bytes land in the session store first (assetId); then the structure is
// read. On failure the asset is deleted again, so a rejected file never leaves
// a half-open document behind.
func handleOpen(settings *config.Store, store *tmpstore.Store, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		owner, err := webx.SessionOf(r)
		if err != nil {
			webx.Fail(w, http.StatusBadRequest, "bad_session", err.Error())
			return
		}

		var (
			asset     *tmpstore.Asset
			name      string
			pw        string
			openedDir string // set only for files opened from disk, for the recent list
		)
		if ct := r.Header.Get("Content-Type"); strings.HasPrefix(ct, "multipart/") {
			if err := r.ParseMultipartForm(maxPDFBody); err != nil {
				webx.Fail(w, http.StatusBadRequest, "bad_body", "multipart 解析失败: "+err.Error())
				return
			}
			defer r.MultipartForm.RemoveAll()
			file, hdr, err := r.FormFile("file")
			if err != nil {
				webx.Fail(w, http.StatusBadRequest, "bad_body", "缺少 file 字段")
				return
			}
			defer file.Close()
			name = filepath.Base(hdr.Filename)
			// The store path keeps its own extension (kind.Ext), so the name the
			// client sent is the only one worth checking: it must be a .pdf.
			if !strings.HasSuffix(strings.ToLower(name), ".pdf") {
				webx.Fail(w, http.StatusBadRequest, "not_pdf", "只支持 .pdf 文件")
				return
			}
			pw = r.FormValue("pw")
			id, err := tmpstore.NewID("as")
			if err != nil {
				webx.Fail(w, http.StatusInternalServerError, "internal_error", err.Error())
				return
			}
			if asset, err = store.Add(id, tmpstore.KindSource, owner, file); err != nil {
				failStoreError(w, err)
				return
			}
		} else {
			var body openBody
			if err := webx.DecodeJSON(r, &body, 1<<20); err != nil {
				webx.Fail(w, http.StatusBadRequest, "bad_body", "请求体不是合法的 open 请求: "+err.Error())
				return
			}
			if body.PathGrantID == "" {
				webx.Fail(w, http.StatusBadRequest, "bad_body", "需要 pathGrantId")
				return
			}
			path, err := store.CheckGrant(body.PathGrantID, owner)
			if err != nil {
				webx.Fail(w, http.StatusBadRequest, "path_denied", "pathGrantId 无效或已过期")
				return
			}
			name, pw = body.Name, body.PW
			if name == "" {
				name = filepath.Base(path)
			}
			openedDir = path
			if !strings.HasSuffix(strings.ToLower(path), ".pdf") {
				webx.Fail(w, http.StatusBadRequest, "not_pdf", "只支持 .pdf 文件")
				return
			}
			id, err := tmpstore.NewID("as")
			if err != nil {
				webx.Fail(w, http.StatusInternalServerError, "internal_error", err.Error())
				return
			}
			if asset, err = store.AddFile(id, tmpstore.KindSource, owner, path); err != nil {
				failStoreError(w, err)
				return
			}
			// The disk original is what replaceOriginal writes back onto;
			// uploads deliberately get no origin (AGENTS §6 /api/pdf/save).
			if err := store.SetOrigin(asset.ID, path); err != nil {
				log.Warn("记录原文件路径失败", "asset", asset.ID, "err", err)
			}
		}

		doc, err := inspectAsset(r.Context(), asset.Path, pw)
		if err != nil {
			store.Delete(asset.ID)
			failOpen(w, err)
			return
		}
		if openedDir != "" {
			settings.SetRecent(openedDir)
		}
		log.Info("pdf opened", "asset", asset.ID, "pages", doc.PageCount, "name", name)
		webx.Created(w, openResult{
			AssetID: asset.ID,
			Name:    name,
			Size:    asset.Size,
			Kind:    string(asset.Kind),
			Doc:     *doc,
		})
	}
}

// splitBody is the POST /api/pdf/split request (AGENTS §6). The field names are
// the frozen UI_SPEC §2.2 vocabulary — splitMode / rows / cols / customCuts /
// splitVeto — so the panel sends exactly what it edits.
type splitBody struct {
	AssetID    string   `json:"assetId"`
	SplitMode  string   `json:"splitMode"`
	Rows       int      `json:"rows"`
	Cols       int      `json:"cols"`
	CustomCuts []string `json:"customCuts"`
	SplitVeto  *bool    `json:"splitVeto"`  // pointer: "no" is a real answer
	VetoPages  []int    `json:"vetoPages"`  // decision D3: per-page veto chips
	SplitPages string   `json:"splitPages"` // api.split.pages vocabulary (empty = all pages)
}

// splitTimeout bounds a cut run: pdfcpu works page by page, and a large
// document must not hold the request open indefinitely (AGENTS §5.11).
const splitTimeout = 2 * time.Minute

// handleSplit answers POST /api/pdf/split (需求 3 的第一半): it cuts the stored
// document and answers with the same shape as /api/pdf/open, so the front-end
// swaps the asset and re-reads the page list. The original asset is left in the
// store — that is what a split's 撤销 means, with no undo stack of our own.
//
// The new asset's Name is deliberately empty: a split is the *same* document,
// so the UI keeps its title instead of inventing a "split of …" label.
func handleSplit(store *tmpstore.Store, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body splitBody
		if err := webx.DecodeJSON(r, &body, 1<<20); err != nil {
			webx.Fail(w, http.StatusBadRequest, "bad_body", "请求体不是合法的 split 请求: "+err.Error())
			return
		}
		owner, err := webx.SessionOf(r)
		if err != nil {
			webx.Fail(w, http.StatusBadRequest, "bad_session", err.Error())
			return
		}
		if body.AssetID == "" {
			webx.Fail(w, http.StatusBadRequest, "bad_body", "缺少 assetId")
			return
		}
		mode := body.SplitMode
		if mode == "" {
			mode = pdfcore.SplitAuto
		}
		if mode == pdfcore.SplitCustom && len(body.CustomCuts) == 0 {
			webx.Fail(w, http.StatusBadRequest, "bad_body", "custom 切分需要 customCuts")
			return
		}
		switch mode {
		case pdfcore.SplitAuto, pdfcore.SplitRowsCols, pdfcore.SplitCustom, pdfcore.SplitUnsplit:
		default:
			// splitMode is client input: answer 400 instead of letting pdfcpu
			// turn a bad name into a 500.
			webx.Fail(w, http.StatusBadRequest, "bad_body", "splitMode 必须是 auto/rows-cols/custom/unsplit")
			return
		}
		src, err := store.Path(body.AssetID, owner)
		if err != nil {
			webx.Fail(w, http.StatusNotFound, "not_found", "没有这个 PDF")
			return
		}
		// The split heuristic reads per-page MediaBox sizes, so it needs the
		// structure; inspecting the stored file again is a few ms and keeps the
		// store from having to cache a Doc per asset.
		doc, err := inspectAsset(r.Context(), src, "")
		if err != nil {
			failOpen(w, err)
			return
		}
		spec := pdfcore.SplitSpec{Mode: mode, Rows: body.Rows, Cols: body.Cols, CustomCuts: body.CustomCuts}
		// api.split.pages (`all | none | 1-2,5`) restricts which pages may be
		// cut. An empty selection is an error, not "all": silently cutting every
		// page would be the opposite of what the box says.
		if s := strings.TrimSpace(body.SplitPages); s != "" {
			pages, err := pdfcore.ParsePages(s, doc.PageCount)
			if err != nil {
				webx.Fail(w, http.StatusBadRequest, "bad_body", "splitPages: "+err.Error())
				return
			}
			if len(pages) == 0 {
				webx.Fail(w, http.StatusBadRequest, "bad_body", "splitPages 选中的是 none：没有可切分的页")
				return
			}
			spec.Pages = pages
		}
		if body.SplitVeto != nil {
			spec.Veto = *body.SplitVeto
		}
		// The chip row sends page numbers, so they must address real pages:
		// a stale or bogus number would silently veto nothing.
		for _, n := range body.VetoPages {
			if n < 1 || n > doc.PageCount {
				webx.Fail(w, http.StatusBadRequest, "bad_body", fmt.Sprintf("vetoPages 页 %d 超出 1..%d", n, doc.PageCount))
				return
			}
		}
		spec.VetoPages = body.VetoPages

		out, err := os.CreateTemp(store.Dir(), "split-*.pdf")
		if err != nil {
			failStoreError(w, err)
			return
		}
		outPath := out.Name()
		_ = out.Close() // pdfcpu writes to the path; the handle is closed on purpose

		ctx, cancel := context.WithTimeout(r.Context(), splitTimeout)
		defer cancel()
		newDoc, err := pdfcore.Split(ctx, src, outPath, spec, doc)
		if err != nil {
			_ = os.Remove(outPath)
			webx.Fail(w, http.StatusInternalServerError, "split_failed", err.Error())
			return
		}
		id, err := tmpstore.NewID("split")
		if err != nil {
			_ = os.Remove(outPath)
			webx.Fail(w, http.StatusInternalServerError, "internal_error", err.Error())
			return
		}
		asset, err := store.AddFile(id, tmpstore.KindSplit, owner, outPath)
		if err != nil {
			_ = os.Remove(outPath)
			failStoreError(w, err)
			return
		}
		// A split is the same document, so its disk origin carries forward —
		// replaceOriginal must still work after a cut.
		if origin, err := store.OriginOf(body.AssetID, owner); err == nil && origin != "" {
			if err := store.SetOrigin(asset.ID, origin); err != nil {
				log.Warn("carry origin failed", "asset", asset.ID, "err", err)
			}
		}
		log.Info("pdf split", "from", body.AssetID, "into", asset.ID, "mode", mode, "pages", newDoc.PageCount)
		webx.Created(w, openResult{
			AssetID: asset.ID,
			Name:    "",
			Size:    asset.Size,
			Kind:    string(asset.Kind),
			Doc:     *newDoc,
		})
	}
}

// handleRaw serves the stored bytes so pdf.js can fetch the document itself
// (AGENTS §6: GET /api/pdf/raw, Range + ETag). http.ServeContent owns Range,
// If-Range and the weak ETag derived from the asset's mtime.
func handleRaw(store *tmpstore.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Every document copy the session can adopt is servable: after a split
		// or a stamping pass the UI points pdf.js at the *new* asset, and the
		// read-back check (AGENTS §8.4) has to see exactly those bytes.
		serveAssetRaw(w, r, store,
			tmpstore.KindSource, tmpstore.KindSplit, tmpstore.KindApplied, tmpstore.KindExport)
	}
}

// handleSealRaw answers GET /api/pdf/seal/raw (AGENTS §6): the prepared stamp
// PNG, served with the same Range/ETag behaviour so the preview can cache it.
func handleSealRaw(store *tmpstore.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		serveAssetRaw(w, r, store, tmpstore.KindSeal)
	}
}

// serveAssetRaw streams one asset to the session that owns it. The kind check
// keeps the two byte channels apart: a seal id fetched through the PDF route
// (or the other way round) is a client bug, not a miss, and answering 400 says
// so instead of handing back a body the caller cannot use.
func serveAssetRaw(w http.ResponseWriter, r *http.Request, store *tmpstore.Store, kinds ...tmpstore.Kind) {
	owner, err := webx.SessionOf(r)
	if err != nil {
		webx.Fail(w, http.StatusBadRequest, "bad_session", err.Error())
		return
	}
	id := r.URL.Query().Get("id")
	if id == "" {
		webx.Fail(w, http.StatusBadRequest, "bad_id", "需要 id 参数")
		return
	}
	f, asset, err := store.Open(id, owner)
	if err != nil {
		// An asset belonging to another window answers as if it did not
		// exist: the other window's existence is not this window's business.
		if errors.Is(err, tmpstore.ErrNotFound) || errors.Is(err, tmpstore.ErrOwner) {
			webx.Fail(w, http.StatusNotFound, "not_found", "assetId 不存在或已过期")
			return
		}
		webx.Fail(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	defer f.Close()
	if !kindInSet(kinds, asset.Kind) {
		webx.Fail(w, http.StatusBadRequest, "kind_denied",
			"该 id 不是 "+kindSetMessage(kinds)+" 资产（用对应的 raw 路由）")
		return
	}
	w.Header().Set("Content-Type", contentTypeFor(asset.Kind))
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Accept-Ranges", "bytes")
	http.ServeContent(w, r, asset.ID, asset.Created, f)
}

// kindInSet answers whether an asset kind may be streamed by this route; the
// kind check keeps the byte channels apart (seal PNG vs PDF document).
func kindInSet(set []tmpstore.Kind, k tmpstore.Kind) bool {
	for _, want := range set {
		if want == k {
			return true
		}
	}
	return false
}

// kindSetMessage renders the allowed kinds for the error text so the front-end
// can show which route the id belongs to.
func kindSetMessage(set []tmpstore.Kind) string {
	names := make([]string, 0, len(set))
	for _, k := range set {
		names = append(names, string(k))
	}
	return strings.Join(names, "/")
}

// contentTypeFor maps the asset kind to the media type the browser needs to
// draw it: pdf.js consumes the PDF, drawImage consumes the seal PNG.
func contentTypeFor(kind tmpstore.Kind) string {
	if kind == tmpstore.KindSeal || kind == tmpstore.KindPage {
		return "image/png"
	}
	return "application/pdf"
}

// inspectAsset opens the document with and without a password so "encrypted"
// and "corrupt" stay distinguishable instead of being collapsed into one error
// (FACTS §2.4).
func inspectAsset(ctx context.Context, path, pw string) (*pdfcore.Doc, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	doc, err := pdfcore.Inspect(ctx, f, nil)
	if err == nil {
		return doc, nil
	}
	if !needsPassword(err) {
		return nil, err
	}
	if pw == "" {
		// pdfcpu reports an empty password against an AES-256 document as an
		// *invalid* one, not as "owner password required" (verified 2026-11-03:
		// fixture from tools/verify/encfx, see FACTS §2.4). The contract only
		// distinguishes "needs a password" from "the password was wrong", and a
		// caller that sent no credentials at all needs the prompt, so the empty
		// attempt is re-classified as required here rather than leaking pdfcpu's
		// distinction into two codes the UI cannot tell apart.
		return nil, fmt.Errorf("%w: 文档已加密（pdfcpu 把空密码判为 invalid）", pdfcore.ErrNeedsPassword)
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	conf := pdfcore.DefaultLimits()
	conf.UserPW, conf.OwnerPW = pw, pw
	return pdfcore.Inspect(ctx, f, conf)
}

func needsPassword(err error) bool {
	return errors.Is(err, pdfcore.ErrNeedsPassword) || errors.Is(err, pdfcore.ErrBadPassword)
}

func failOpen(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, pdfcore.ErrNeedsPassword):
		webx.Fail(w, http.StatusBadRequest, "password_required", "该 PDF 需要密码")
	case errors.Is(err, pdfcore.ErrBadPassword):
		webx.Fail(w, http.StatusBadRequest, "password_invalid", "密码不正确")
	default:
		webx.Fail(w, http.StatusBadRequest, "unreadable_pdf", "无法读取该 PDF: "+err.Error())
	}
}

// failStoreError maps store failures onto the contract codes. The store reports
// quota problems as plain errors, so the text has to be inspected; anything
// unrecognised stays an internal error rather than claiming a client problem.
func failStoreError(w http.ResponseWriter, err error) {
	msg := err.Error()
	switch {
	case errors.Is(err, os.ErrNotExist):
		webx.Fail(w, http.StatusNotFound, "not_found", "文件不存在")
	case errors.Is(err, tmpstore.ErrNotFound) || errors.Is(err, tmpstore.ErrOwner):
		// An asset owned by another window answers as if it did not exist.
		webx.Fail(w, http.StatusNotFound, "not_found", "assetId 不存在或已过期")
	case strings.Contains(msg, "exceeds") || strings.Contains(msg, "limit") ||
		strings.Contains(msg, "quota") || strings.Contains(msg, "too large"):
		webx.Fail(w, http.StatusRequestEntityTooLarge, "payload_too_large", msg)
	default:
		webx.Fail(w, http.StatusInternalServerError, "internal_error", msg)
	}
}
