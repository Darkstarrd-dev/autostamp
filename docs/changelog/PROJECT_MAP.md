# docs/changelog/PROJECT_MAP.md

> `PROJECT_MAP.md` 的变更叙述历史（最新在上）。正文只留当前态事实。


## 2026-11-03 — P7：middleware/defaults 行改写 + `middleware_test` 行

- 头「最后核对」= **P0–P7 全绿**（含 P6/P7 增量清单 + 出货 zip）。
- `middleware.go` 行：链改成 `recoverLog → requestLog → hostGuard → securityHeaders → gzip`，
  登记 `nosniff` 与 `strict` 默认 `true`；`defaults.go` 行登记 `strictOrigin` 默认开；
  新增 `middleware_test.go` 行（Host 421 / Origin 403 两档 / `nosniff` 三处 / gzip /
  panic 恢复 / 日志级别 / `LoopbackListener` / 优雅关服）。
- `types.go` 行的「六组」纠正为实际分组（含 `security`/`batch`）。

## 2026-11-03 — P6 完成：地图补 app-batch / preset / batch-smoke / encfx / 密码测试 / package

- 头「最后核对」改成 **P0–P6 全绿**；`web/static/app-batch.js` 行（预设 UI + 前端跑链 +
  `batchTarget` + `pagesForDoc` + 报表下载）、`app-api.js` 的 P6 预设通道行、
  `tools/verify/batch-smoke.mjs`（22 份样本断言清单）、`tools/verify/encfx`（现场生成
 AES-256 样本）、`internal/api/pdf_password_test.go`、`build.ps1` 的 `package` 任务；
  `save.go` 行补 `{mkdirs}`（BM2）。删掉一条重复的 app-batch「（续）」行。
- 注：`tools/verify/webview-launch.mjs` 行加 P6 冷启动读数（`window-open N ms` / `health N ms`）。

## 2026-11-02 — P6 后端地图：新增 presetstore / api/seal_preset / fsx+list

- 新增包 `internal/presetstore`（`store.go`+`store_test.go`）；`internal/api` 加
  `seal_preset.go`+`seal_preset_test.go`；`internal/fsx` 加 `list.go`+`list_test.go`；
  `internal/api/register.go` 的 `Deps` 加 `Presets` + 四条预设路由；`main.go` 接线
  （`presetstore.New(<configDir>/seals)`）。
- `internal/fsx` 的 pick 行改成 `PickFiles`/`PickDirs`（`pick_script.go` 这个文件名是旧错写：
  脚本生成一直在 `pick.go` 内，`pickScript` 是包内函数）；目录弹窗 = PowerShell
  `System.Windows.Forms.FolderBrowserDialog`（`TestFolderPickScriptShape` 钉住目录弹窗形状）。
- `internal/fsx` 新增 `ListMatching`：批处理输入由服务端列目录，**不让浏览器决定磁盘上有什么**
  （注释写死这个理由）；`list_test.go` 钉住一层内/点文件排除/未知 filter 报错。
- `internal/api/save.go` 行加 `mkdirs`；`seal_preset.go` 行说明参数校验复用 `pdfcore`
  词表解析器（预设存的参数一定过 apply 校验）；头部「最后核对」改 P6。

## 2026-11-02 — P5 光栅导出：api 两行 + pdfcore 两行 + 前端两行续 + export-smoke 行

- 顶部「最后核对」改 P0-P5。
- `internal/api` 加 `export.go` / `export_test.go` 两行；`register.go` 行改 P0-P5。
- `internal/pdfcore` 加 `raster.go` / `raster_test.go`（writer 字节结构 + pdfcpu Validate）。
- `web/static` 加两行续：`app-shell` 的 P5 光栅通道（W5/W6 链 + `probe('exportBody')`）、
  `app-api` 的 `uploadMultipart`（唯一 multipart 出口）。
- `tools/verify` 加 `export-smoke.mjs` 行；`app-i18n.js` 行改 208 键。

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
