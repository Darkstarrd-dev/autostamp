package api

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"time"

	"autostamp/internal/pdfcore"
	"autostamp/internal/tmpstore"
	"autostamp/internal/webx"
)

// P4: the seal write-back channel (AGENTS §6 POST /api/pdf/apply). This is the
// only place where the preview's seal instances become PDF content: the panel's
// field vocabulary goes in, a new asset comes out.

// applyBody is the POST /api/pdf/apply request. The instance fields are the
// frozen UI_SPEC §2 vocabulary (apply.blend / opacity / scale / pos / anchor /
// offset / rotation / pages / crossPage / startOffset, plus the derived
// `binding` that ui.crosspage.binding feeds into the same request), sent per
// instance because the UI keeps a list of instances and each may differ.
//
// apply.brightness and apply.saturate are deliberately absent: they are
// preview-only (ctx.filter) and never written to the PDF (UI_SPEC §2 语义要点).
// webx.DecodeJSON rejects unknown fields, so sending them is a 400 rather than
// a silently dropped field.
type applyBody struct {
	AssetID   string              `json:"assetId"`
	Instances []applyInstanceBody `json:"instances"`
}

// applyInstanceBody is one instance. Pointer numbers keep "0" from being
// ambiguous: opacity 0, startOffset 0 and rotation 0 are real answers, so an
// absent field falls back to the UI_SPEC default while an explicit 0 is
// honoured.
type applyInstanceBody struct {
	SealID      string   `json:"sealId"`
	Blend       string   `json:"blend"`
	Opacity     *float64 `json:"opacity"`
	Scale       *float64 `json:"scale"`
	Pos         string   `json:"pos"`
	Anchor      string   `json:"anchor"`
	Offset      string   `json:"offset"`
	Rotation    *float64 `json:"rotation"`
	Pages       string   `json:"pages"`
	CrossPage   bool     `json:"crossPage"`
	Binding     string   `json:"binding"`
	StartOffset *float64 `json:"startOffset"`
}

// The UI_SPEC §2 declared defaults, so a request that leaves a slider out
// answers with the same value the panel shows.
const (
	defaultApplyOpacity     = 0.6
	defaultApplyScale       = 0.202
	defaultApplyRotation    = 0.0
	defaultApplyStartOffset = 0.0
)

// applyTimeout bounds a stamping run: pdfcpu works page by page and a large
// document must not hold the request open forever (AGENTS §5.11).
const applyTimeout = 5 * time.Minute

// maxSealBytes bounds the prepared seal image read back out of the session
// store; the upload channel already bounded what can enter it.
const maxSealBytes = 32 << 20

