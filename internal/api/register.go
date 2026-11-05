// Package api wires the /api routes (AGENTS §6) onto a ServeMux.
//
// P0 registers only the two routes that exist for sure: health and settings.
// Every later stage adds its own route in its own file (pdf.go, seal.go,
// export.go) instead of growing this one function.
package api

import (
	"log/slog"
	"net/http"

	"autostamp/internal/app"
	"autostamp/internal/config"
	"autostamp/internal/presetstore"
	"autostamp/internal/tmpstore"
	"autostamp/internal/webx"
	"autostamp/web"
)

// Deps is what a handler needs; it is built once in main.
type Deps struct {
	Version  app.BuildInfo
	Log      *slog.Logger
	Settings *config.Store
	Assets   *tmpstore.Store
	Presets  *presetstore.Store
}

// NewMux builds the P0–P5 route set. Method patterns come from Go 1.22
// ServeMux, so a wrong verb returns 405 for free.
func NewMux(d Deps) *http.ServeMux {
	mux := http.NewServeMux()

	// Static shell first: "/" is the app page, everything else is a vendor or
	// app-*.js asset served from the embedded FS.
	web.RegisterStatic(mux, web.Static(), d.Log)

	mux.HandleFunc("GET /api/health", handleHealth(d.Version))
	mux.HandleFunc("GET /api/settings", handleSettingsGet(d.Settings))
	mux.HandleFunc("POST /api/settings", handleSettingsPost(d.Settings))

	// P1: the local-file channel. The upload route is wrapped in
	// MaxBytesHandler (AGENTS §5.11) so a 300 MB PDF cannot be spooled; the
	// 413 that comes back is plain router text, and the front-end reports it as
	// http_413 rather than trying to parse a body.
	mux.HandleFunc("POST /api/fs/pick", handlePick(d.Assets, d.Log))
	mux.Handle("POST /api/pdf/open", http.MaxBytesHandler(handleOpen(d.Settings, d.Assets, d.Log), maxPDFBody))
	mux.HandleFunc("GET /api/pdf/raw", handleRaw(d.Assets))
	// P2: the seal image channel. The upload cap is its own (20 MiB), not the
	// PDF body cap, so a stray seal upload cannot spool a document-sized body.
	mux.Handle("POST /api/pdf/seal/prepare", http.MaxBytesHandler(handleSealPrepare(d.Settings, d.Assets, d.Log), maxSealBody))
	mux.HandleFunc("GET /api/pdf/seal/raw", handleSealRaw(d.Assets))
	// P3: 自动切分. The body is a small JSON command (the split vocabulary), the
	// bytes already live in the session store, so no upload cap is needed here.
	mux.HandleFunc("POST /api/pdf/split", handleSplit(d.Assets, d.Log))
	// P4: the seal write-back. Same shape as the response of /api/pdf/open so
	// the UI can swap the asset; the body is the panel vocabulary (AGENTS §6),
	// not a file upload, so no MaxBytesHandler here.
	mux.HandleFunc("POST /api/pdf/apply", handleApply(d.Assets, d.Log))
	// P4 write-back (AGENTS §6): the asset lands on the user's disk through
	// fsx.AtomicWriteFunc, so a save is either complete or absent.
	mux.HandleFunc("POST /api/pdf/save", handleSave(d.Assets, d.Log))
	// P5: the export channel. application/json = vector (source bytes are
	// cloned or page-trimmed, never re-encoded); multipart/form-data = raster
	// (one page bitmap per part, `page-<n>`). The body cap is deliberately
	// generous — one page up to maxPageImageBytes, maxExportPages of them —
	// because a whole document can arrive as bitmaps; MaxBytesHandler turns a
	// runaway body into a plain 413 like the upload route does.
	mux.Handle("POST /api/pdf/export", http.MaxBytesHandler(handleExport(d.Assets, d.Log), maxExportBody))
	// P6: the seal preset library (AGENTS §6, UI_SPEC §8 PR1/PR2). The POST route
	// copies a session seal asset into %APPDATA%\AutoStamp\seals, so a preset is a
	// disk fact rather than a browser blob, and the batch job can stamp from it.
	mux.HandleFunc("GET /api/seal/preset", handlePresetList(d.Presets, d.Log))
	mux.HandleFunc("POST /api/seal/preset", handlePresetSave(d.Presets, d.Assets, d.Log))
	mux.HandleFunc("DELETE /api/seal/preset", handlePresetDelete(d.Presets, d.Log))
	mux.HandleFunc("GET /api/seal/preset/raw", handlePresetRaw(d.Presets))
	// Routes no later stage has implemented still match the static pattern, so
	// they reply 405 (empty body) or 404 (static handler). The front-end
	// reports those as http_405 / http_404 with the status text instead of a
	// bogus parse error; the verb itself is the contract (AGENTS §6).
	//
	// A /api/ subtree handler here would swallow the free 405 from ServeMux, so
	// this stays as it is: the JSON envelope comes from the handlers, and
	// anything else is the router's own reply.
	return mux
}

// healthPayload is the /api/health body. name lets the front-end confirm it is
// talking to AutoStamp and not to another loopback app on the same port.
type healthPayload struct {
	Status  string `json:"status"`
	Name    string `json:"name"`
	Version string `json:"version"`
	Commit  string `json:"commit"`
	Go      string `json:"go"`
	OS      string `json:"os"`
	Arch    string `json:"arch"`
}

func handleHealth(v app.BuildInfo) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		webx.OK(w, healthPayload{
			Status: "ok", Name: "autostamp",
			Version: v.Version, Commit: v.Commit, Go: v.GoVersion, OS: v.GOOS, Arch: v.Arch,
		})
	}
}

func handleSettingsGet(s *config.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		webx.OK(w, settingsPayload{s.Snapshot(), ""})
	}
}

// settingsPOSTBody is the PATCH-style body (pointer fields merge, AGENTS §6).
type settingsPOSTBody struct {
	Patch config.Patch `json:"patch"`
}

// settingsPayload wraps the document plus the clamp warning: a PATCH with an
// out-of-range value is corrected, not rejected, so the app keeps running and
// the UI can still tell the user what was fixed.
type settingsPayload struct {
	Settings config.Settings `json:"settings"`
	Warning  string          `json:"warning,omitempty"`
}

func handleSettingsPost(s *config.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body settingsPOSTBody
		if err := webx.DecodeJSON(r, &body, 1<<20); err != nil {
			webx.Fail(w, http.StatusBadRequest, "bad_body", "请求体不是合法的 settings 补丁: "+err.Error())
			return
		}
		saved, clampErr := s.Apply(&body.Patch)
		warning := ""
		if clampErr != nil {
			warning = clampErr.Error()
		}
		if warning != "" {
			webx.OK(w, settingsPayload{saved, warning})
			return
		}
		webx.OK(w, settingsPayload{saved, ""})
	}
}
