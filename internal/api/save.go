package api

// P4: the write-back channel (AGENTS §6 POST /api/pdf/save). The session asset
// is streamed into a temp file in the *target* directory and renamed over the
// destination (fsx.AtomicWriteFunc, AGENTS §4: 一律原子写), so a crash never
// leaves a half-written file where the user's document used to be.
//
// Three ways to name the target, and exactly one of them must be set:
//
//	targetPath      explicit absolute path (typed in the save dialog)
//	pathGrantId     a path the native picker already approved for this session
//	replaceOriginal write back to the document's recorded origin
//	                  (tmpstore.Asset.Origin), which is what the 替换原文件
//	                  confirmation modal decided (UI_SPEC §8 S1)

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"autostamp/internal/fsx"
	"autostamp/internal/pdfcore"
	"autostamp/internal/tmpstore"
	"autostamp/internal/webx"
)

// saveTimeout bounds the validate + copy run: a 256 MiB document plus a pdfcpu
// validation pass is comfortably inside this, and a stuck disk must not hold
// the request open forever.
const saveTimeout = 2 * time.Minute

type saveBody struct {
	AssetID         string `json:"assetId"`
	TargetPath      string `json:"targetPath"`
	PathGrantID     string `json:"pathGrantId"`
	ReplaceOriginal bool   `json:"replaceOriginal"`

	// Mkdirs creates the parent folder of targetPath when it does not exist (the
	// batch job writes into a "_batch" folder it decides on itself, P6 需求 6).
	Mkdirs bool `json:"mkdirs"`
}

// saveResult is the POST /api/pdf/save response. The front-end shows `message`
// verbatim when it is set, so the server composes the text (AGENTS §7: the UI
// only holds i18n keys).
type saveResult struct {
	AssetID  string `json:"assetId"`
	Path     string `json:"path"`
	Size     int64  `json:"size"`
	Replaced bool   `json:"replaceOriginal"`
	Message  string `json:"message"`
}

// handleSave answers POST /api/pdf/save. The asset is validated before it is
// written (AGENTS §8: 落盘后必须能过 ValidateFile), and the store refuses to
// write into its own session directory, because that would truncate the copy
// we are streaming from.
func handleSave(store *tmpstore.Store, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body saveBody
		if err := webx.DecodeJSON(r, &body, 1<<20); err != nil {
			webx.Fail(w, http.StatusBadRequest, "bad_body", "请求体不是合法的 save 请求: "+err.Error())
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
		src, err := store.Path(body.AssetID, owner)
		if err != nil {
			webx.Fail(w, http.StatusNotFound, "not_found", "没有这个 PDF")
			return
		}

		target, replaced, code, msg := resolveTarget(store, body, owner)
		if msg != "" {
			webx.Fail(w, http.StatusBadRequest, code, msg)
			return
		}
		if !strings.HasSuffix(strings.ToLower(target), ".pdf") {
			webx.Fail(w, http.StatusBadRequest, "not_pdf", "只支持 .pdf 文件")
			return
		}
		if fsx.EqualPath(target, src) || strings.HasPrefix(target, filepath.Clean(store.Dir())) {
			// Writing onto the file we are streaming from, or into the session
			// store, would truncate the very copy the UI is showing.
			webx.Fail(w, http.StatusBadRequest, "bad_body", "不能写回会话临时目录")
			return
		}
		dir := filepath.Dir(target)
		// mkdirs (UI_SPEC §2 api.save.mkdirs) creates the parent folder for the batch
		// output; without it a missing folder stays a 400, so a mistyped path cannot
		// write a stray file into a brand new directory.
		if body.Mkdirs {
			if err := os.MkdirAll(dir, 0o755); err != nil {
				webx.Fail(w, http.StatusInternalServerError, "save_failed", "创建目录失败: "+err.Error())
				return
			}
		}
		if st, err := os.Stat(dir); err != nil || !st.IsDir() {
			webx.Fail(w, http.StatusBadRequest, "bad_body", "目标目录不存在: "+dir)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), saveTimeout)
		defer cancel()
		if err := pdfcore.Validate(ctx, src); err != nil {
			webx.Fail(w, http.StatusInternalServerError, "validate_failed", err.Error())
			return
		}

		if err := fsx.AtomicWriteFunc(target, func(dst *os.File) (int64, error) {
			f, err := os.Open(src)
			if err != nil {
				return 0, err
			}
			defer f.Close()
			return io.Copy(dst, f)
		}, 0o644); err != nil {
			webx.Fail(w, http.StatusInternalServerError, "save_failed", err.Error())
			return
		}
		// The on-disk stat is the honest number to answer with.
		var written int64
		if st, err := os.Stat(target); err == nil {
			written = st.Size()
		}

		log.Info("pdf saved", "asset", body.AssetID, "path", target, "bytes", written, "replace", replaced)
		webx.OK(w, saveResult{
			AssetID:  body.AssetID,
			Path:     target,
			Size:     written,
			Replaced: replaced,
			Message:  "已保存到 " + target,
		})
	}
}

// resolveTarget turns the three mutually exclusive target fields into one
// absolute path. Exactly one channel must be set - an ambiguous request is a
// client bug, and guessing which one the user meant is how a document gets
// written to the wrong place.
func resolveTarget(store *tmpstore.Store, body saveBody, owner string) (path string, replaced bool, code, msg string) {
	set := 0
	if body.TargetPath != "" {
		set++
	}
	if body.PathGrantID != "" {
		set++
	}
	if body.ReplaceOriginal {
		set++
	}
	if set != 1 {
		return "", false, "bad_body", "需要且只能指定一种目标: targetPath / pathGrantId / replaceOriginal"
	}
	switch {
	case body.TargetPath != "":
		if !filepath.IsAbs(body.TargetPath) {
			return "", false, "bad_body", "targetPath 必须是绝对路径"
		}
		return filepath.Clean(body.TargetPath), false, "", ""
	case body.PathGrantID != "":
		p, err := store.CheckGrant(body.PathGrantID, owner)
		if err != nil {
			return "", false, "path_denied", "pathGrantId 无效或已过期"
		}
		return filepath.Clean(p), false, "", ""
	default:
		origin, err := store.OriginOf(body.AssetID, owner)
		if err != nil {
			return "", false, "not_found", "没有这个 PDF"
		}
		if origin == "" {
			// An upload has no disk original; the honest answer beats guessing
			// a path the user never chose.
			return "", false, "bad_body", "这个文档来自上传,没有可替换的原文件；请用 targetPath 另存"
		}
		return filepath.Clean(origin), true, "", ""
	}
}
