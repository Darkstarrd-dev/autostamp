package api

// Seal presets (P6, UI_SPEC §8 PR1/PR2): the stamp library on disk
// (%APPDATA%\AutoStamp\seals, internal/presetstore). The 印章预设 段 in the seal card
// offers 存为预设 / 预设列表 / 删除预设, and a batch job runs against a named preset -
// which is why the library is server-side instead of a front-end blob.
//
// Routes (AGENTS §6):
//
//	GET    /api/seal/preset          {"presets":[{name,imageBytes,updatedAt,params}]}
//	POST   /api/seal/preset          {"name","sealId","params"} -> {"preset":{…}}
//	DELETE /api/seal/preset?name=    {"name":"…"}
//	GET    /api/seal/preset/raw?id=  the stored image bytes
//
// The client never re-posts the image bytes: a preset references a session seal asset
// and the server copies that asset's file into the library (presetstore.SaveFile), so
// the preset survives a session purge and the batch can stamp from it without any
// browser round trip.

import (
	"errors"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"time"

	"autostamp/internal/pdfcore"
	"autostamp/internal/presetstore"
	"autostamp/internal/tmpstore"
	"autostamp/internal/webx"
)

// presetSaveBody is the POST /api/seal/preset body: the human name, the seal asset to
// copy, and the parameter group the panel is showing. The parameter names mirror
// UI_SPEC §2's vocabulary (apply.* plus the seal prepare options) so the front end can
// serialize the struct it is already rendering.
type presetSaveBody struct {
	Name   string             `json:"name"`
	SealID string             `json:"sealId"`
	Params presetstore.Params `json:"params"`
}

// presetView is one list row. Params are echoed so 预设列表 shows what loading a preset
// would change, without a second request.
type presetView struct {
	Name       string             `json:"name"`
	ImageBytes int64              `json:"imageBytes"`
	UpdatedAt  string             `json:"updatedAt"`
	Params     presetstore.Params `json:"params"`
}

func presetViewOf(p presetstore.Preset) presetView {
	return presetView{
		Name:       p.Name,
		ImageBytes: p.ImageBytes,
		UpdatedAt:  p.UpdatedAt.UTC().Format(time.RFC3339),
		Params:     p.Params,
	}
}

// validatePresetParams reuses the apply vocabulary's parsers: a preset stores exactly
// what /api/pdf/apply would accept, so loading one into the panel can never land the
// panel in a state the write-back path rejects. The stored values are the normalized
// ones (defaults filled in), which is what the front end writes back into the panel.
func validatePresetParams(in *presetstore.Params) (string, string) {
	if in.Blend == "" {
		in.Blend = "multiply" // UI_SPEC §2 default
	}
	if _, err := pdfcore.ParseBlend(in.Blend); err != nil {
		return "bad_body", "blend: " + err.Error()
	}
	if in.Anchor == "" {
		in.Anchor = "center"
	}
	if _, err := pdfcore.ParseAnchor(in.Anchor); err != nil {
		return "bad_body", "anchor: " + err.Error()
	}
	if in.Offset != "" {
		if _, _, err := pdfcore.ParsePair(in.Offset); err != nil {
			return "bad_body", "offset: " + err.Error()
		}
	}
	if in.Pos != "" {
		if _, _, err := pdfcore.ParsePair(in.Pos); err != nil {
			return "bad_body", "pos: " + err.Error()
		}
	}
	if in.CrossPage {
		if _, err := pdfcore.ParseBinding(orDefault(in.Binding, "right")); err != nil {
			return "bad_body", "binding: " + err.Error()
		}
		if in.Binding == "" {
			in.Binding = "right" // the confirmed default (D2)
		}
	}
	if in.Opacity < 0 || in.Opacity > 1 {
		return "bad_body", "opacity 需在 0..1"
	}
	if in.Scale < 0 || in.Scale > 10 {
		return "bad_body", "scale 需在 0..10"
	}
	if in.StartOffset < 0 || in.StartOffset > 1000 {
		return "bad_body", "startOffset 需在 0..1000"
	}
	if in.ResampleDPI != 0 && (in.ResampleDPI < 72 || in.ResampleDPI > 600) {
		return "bad_body", "resampleDpi 需在 72..600"
	}
	return "", ""
}

// handlePresetList serves GET /api/seal/preset.
func handlePresetList(store *presetstore.Store, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, err := webx.SessionOf(r); err != nil {
			webx.Fail(w, http.StatusBadRequest, "bad_session", err.Error())
			return
		}
		list, err := store.List()
		if err != nil {
			log.Warn("预设列表读取失败", "err", err)
			webx.Fail(w, http.StatusInternalServerError, "preset_list_failed", "预设列表读不出来")
			return
		}
		views := make([]presetView, 0, len(list))
		for _, p := range list {
			views = append(views, presetViewOf(p))
		}
		webx.OK(w, map[string]any{"presets": views})
	}
}