// handleApply answers POST /api/pdf/apply: it bakes the current instances onto
// a copy of the stored document and answers with the same shape as
// /api/pdf/open, so the front-end swaps the asset. The source asset is kept
// (AGENTS §5: 所有修改落到新 asset), which is what 撤销盖章 means here.
//
// The asset name stays empty on purpose: applying is still the *same* document,
// so the UI keeps its title instead of inventing a "stamped …" label.
func handleApply(store *tmpstore.Store, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body applyBody
		if err := webx.DecodeJSON(r, &body, 1<<20); err != nil {
			webx.Fail(w, http.StatusBadRequest, "bad_body", "请求体不是合法的 apply 请求: "+err.Error())
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
		if len(body.Instances) == 0 {
			// An empty instance list is a client bug, not "stamp nothing": the
			// UI only calls this route when it has something to write.
			webx.Fail(w, http.StatusBadRequest, "bad_body", "instances 不能为空")
			return
		}
		src, err := store.Path(body.AssetID, owner)
		if err != nil {
			failStoreError(w, err)
			return
		}
		doc, err := inspectAsset(r.Context(), src, "")
		if err != nil {
			failOpen(w, err)
			return
		}

		instances := make([]pdfcore.StampInstance, 0, len(body.Instances))
		for i, in := range body.Instances {
			one, code, msg := resolveInstance(store, owner, doc, i, in)
			if msg != "" {
				webx.Fail(w, http.StatusBadRequest, code, msg)
				return
			}
			instances = append(instances, one)
		}

		ctx, cancel := context.WithTimeout(r.Context(), applyTimeout)
		defer cancel()

		f, err := os.Open(src)
		if err != nil {
			failStoreError(w, err)
			return
		}
		defer f.Close()

		out, err := pdfcore.Stamp(ctx, f, doc, instances)
		if err != nil {
			log.Warn("印章落盘失败", "asset", body.AssetID, "err", err)
			webx.Fail(w, http.StatusInternalServerError, "apply_failed", err.Error())
			return
		}

		// The new asset is validated before it is registered, so the UI never
		// adopts a PDF that pdfcpu itself would reject (AGENTS §8).
		id, err := tmpstore.NewID("applied")
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
		if _, err := tmp.Write(out); err != nil {
			_ = tmp.Close()
			_ = os.Remove(tmpPath)
			failStoreError(w, err)
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
		asset, err := store.AddFile(id, tmpstore.KindApplied, owner, tmpPath)
		if err != nil {
			_ = os.Remove(tmpPath)
			failStoreError(w, err)
			return
		}
		// The applied asset is the same document with seals on it, so its disk
		// origin carries forward: replaceOriginal still works.
		if origin, err := store.OriginOf(body.AssetID, owner); err == nil && origin != "" {
			if err := store.SetOrigin(asset.ID, origin); err != nil {
				log.Warn("carry origin failed", "asset", asset.ID, "err", err)
			}
		}
		newDoc, err := inspectAsset(ctx, tmpPath, "")
		if err != nil {
			log.Warn("已盖章文档无法重新解析", "asset", asset.ID, "err", err)
			newDoc = doc // the page count cannot change: answer with the old list
		}
		log.Info("pdf stamped", "from", body.AssetID, "into", asset.ID,
			"instances", len(instances), "bytes", asset.Size)
		webx.Created(w, openResult{
			AssetID: asset.ID,
			Name:    "",
			Size:    asset.Size,
			Kind:    string(asset.Kind),
			Doc:     *newDoc,
		})
	}
}

// resolveInstance turns one panel instance into a pdfcore.StampInstance and
// reports (code, message) for anything the client got wrong. These are client
// inputs, so the route answers 400 instead of letting pdfcpu turn a bad value
// into a 500.
func resolveInstance(store *tmpstore.Store, owner string, doc *pdfcore.Doc, i int, in applyInstanceBody) (pdfcore.StampInstance, string, string) {
	label := "实例 " + strconv.Itoa(i+1)
	if in.SealID == "" {
		return pdfcore.StampInstance{}, "bad_body", label + " 缺少 sealId"
	}
	seal, err := store.Get(in.SealID, owner)
	if err != nil {
		return pdfcore.StampInstance{}, "not_found", label + " 的印章不存在或已过期"
	}
	if seal.Kind != tmpstore.KindSeal {
		return pdfcore.StampInstance{}, "kind_denied", label + " 的 sealId 不是印章资产"
	}
	png, err := readSealBytes(store, in.SealID, owner)
	if err != nil {
		return pdfcore.StampInstance{}, "not_found", label + " 的印章图像读不出来: " + err.Error()
	}

	blend := in.Blend
	if blend == "" {
		blend = "multiply" // UI_SPEC §2 default
	}
	b, err := pdfcore.ParseBlend(blend)
	if err != nil {
		return pdfcore.StampInstance{}, "bad_body", label + ": " + err.Error()
	}

	anchor := in.Anchor
	if anchor == "" {
		anchor = "center"
	}
	a, err := pdfcore.ParseAnchor(anchor)
	if err != nil {
		return pdfcore.StampInstance{}, "bad_body", label + ": " + err.Error()
	}

	offX, offY, err := pdfcore.ParsePair(orDefault(in.Offset, "0,0"))
	if err != nil {
		return pdfcore.StampInstance{}, "bad_body", label + " offset: " + err.Error()
	}
	// pos is the alternate channel (UI_SPEC §2: pos 与 anchor 二选一，选锚点后
	// pos 归算). An explicit anchor keeps charge; a request that carries pos
	// without an anchor places the box at that point.
	posX, posY := 0.0, 0.0
	if in.Pos != "" {
		posX, posY, err = pdfcore.ParsePair(in.Pos)
		if err != nil {
			return pdfcore.StampInstance{}, "bad_body", label + " pos: " + err.Error()
		}
		if in.Anchor == "" {
			a = pdfcore.AnchorPos
		}
	}

	opacity := defaultApplyOpacity
	if in.Opacity != nil {
		opacity = *in.Opacity
	}
	if opacity < 0 || opacity > 1 {
		return pdfcore.StampInstance{}, "bad_body", label + " opacity 必须在 0..1 之内"
	}
	scale := defaultApplyScale
	if in.Scale != nil {
		scale = *in.Scale
	}
	rotation := defaultApplyRotation
	if in.Rotation != nil {
		rotation = *in.Rotation
	}
	if rotation < -180 || rotation > 180 {
		return pdfcore.StampInstance{}, "bad_body", label + " rotation 必须在 -180..180 之内"
	}
	startOffset := defaultApplyStartOffset
	if in.StartOffset != nil {
		startOffset = *in.StartOffset
	}
	if startOffset < 0 || startOffset > 200 {
		return pdfcore.StampInstance{}, "bad_body", label + " startOffset 必须在 0..200 之内"
	}

	pages := orDefault(in.Pages, "all") // the UI's All button sends the word
	list, err := pdfcore.ParsePages(pages, doc.PageCount)
	if err != nil {
		return pdfcore.StampInstance{}, "bad_body", label + " pages: " + err.Error()
	}
	if len(list) == 0 {
		return pdfcore.StampInstance{}, "bad_body", label + " 的 pages 是 none，没有可写的页面"
	}

	geom := pdfcore.StampGeom{
		Scale:       pdfcore.ClampScale(scale),
		Anchor:      a,
		OffX:        offX,
		OffY:        offY,
		PosX:        posX,
		PosY:        posY,
		CrossPage:   in.CrossPage,
		StartOffset: startOffset,
	}
	if in.CrossPage {
		bs, err := pdfcore.ParseBinding(orDefault(in.Binding, "right")) // D2 default
		if err != nil {
			return pdfcore.StampInstance{}, "bad_body", label + ": " + err.Error()
		}
		if bs == pdfcore.BindingNone {
			return pdfcore.StampInstance{}, "bad_body", label +
				" binding=none 时不应发送骑缝实例（UI 应先关掉骑缝开关）"
		}
		geom.Binding = bs
	}
	return pdfcore.StampInstance{
		SealID:  in.SealID,
		PNG:     png,
		Geom:    geom,
		Rot:     rotation,
		Opacity: opacity,
		Blend:   b,
		Pages:   list,
	}, "", ""
}

// readSealBytes reads one stored seal image with an explicit bound, so a
// corrupted index entry cannot make the apply route allocate an unbounded buffer.
func readSealBytes(store *tmpstore.Store, id, owner string) ([]byte, error) {
	f, asset, err := store.Open(id, owner)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	if asset.Size > maxSealBytes {
		return nil, io.ErrUnexpectedEOF
	}
	return io.ReadAll(io.LimitReader(f, maxSealBytes))
}

func orDefault(v, def string) string {
	if v == "" {
		return def
	}
	return v
}
