package api

// P5: the export channel (AGENTS §6 POST /api/pdf/export). Content
// negotiation picks the path:
//
//   - application/json    → vector: the stored bytes are cloned (pages=all)
//     or trimmed to the selected pages (pdfcore.TrimPages); nothing is
//     re-encoded. The body vocabulary is exactly assetId/mode/pages —
//     webx.DecodeJSON rejects unknown fields, so dpi/quality/customDpi in a
//     vector body is a 400, same as apply's rejection of brightness/saturate.
//   - multipart/form-data → raster: the front-end posts `spec` (a JSON
//     string) plus one bitmap per page (`page-<n>`, already in display
//     orientation, AGENTS §5.17); pdfcore.WriteRaster assembles them.
//
// Both paths answer the openResult shape (assetId/name/size/kind plus the
// embedded pdfcore.Doc) with kind "exported" and the export vocabulary
// (mode/dpi/quality/bytesPerPage/warning), so the front-end swaps the asset
// exactly like after apply.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"autostamp/internal/pdfcore"
	"autostamp/internal/tmpstore"
	"autostamp/internal/webx"
)

// exportTimeout bounds an export run: vector trimming is pdfcpu work and a
// large raster set walks every posted bitmap (AGENTS §5.11).
const exportTimeout = 5 * time.Minute

// maxExportPages caps one raster export. The panel sends one bitmap per page;
// a request claiming more than 200 pages is a client bug, not a big document.
const maxExportPages = 200

// maxPageImageBytes is the W6 hard cap on ONE posted page bitmap (90 MiB).
// It is a var so tests can shrink it and pin the 400 page_too_large path
// without allocating 90 MB.
var maxPageImageBytes int64 = 90 << 20

// maxExportBody bounds the whole multipart body: one page up to
// maxPageImageBytes, maxExportPages of them — deliberately generous, because
// MaxBytesReader only counts, it does not buffer. What actually lands in the
// session store is bounded by the store's own per-file quota.
var maxExportBody = maxPageImageBytes * maxExportPages

const (
	minExportDpi     = 96
	maxExportDpi     = 600
	minExportQuality = 40
	maxExportQuality = 95
)

// exportBody is the vector request: exactly these three fields.
type exportBody struct {
	AssetID string `json:"assetId"`
	Mode    string `json:"mode"`
	Pages   string `json:"pages"`
}

// exportSpec is the raster request's `spec` field (a JSON string). dpi arrives
// as a resolved number (the front-end has already expanded customDpi) and
// quality as the JPEG quality the front-end encoded with; both are echoed
// back, not applied server-side.
type exportSpec struct {
	AssetID string `json:"assetId"`
	Mode    string `json:"mode"`
	Dpi     int    `json:"dpi"`
	Quality int    `json:"quality"`
	Pages   string `json:"pages"`
}

// exportResult answers POST /api/pdf/export. It reuses the openResult shape
// and adds the export vocabulary. Kind carries the frozen contract value
// "exported"; the store's own index role stays tmpstore.KindExport ("export").
type exportResult struct {
	openResult
	Mode         string  `json:"mode"`
	Dpi          int     `json:"dpi,omitempty"`
	Quality      int     `json:"quality,omitempty"`
	BytesPerPage []int64 `json:"bytesPerPage,omitempty"`
	Warning      string  `json:"warning,omitempty"`
}

// exportSourceKinds are the asset kinds an export may read: the PDF chain.
// Seal/page bitmaps belong to the seal channel, so an id from there is
// kind_denied, not a parse error.
var exportSourceKinds = []tmpstore.Kind{tmpstore.KindSource, tmpstore.KindSplit, tmpstore.KindApplied, tmpstore.KindExport}

// handleExport answers POST /api/pdf/export, dispatching on Content-Type.
func handleExport(store *tmpstore.Store, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		owner, err := webx.SessionOf(r)
		if err != nil {
			webx.Fail(w, http.StatusBadRequest, "bad_session", err.Error())
			return
		}
		switch ct := r.Header.Get("Content-Type"); {
		case strings.HasPrefix(ct, "application/json"):
			handleExportVector(w, r, store, log, owner)
		case strings.HasPrefix(ct, "multipart/"):
			handleExportRaster(w, r, store, log, owner)
		default:
			webx.Fail(w, http.StatusBadRequest, "bad_body",
				"export 需要 application/json（vector）或 multipart/form-data（raster）")
		}
	}
}