// handlePresetSave stores a named preset from the seal asset the panel already
// prepared. Re-saving the same name overwrites it (PR2: 同名 = 覆盖), which is what
// "replace" means here.
func handlePresetSave(store *presetstore.Store, assets *tmpstore.Store, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		owner, err := webx.SessionOf(r)
		if err != nil {
			webx.Fail(w, http.StatusBadRequest, "bad_session", err.Error())
			return
		}
		var body presetSaveBody
		if err := webx.DecodeJSON(r, &body, 1<<20); err != nil {
			webx.Fail(w, http.StatusBadRequest, "bad_body", "请求体不是合法的 preset 请求: "+err.Error())
			return
		}
		if body.Name == "" || body.SealID == "" {
			webx.Fail(w, http.StatusBadRequest, "bad_body", "预设需要 name 和 sealId")
			return
		}
		if code, msg := validatePresetParams(&body.Params); code != "" {
			webx.Fail(w, http.StatusBadRequest, code, msg)
			return
		}
		asset, err := assets.Get(body.SealID, owner)
		if err != nil {
			webx.Fail(w, http.StatusNotFound, "not_found", "印章资产不存在或已过期")
			return
		}
		if asset.Kind != tmpstore.KindSeal {
			webx.Fail(w, http.StatusBadRequest, "kind_denied", "sealId 必须指向一个印章资产")
			return
		}
		src, err := assets.Path(body.SealID, owner)
		if err != nil {
			webx.Fail(w, http.StatusNotFound, "not_found", err.Error())
			return
		}
		p, err := store.SaveFile(body.Name, src, body.Params)
		if err != nil {
			code, msg := presetError(err)
			webx.Fail(w, presetStatus(code), code, msg)
			return
		}
		log.Info("seal preset saved", "name", p.Name, "bytes", p.ImageBytes)
		webx.Created(w, presetViewOf(p))
	}
}

// handlePresetDelete serves DELETE /api/seal/preset?name=.
func handlePresetDelete(store *presetstore.Store, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, err := webx.SessionOf(r); err != nil {
			webx.Fail(w, http.StatusBadRequest, "bad_session", err.Error())
			return
		}
		name := r.URL.Query().Get("name")
		if name == "" {
			webx.Fail(w, http.StatusBadRequest, "bad_body", "缺少 name")
			return
		}
		if err := store.Delete(name); err != nil {
			code, msg := presetError(err)
			webx.Fail(w, presetStatus(code), code, msg)
			return
		}
		webx.OK(w, map[string]string{"name": name})
	}
}

// handlePresetRaw streams a preset's stored image. The batch re-uploads those bytes
// through /api/pdf/seal/prepare (so despill/trim/resample apply per run, not at save
// time), and the panel uses the same route for its thumbnail. http.ServeContent owns
// Range/ETag, like GET /api/pdf/raw.
func handlePresetRaw(store *presetstore.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, err := webx.SessionOf(r); err != nil {
			webx.Fail(w, http.StatusBadRequest, "bad_session", err.Error())
			return
		}
		name := r.URL.Query().Get("id")
		if name == "" {
			webx.Fail(w, http.StatusBadRequest, "bad_id", "缺少 id")
			return
		}
		preset, path, err := store.ImageFile(name)
		if err != nil {
			code, msg := presetError(err)
			webx.Fail(w, presetStatus(code), code, msg)
			return
		}
		f, err := os.Open(path)
		if err != nil {
			webx.Fail(w, http.StatusNotFound, "preset_not_found", err.Error())
			return
		}
		defer f.Close()
		info, err := f.Stat()
		if err != nil {
			webx.Fail(w, http.StatusInternalServerError, "internal_error", err.Error())
			return
		}
		w.Header().Set("Content-Type", mime.TypeByExtension(".png"))
		http.ServeContent(w, r, preset.Name, info.ModTime(), f)
	}
}

// presetError maps the store's sentinels onto the registered code list (AGENTS §6).
func presetError(err error) (string, string) {
	switch {
	case errors.Is(err, presetstore.ErrBadName):
		return "preset_bad_name", err.Error()
	case errors.Is(err, presetstore.ErrNotFound):
		return "preset_not_found", err.Error()
	default:
		return "preset_save_failed", err.Error()
	}
}

// presetStatus keeps a bad name 400 and a missing preset 404 instead of letting every
// store failure look like a server bug.
func presetStatus(code string) int {
	switch code {
	case "preset_not_found":
		return http.StatusNotFound
	case "preset_bad_name":
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}
