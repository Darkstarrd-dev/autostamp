# docs/changelog/PROJECT_MAP.md

> `PROJECT_MAP.md` 的变更叙述历史（最新在上）。正文只留当前态事实。


## 2026-11-02 — P4 落盘：api 三行 + pdfcore 六行 + 前端两行续 + apply-smoke 行

- 顶部「最后核对」改 2026-11-02（P4 绿），并注明 `app-crosspage.js` 从未创建。
- `internal/api` 新增 `apply.go` / `save.go` / `apply_test.go`+`save_test.go` 三行；
  `register.go` 行的「未接线的后续路由不注册」注记更新为 P0-P4（apply/save 已注册）。
- `internal/pdfcore` 新增 `stamp.go`、`apply.go`、`blend.go`、`pages.go`、
  `pxdims.go`+`validate.go`、`stamp_test.go`+`apply_test.go` 六行；`sealimg.go` 行的
  「骑缝条带切分未做」注记去掉（条带在 `stamp.go:Strips`）。
- `internal/tmpstore` 行加 `SetOrigin/OriginOf`（资产来自哪个磁盘文件，split/apply 继承）。
- `web/static` 加两行续：`app-shell.js` 的 P4 落盘通道（`stampIntoPDF`/`undoRoute`/
  `submitSave`/`stampBodyOf`/`probe('chain')`）、`app-overlay.js` 的 P4 快照身份
  （`state.surface` 按画布元素，见 AGENTS §5.18 / FACTS §1.9）。
- `tools/verify` 新增 `apply-smoke.mjs` 行（分段令牌见 AGENTS §8）。

## 2026-10-30 — P2 叠加预览：新增 app-seal.js / app-overlay.js 两行，tools 表补三个脚本

- 顶部「最后核对」改为 2026-10-30：P0/P0.5/P1 绿 + **P2 叠加预览**绿。
- §3 `web/static` 表：
  - `app-shell.js` 行补 P2 内容（`sealIdFor`/`restoreInstanceSeals`/`applyTo`、
    `#stamp-layer` 交给 overlay 拥有、**导出体积预估** `computeEstimate/refreshEstimate`
    + `probe('estimate')`、新增 `autostamp:param/seal/instance` 事件）。
  - `app-preview.js` 行从「P1 渲染核」扩写：干净页快照 `state.snapshot`（给 overlay
    重合成，不重跑 pdf.js）、`overlay.paint/repaint/syncAffordance/selectAt/consumeWheel`
    调用点、切分预览 `drawSplitMarks` + `probe('splitPreview')`。
  - **新增** `app-seal.js`（上传/去背/撤销/`bitmapOf`/`renderMeta`/`probe`）与
    `app-overlay.js`（合成 + 预乘 alpha + affordance + 条带几何 + 滚轮 + 给 verify 的
    `imageDataOf/pixelsForRect`）两行。
  - `app-i18n.js` 行改成「从 `docs/UI_SPEC.md §4` 生成，196 键」。
- §4 `tools/` 表：新增 `pixel-matrix.mjs`、`overlay-smoke.mjs`（含 `--only=` 令牌清单与
  「改前端后必须去掉 `--reuse-build`」提醒）；`preview-smoke.mjs` 行补「切分预览切点计数」；
  `gen-i18n.mjs` 行注明读的是 mock 内嵌 i18n 字典（与 §4 表互查）。
- §5 `build.ps1` 行：verify 任务列表补 `preview-smoke/overlay-smoke/pixel-matrix/
  webview-launch/comprobe`（此前只列三个脚本，P2 验收不在一键命令里）。
- `app-crosspage.js` 仍是 P3 计划名，**未创建**（条带预览现在在 `app-overlay.js`，
  否决/装订边在 `app-shell.js`）；P3 落盘时若需要独立模块再拆。

## 2026-10-29 — P1 落地：app-api/app-preview/app-textlayer/app-pager 与 vendor 资产

- 见 `docs/changelog/` 同日其它条目；本次仅登记 P1 新增文件与 vendor 校验。