// resolveExportSource maps the requested asset onto a stored PDF path,
// answering 4xx itself for anything the client got wrong: unknown or foreign
// ids are not_found (the store reports owner mismatches as if the asset did
// not exist), and a non-PDF kind is kind_denied.
func resolveExportSource(w http.ResponseWriter, store *tmpstore.Store, id, owner string) (string, bool) {
	asset, err := store.Get(id, owner)
	if err != nil {
		failStoreError(w, err)
		return "", false
	}
	if !kindInSet(exportSourceKinds, asset.Kind) {
		webx.Fail(w, http.StatusBadRequest, "kind_denied",
			"该 id 不是 "+kindSetMessage(exportSourceKinds)+" 资产（导出只吃 PDF 文档）")
		return "", false
	}
	src, err := store.Path(id, owner)
	if err != nil {
		failStoreError(w, err)
		return "", false
	}
	return src, true
}

// carryOrigin copies the source asset's disk origin forward so
// replaceOriginal keeps working after an export (same as apply/split).
func carryOrigin(log *slog.Logger, store *tmpstore.Store, fromID, toID, owner string) {
	if origin, err := store.OriginOf(fromID, owner); err == nil && origin != "" {
		if err := store.SetOrigin(toID, origin); err != nil {
			log.Warn("carry origin failed", "asset", toID, "err", err)
		}
	}
}

