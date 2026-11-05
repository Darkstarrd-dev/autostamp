package api

// P2: the seal image channel (AGENTS §6). A scanned seal arrives as a
// white-background RGB scan; both the preview and the eventual embed need the
// same normalised bitmap, so the white matte removal, the alpha-bbox crop and
// the DPI resample run once here (pdfcore.PrepareSeal) and the alpha metadata
// comes back for the UI (docs/UI_SPEC.md §2 api.seal.prepare.*). The prepared
// PNG is stored as a KindSeal asset; GET /api/pdf/seal/raw serves it.

import (
	"bytes"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"

	"autostamp/internal/config"
	"autostamp/internal/fsx"
	"autostamp/internal/pdfcore"
	"autostamp/internal/tmpstore"
	"autostamp/internal/webx"
)

// maxSealBody caps an uploaded seal (AGENTS §5.11 spirit, but for the seal
// bitmap rather than a document: 20 MiB, so a bad upload cannot cost 256 MiB).
const maxSealBody = 20 << 20

// sealResult is the POST /api/pdf/seal/prepare response. The embedded
// pdfcore.SealMeta flattens the alpha metadata (srcWidth/width/aspect/…); Echo
// reports what the server actually applied.
type sealResult struct {
	SealID string `json:"sealId"`
	URL    string `json:"url"`
	MIME   string `json:"mime"`
	Bytes  int64  `json:"bytes"`
	Echo   struct {
		Despill     bool `json:"despill"`
		AlphaTrimed bool `json:"alphaTrimed"`
		ResampleDPI int  `json:"resampleDpi"`
	} `json:"echo"`
	pdfcore.SealMeta
}

