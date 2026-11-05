# docs/changelog/PROJECT_MAP.md

> `PROJECT_MAP.md` 的变更叙述历史（最新在上）。正文只留当前态事实。


## 2026-11-05 — HD13–HD16：`internal/console/ring.go` + `internal/api/logs.go` + 前端 overlay/同高/开关

- 头「最后核对」换成本轮摘要（历轮增量保留在正文之下）；`internal/console` 行补 `ring.go`
  （`LogRing`/`WithRing`/`ParseSince` + `ring_test.go`）；`internal/api` 新 `logs.go` 行；
  `app-shell.js` 新「HD13–HD16 细节调整」行（`CURRENT_MARK`、`setConsoleVisible`/`pollLogs`、
  probe `console`/`selected`）；`app-i18n.js` 行 266 键；`style.css` 行补 overlay 定位组 +
  顶栏 34px 组。

## 2026-11-04 — 视口 V4–V6：`app-preview.js`（fit 整页 + `bindPan`）+ `app-overlay.js`（实例画布 probe 背板）

- 头「最后核对」追加本轮：`fitZoom = min(stageWidth, stageHeight)`（打开默认 fit，两向不溢出）、
  `bindPan`（无滚动条 + Space 平移 + Ctrl+中键 fit + `probe('pan')`）、叠加层「页面 canvas 唯一
  可见合成面、实例画布不挂 DOM」。§11 速查新增「改预览渲染/视口」行。

## 2026-11-04 — 顶栏去文本 / 启动页入口 / 左列出血：`index.html`、`app-shell.js`、`style.css`、`app-i18n.js`、三行 verify

- 头「最后核对」→ 2026-11-04，并把顶栏收尾（HD1–HD3）降为 2026-11-03 增量；**本轮 = HD4–HD7**
  （版本号 `0.1-dev`、顶栏去文本 + 按钮重排、启动页只留「打开文件」+ 路径框 Enter、左列出血；
  `UI_SPEC §6` 删 4 个契约 id、i18n 270 → 268）。
- `index.html` 行：顶栏（`#topbar`）**没有任何文本**（HD5）= `#btn-open`+`#btn-save` 左簇、
  `#lang-seg`+`#theme-seg`+`#btn-shortcuts` 右簇；启动页装载入口 = `#empty-pick`（「打开文件」）
  + `#empty-path` 路径框（HD6）。
- `app-shell.js` 行：「窗口标题」改成 `setDocTitle()`（原生标题栏与 `document.title` 同串 =
  `AutoStamp <版本> [文件名]`；`probe('docTitle')`），不再提 `#top-file`；打开流程补
  `#empty-path` 的 `keydown` Enter → `openByPath`（HD6）。
- `style.css` 行：补**左列出血**（HD7：`#empty-state` 无 `margin`/`border-radius`、
  `#preview-stage` `padding: 0`、`.page-frame` 无圆角）与 `.file-chip` 规则随顶栏文本删除。
- `app-i18n.js` 行：270 键 → **268 键**（`empty.pick.btn` = Open file / 打开文件；
  `empty.open.btn`、`empty.upload.btn` 已删）。
- verify 三行：`ui-contract` 写「`UI_SPEC §6` 的 89 个契约 id 与 mock + 壳 markup 三方一致」；
  `shell-smoke` 补顶栏收尾守卫（删件 id 未复活 = `top-file`/`empty-upload`/`empty-open`/
  `file-input`、顶栏图标几何 = `#btn-open` 左缘 / `#btn-save` 相邻 / `#btn-shortcuts` 最右、
  「顶栏无文本」计数、固定 two-col）；`preview-smoke` 的打开通道 = `#empty-path` 回车（HD6）。
- `ui-smoke` 行不再钉「i18n 196 键」这个过期计数，改成「i18n 全覆盖（每个 `data-i18n`
  解析出非空 en/cn，`[data-i18n-title]` 必须有 cn 孪生）」；`ui-contract` 行同步 89 个契约 id。
- `README.md` 功能表第 7 项（随 zip 出货，必须准确）同步：顶栏无任何文本、左簇/右簇顺序、
  版本与文件名只写窗口标题栏、打开入口 = 顶栏「打开」/启动页「打开文件」/路径框回车/拖放粘贴、
  左列预览占满整列。

## 2026-11-04 — `internal/app` 版本行：`version.go` 记 `pickVersion`，新增 `version_test.go`

- `version.go` 行补记 `pickVersion`（只认真实标签，伪版本/`devel`/`+dirty` 回落 `devVersion` =
  `0.1-dev`）；新增 `version_test.go` 行（版本取值表 + `ReadBuild()` 永不返回伪版本）。
- 驱动面同步：`shell-smoke` 的顶栏守卫已含图标几何/文本计数读数（`topbar: {…}` 一行），与已有的
  「删件 id 未复活」「固定 two-col」「`docTitle`」断言在同一节。

## 2026-11-03 — 顶栏收尾同步：`app-shell.js` / `style.css` / `app-i18n.js` / `shell-smoke` 行

- `app-shell.js` 行去掉「密度切换（`two-col`/`single-col`/`collapsed`）」，改记**窗口标题**
  （`document.title` 与 `#top-file` 同串 = `AutoStamp <版本>` + 文件名；`probe('docTitle')`；`#top-file` 这一行 2026-11-04 起就是「窗口标题（`setDocTitle()`…）」，元素本身已删），
  i18n 片段补 `data-i18n-title`；`SetRecent 读回` 随最近文件 UI 入口删除一起去掉
  （`internal/api/pdf.go` 的 `SetRecent` 仍在，见 §2 行）。
- `style.css` 行改成「版式**固定 two-col** 双栏 + 图标按钮 tooltip」（密度切档规则已删）；
  `app-i18n.js` 行键数 282 → 270；`shell-smoke` 行把「密度」换成「窗口标题（`probe('docTitle')`）」。
- 头「最后核对」单行摘要重写（去堆叠），把本轮顶栏收尾（AGENTS §5.24 + `UI_SPEC §8` HD1–HD3）
  与同日其它增量合并成一句。未新增/删除任何文件条目。

## 2026-11-03 — 新增 `build1.ps1` / `buildm.ps1` 行（§5 构建与校验）

- §5 表增两行：单 exe 出口（webview+strip → `dist\autostamp.exe`）与极限压缩出口（UPX `--ultra-brute`
  + 自校验/真启动门槛）。头「最后核对」补同日增量。实测数据在 FACTS §4.3。

## 2026-11-03 — PD1/PD2 装载 gate 行 + i18n 282 键 + style.css 行更新

- 新增「（续）`app-shell.js` 的 PD1/PD2 装载 gate」行：窗口级 paste/drag 漏斗（`submitFiles`/`classifyLoad`
  /`loadSeals`/`rollbackInstance`/`probe('load')`），并记录 `app-seal.js` 的 upload 门按扩展名兜底。
- `app-i18n.js` 行：276 键 → **282 键**（gen-i18n 重新生成）。
- `style.css` 行：拖放高亮加 `#drop-hint`；登记 polish 删除 `#panel-export` 的 `opacity:.55` 淡化。
- 头「最后核对」补同日增量（装载 gate + polish）。

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