// handleExportVector serves the JSON half: clone (all) or page subset (trim).
func handleExportVector(w http.ResponseWriter, r *http.Request, store *tmpstore.Store, log *slog.Logger, owner string) {
	var body exportBody
	if err := webx.DecodeJSON(r, &body, 1<<20); err != nil {
		webx.Fail(w, http.StatusBadRequest, "bad_body", "请求体不是合法的 export 请求: "+err.Error())
		return
	}
	if body.AssetID == "" {
		webx.Fail(w, http.StatusBadRequest, "bad_body", "缺少 assetId")
		return
	}
	if body.Mode != "vector" {
		webx.Fail(w, http.StatusBadRequest, "bad_body", "mode 必须是 vector（raster 走 multipart/form-data）")
		return
	}
	src, ok := resolveExportSource(w, store, body.AssetID, owner)
	if !ok {
		return
	}
	doc, err := inspectAsset(r.Context(), src, "")
	if err != nil {
		failOpen(w, err)
		return
	}
	pages, err := pdfcore.ParsePages(body.Pages, doc.PageCount)
	if err != nil {
		webx.Fail(w, http.StatusBadRequest, "bad_body", "pages: "+err.Error())
		return
	}
	if len(pages) == 0 {
		webx.Fail(w, http.StatusBadRequest, "bad_body", "pages 选中的是 none：没有可导出的页")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), exportTimeout)
	defer cancel()

	id, err := tmpstore.NewID("export")
	if err != nil {
		webx.Fail(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	tmp, err := os.CreateTemp(store.Dir(), id+"-*.pdf")
	if err != nil {
		failStoreError(w, err)
		return
	}
	tmpPath := tmp.Name()

	var newDoc *pdfcore.Doc
	if strings.EqualFold(strings.TrimSpace(body.Pages), "all") {
		// vector/all 是克隆：字节原样进出，不重编码。The copy is
		// byte-identical to a source that passed validation when opened, so
		// the response reuses the already-inspected doc.
		f, err := os.Open(src)
		if err != nil {
			_ = tmp.Close()
			_ = os.Remove(tmpPath)
			failStoreError(w, err)
			return
		}
		_, err = io.Copy(tmp, f)
		f.Close()
		if err != nil {
			_ = tmp.Close()
			_ = os.Remove(tmpPath)
			failStoreError(w, err)
			return
		}
		newDoc = doc
	} else {
		f, err := os.Open(src)
		if err != nil {
			_ = tmp.Close()
			_ = os.Remove(tmpPath)
			failStoreError(w, err)
			return
		}
		err = pdfcore.TrimPages(ctx, f, tmp, pages)
		f.Close()
		if err != nil {
			_ = tmp.Close()
			_ = os.Remove(tmpPath)
			log.Warn("vector 导出失败", "asset", body.AssetID, "err", err)
			webx.Fail(w, http.StatusInternalServerError, "export_failed", err.Error())
			return
		}
		if newDoc, err = inspectAsset(ctx, tmpPath, ""); err != nil {
			log.Warn("导出子集无法重新解析", "asset", id, "err", err)
			newDoc = doc // a page selection cannot invent pages
		}
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		failStoreError(w, err)
		return
	}
	// The new asset is validated before it is registered, so the UI never
	// adopts a PDF pdfcpu itself would reject (AGENTS §8).
	if err := pdfcore.Validate(ctx, tmpPath); err != nil {
		_ = os.Remove(tmpPath)
		webx.Fail(w, http.StatusInternalServerError, "validate_failed", err.Error())
		return
	}
	asset, err := store.AddFile(id, tmpstore.KindExport, owner, tmpPath)
	if err != nil {
		_ = os.Remove(tmpPath)
		failStoreError(w, err)
		return
	}
	carryOrigin(log, store, body.AssetID, asset.ID, owner)
	log.Info("pdf exported vector", "from", body.AssetID, "into", asset.ID,
		"pages", newDoc.PageCount, "bytes", asset.Size)
	webx.Created(w, exportResult{
		openResult: openResult{AssetID: asset.ID, Name: "", Size: asset.Size, Kind: "exported", Doc: *newDoc},
		Mode:       "vector",
	})
}

// handleExportRaster serves the multipart half: spec + one bitmap per page.
func handleExportRaster(w http.ResponseWriter, r *http.Request, store *tmpstore.Store, log *slog.Logger, owner string) {
	// MaxBytesHandler already bounded the body; the memory argument only
	// decides what ParseMultipartForm keeps in RAM — file parts beyond it
	// spill to OS temp files that the RemoveAll below cleans up.
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		webx.Fail(w, http.StatusBadRequest, "bad_body", "multipart 解析失败: "+err.Error())
		return
	}
	defer r.MultipartForm.RemoveAll()

	specRaw := r.FormValue("spec")
	if specRaw == "" {
		webx.Fail(w, http.StatusBadRequest, "bad_body", "缺少 spec 字段")
		return
	}
	var spec exportSpec
	if err := decodeSpec(specRaw, &spec); err != nil {
		webx.Fail(w, http.StatusBadRequest, "bad_body", "spec 不是合法的 export spec: "+err.Error())
		return
	}
	if spec.AssetID == "" {
		webx.Fail(w, http.StatusBadRequest, "bad_body", "缺少 assetId")
		return
	}
	if spec.Mode != "raster" {
		webx.Fail(w, http.StatusBadRequest, "bad_body", "spec.mode 必须是 raster（vector 走 application/json）")
		return
	}
	if spec.Dpi == 0 {
		webx.Fail(w, http.StatusBadRequest, "bad_body", "spec.dpi 必填")
		return
	}
	if spec.Quality == 0 {
		webx.Fail(w, http.StatusBadRequest, "bad_body", "spec.quality 必填")
		return
	}
	dpi, quality, warning := clampExport(spec.Dpi, spec.Quality)

	src, ok := resolveExportSource(w, store, spec.AssetID, owner)
	if !ok {
		return
	}
	doc, err := inspectAsset(r.Context(), src, "")
	if err != nil {
		failOpen(w, err)
		return
	}
	pages, err := pdfcore.ParsePages(spec.Pages, doc.PageCount)
	if err != nil {
		webx.Fail(w, http.StatusBadRequest, "bad_body", "pages: "+err.Error())
		return
	}
	if len(pages) == 0 {
		webx.Fail(w, http.StatusBadRequest, "bad_body", "pages 选中的是 none：没有可导出的页")
		return
	}
	if len(pages) > maxExportPages {
		webx.Fail(w, http.StatusBadRequest, "bad_body",
			fmt.Sprintf("一次最多导出 %d 页，请求带了 %d 页", maxExportPages, len(pages)))
		return
	}

	// One bitmap per selected page: page-<n> with n the SOURCE page number.
	// Missing, duplicated or stray page fields are client bugs.
	want := make(map[int]bool, len(pages))
	for _, n := range pages {
		want[n] = true
	}
	parts := make([]*multipart.FileHeader, len(pages))
	for i, n := range pages {
		fhs := r.MultipartForm.File["page-"+strconv.Itoa(n)]
		switch {
		case len(fhs) == 0:
			webx.Fail(w, http.StatusBadRequest, "bad_body",
				fmt.Sprintf("缺少第 %d 页的位图（字段 page-%d）", n, n))
			return
		case len(fhs) > 1:
			webx.Fail(w, http.StatusBadRequest, "bad_body",
				fmt.Sprintf("page-%d 出现了 %d 次", n, len(fhs)))
			return
		}
		parts[i] = fhs[0]
	}
	for name := range r.MultipartForm.File {
		if !strings.HasPrefix(name, "page-") {
			continue
		}
		n, err := strconv.Atoi(strings.TrimPrefix(name, "page-"))
		if err != nil || !want[n] {
			webx.Fail(w, http.StatusBadRequest, "bad_body",
				fmt.Sprintf("page 字段 %q 不在导出页清单里", name))
			return
		}
	}

	// Read every bitmap now (bounded): the writer needs all pages, and a
	// page_too_large answer must come before any temp file exists.
	rasterPages := make([]pdfcore.RasterPage, len(pages))
	bytesPerPage := make([]int64, len(pages))
	for i, fh := range parts {
		if fh.Size > maxPageImageBytes {
			pageTooLarge(w, pages[i], fh.Size)
			return
		}
		f, err := fh.Open()
		if err != nil {
			webx.Fail(w, http.StatusInternalServerError, "internal_error", err.Error())
			return
		}
		data, err := io.ReadAll(io.LimitReader(f, maxPageImageBytes+1))
		f.Close()
		if err != nil {
			webx.Fail(w, http.StatusInternalServerError, "internal_error", err.Error())
			return
		}
		if int64(len(data)) > maxPageImageBytes {
			pageTooLarge(w, pages[i], int64(len(data)))
			return
		}
		rasterPages[i] = pdfcore.RasterPage{Number: pages[i], Data: data}
		bytesPerPage[i] = int64(len(data))
	}

	ctx, cancel := context.WithTimeout(r.Context(), exportTimeout)
	defer cancel()

	id, err := tmpstore.NewID("export")
	if err != nil {
		webx.Fail(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	tmp, err := os.CreateTemp(store.Dir(), id+"-*.pdf")
	if err != nil {
		failStoreError(w, err)
		return
	}
	tmpPath := tmp.Name()
	if err := pdfcore.WriteRaster(tmp, rasterPages, pdfcore.RasterOptions{Dpi: dpi}); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
		// Writer failures are undecodable bitmaps: client input, so 400.
		webx.Fail(w, http.StatusBadRequest, "bad_body", err.Error())
		return
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		failStoreError(w, err)
		return
	}
	if err := pdfcore.Validate(ctx, tmpPath); err != nil {
		_ = os.Remove(tmpPath)
		webx.Fail(w, http.StatusInternalServerError, "validate_failed", err.Error())
		return
	}
	asset, err := store.AddFile(id, tmpstore.KindExport, owner, tmpPath)
	if err != nil {
		_ = os.Remove(tmpPath)
		failStoreError(w, err)
		return
	}
	carryOrigin(log, store, spec.AssetID, asset.ID, owner)
	newDoc, err := inspectAsset(ctx, tmpPath, "")
	if err != nil {
		log.Warn("导出 PDF 无法重新解析", "asset", asset.ID, "err", err)
		newDoc = doc // the raster output keeps the source page count
	}
	log.Info("pdf exported raster", "from", spec.AssetID, "into", asset.ID,
		"pages", len(pages), "dpi", dpi, "bytes", asset.Size)
	webx.Created(w, exportResult{
		openResult:   openResult{AssetID: asset.ID, Name: "", Size: asset.Size, Kind: "exported", Doc: *newDoc},
		Mode:         "raster",
		Dpi:          dpi,
		Quality:      quality,
		BytesPerPage: bytesPerPage,
		Warning:      warning,
	})
}

// pageTooLarge answers the W6 hard limit: one page bitmap above
// maxPageImageBytes is rejected outright instead of spooling it.
func pageTooLarge(w http.ResponseWriter, page int, size int64) {
	webx.Fail(w, http.StatusBadRequest, "page_too_large",
		fmt.Sprintf("第 %d 页的位图 %d 字节超过单页 %.0f MiB 上限", page, size, float64(maxPageImageBytes)/(1<<20)))
}

// decodeSpec parses the multipart spec string with the same strictness as
// webx.DecodeJSON: unknown fields are a 400, not a silent drop.
func decodeSpec(spec string, dst any) error {
	dec := json.NewDecoder(strings.NewReader(spec))
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}

// clampExport follows the settings-modal convention (register.go): an
// out-of-range dpi/quality is corrected and reported via the response's
// warning field, not rejected — the front-end sends resolved numbers, so a
// stray value is worth fixing loudly rather than bouncing the whole export.
func clampExport(dpi, quality int) (int, int, string) {
	var msgs []string
	if dpi < minExportDpi || dpi > maxExportDpi {
		msgs = append(msgs, fmt.Sprintf("dpi %d 超出 %d..%d，已按边界处理", dpi, minExportDpi, maxExportDpi))
		dpi = min(max(dpi, minExportDpi), maxExportDpi)
	}
	if quality < minExportQuality || quality > maxExportQuality {
		msgs = append(msgs, fmt.Sprintf("quality %d 超出 %d..%d，已按边界处理", quality, minExportQuality, maxExportQuality))
		quality = min(max(quality, minExportQuality), maxExportQuality)
	}
	return dpi, quality, strings.Join(msgs, "；")
}