// handleSealPrepare answers POST /api/pdf/seal/prepare. Two shapes are accepted
// by Content-Type (HD8, AGENTS §6):
//
//	multipart/form-data  file=<seal image> + despill/alphaTrim/resampleDpi fields
//	                     (paste/drag and preset re-feed; no path is remembered)
//	application/json     {"pathGrantId":"pg…","despill":…,"alphaTrim":…,"resampleDpi":…}
//	                     (top-bar pick + recent-seals dropdown; on success the
//	                      path is remembered — settings.recentSeals, the only
//	                      source the dropdown has)
//
// The uploaded bitmap is decoded in memory — the body cap keeps that bounded —
// and only the prepared PNG is stored, so the session store never holds a
// half-processed upload the UI cannot use. A JSON-form path must resolve through
// a fresh grant, and a missing file answers path_denied so the UI can drop the
// stale dropdown entry (HD8 fallback rule).
func handleSealPrepare(settings *config.Store, store *tmpstore.Store, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		owner, err := webx.SessionOf(r)
		if err != nil {
			webx.Fail(w, http.StatusBadRequest, "bad_session", err.Error())
			return
		}
		var (
			data       []byte
			meta       pdfcore.SealMeta
			opts       pdfcore.SealOptions
			openedPath string // set only for the JSON form: the path to remember
		)
		if ct := r.Header.Get("Content-Type"); strings.HasPrefix(ct, "multipart/") {
			// MaxBytesHandler enforces the body cap before this handler runs, so a
			// failure here is a malformed body rather than a size problem.
			if err := r.ParseMultipartForm(maxSealBody >> 1); err != nil {
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
			if hdr.Size > maxSealBody {
				webx.Fail(w, http.StatusRequestEntityTooLarge, "seal_too_large", "印章文件超过 20 MiB 上限")
				return
			}
			opts = pdfcore.SealOptions{
				Despill:   formBool(r.FormValue("despill"), true),
				AlphaTrim: formBool(r.FormValue("alphaTrim"), true),
				TargetDPI: formDPI(r.FormValue("resampleDpi")),
				MaxSide:   pdfcore.DefaultSealMaxSide,
			}
			data, meta, err = pdfcore.PrepareSeal(file, opts)
			if err != nil {
				failSeal(w, err)
				return
			}
		} else {
			var body struct {
				PathGrantID string `json:"pathGrantId"`
				Despill     *bool  `json:"despill"`
				AlphaTrim   *bool  `json:"alphaTrim"`
				ResampleDPI *int   `json:"resampleDpi"`
			}
			if err := webx.DecodeJSON(r, &body, 1<<20); err != nil {
				webx.Fail(w, http.StatusBadRequest, "bad_body", "请求体不是合法的 seal/prepare 请求: "+err.Error())
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
			if !fsx.IsImageName(path) {
				webx.Fail(w, http.StatusBadRequest, "bad_body", "印章文件必须是 png/jpg/jpeg/bmp/tiff")
				return
			}
			f, err := os.Open(path)
			if err != nil {
				webx.Fail(w, http.StatusBadRequest, "path_denied", "印章文件不可读: "+err.Error())
				return
			}
			defer f.Close()
			if st, serr := f.Stat(); serr == nil && st.Size() > maxSealBody {
				webx.Fail(w, http.StatusRequestEntityTooLarge, "seal_too_large", "印章文件超过 20 MiB 上限")
				return
			}
			opts = pdfcore.SealOptions{
				Despill:   body.Despill == nil || *body.Despill,
				AlphaTrim: body.AlphaTrim == nil || *body.AlphaTrim,
				TargetDPI: jsonDPI(body.ResampleDPI),
				MaxSide:   pdfcore.DefaultSealMaxSide,
			}
			data, meta, err = pdfcore.PrepareSeal(f, opts)
			if err != nil {
				failSeal(w, err)
				return
			}
			openedPath = path
		}

		id, err := tmpstore.NewID("sl")
		if err != nil {
			webx.Fail(w, http.StatusInternalServerError, "internal_error", err.Error())
			return
		}
		asset, err := store.Add(id, tmpstore.KindSeal, owner, bytes.NewReader(data))
		if err != nil {
			failStoreError(w, err)
			return
		}
		if openedPath != "" {
			settings.SetRecentSeal(openedPath) // HD8: the dropdown's record
		}

		out := sealResult{SealID: asset.ID, MIME: "image/png", Bytes: asset.Size, SealMeta: meta}
		out.URL = "/api/pdf/seal/raw?id=" + asset.ID
		out.Echo.Despill = opts.Despill
		out.Echo.AlphaTrimed = opts.AlphaTrim
		out.Echo.ResampleDPI = opts.TargetDPI
		log.Info("seal prepared", "asset", asset.ID, "src", meta.SrcWidth,
			"prepared", meta.Width, "dpi", meta.DPI)
		webx.Created(w, out)
	}
}

// formBool reads an optional boolean; absent or unparsable keeps def.
func formBool(v string, def bool) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "true", "1":
		return true
	case "false", "0":
		return false
	default:
		return def
	}
}

// jsonDPI resolves the optional resampleDpi for the JSON shape: absent falls
// back to the documented default 300 (same policy as formDPI on a missing
// multipart field).
func jsonDPI(v *int) int {
	if v == nil {
		return 300
	}
	return formDPI(strconv.Itoa(*v))
}

// formDPI reads resampleDpi, clamped to the 72..600 range UI_SPEC §2 declares.
// A bad or missing value falls back to the documented default 300 rather than
// failing the upload: the front-end always sends a number, and a hand-edited
// request staying usable is worth more than a strict 400 here.
func formDPI(v string) int {
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil {
		return 300
	}
	switch {
	case n < 72:
		return 72
	case n > 600:
		return 600
	default:
		return n
	}
}

// failSeal maps the prepare failures onto the contract codes the UI can toast.
func failSeal(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, pdfcore.ErrSealUnsupported):
		webx.Fail(w, http.StatusUnsupportedMediaType, "seal_type", err.Error())
	case errors.Is(err, pdfcore.ErrSealEmpty):
		webx.Fail(w, http.StatusBadRequest, "seal_empty", err.Error())
	case errors.Is(err, pdfcore.ErrSealTooLarge):
		webx.Fail(w, http.StatusRequestEntityTooLarge, "seal_too_large", err.Error())
	default:
		webx.Fail(w, http.StatusInternalServerError, "internal_error", err.Error())
	}
}
