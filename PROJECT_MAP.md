# PROJECT_MAP.md — AutoStamp 代码地图

> 最后核对：2026-11-02（P0/P0.5/P1/P2/P3/**P4 落盘**绿：`internal/api/apply.go`+`save.go`、
> `internal/pdfcore/{apply,stamp,blend,pages,pxdims,validate}.go`、`tools/verify/apply-smoke.mjs`；
> 骑缝落盘已绿，计划里的 `app-crosspage.js` 从未创建 —— 真实形态在 `app-overlay.js`+`app-shell.js`）。
> 新增/删除包必须同步本文件（AGENTS §10.1）。阶段状态见 `docs/IMPLEMENTATION_PLAN.md §10`。

## 1. 可执行入口（根包 `main`）

|文件|作用|
|---|---|
|`main.go`|启动顺序：`config.Store`（`%APPDATA%\AutoStamp\settings.json`）→ `console` 日志 → `app.LoopbackListener()`（`127.0.0.1:0`）→ `api.NewMux` → `app.Server`（中间链）→ `app.OpenServer`（窗口/浏览器，按构建标签）→ 优雅关闭（信号 + 超时）。**窗口与浏览器只能由 host 文件选择，`main.go` 不得分支。**|
|`host_console.go`|`//go:build !windows \|\| !webview`：`OpenServer` = 打印 URL + 打开系统浏览器（`app.Browse`）。|
|`host_webview_windows.go`|`//go:build windows && webview`：WebView2 窗口。goroutine OS 线程锁 `LockOSThread` → `CoInitializeEx`（容忍 `S_FALSE`/`RPC_E_CHANGED_MODE`，FACTS §1.6）→ `NewWindow` → `Navigate(url)` → 100 ms 消息泵 → `WaitClosed`。崩溃转储写 `%LOCALAPPDATA%\AutoStamp\crash\`。`runtime-debug=false` 才关 DevTools。|

## 2. `internal/`

|包|文件|作用|现状|
|---|---|---|---|
|`internal/app`|`net.go`|`LoopbackListener()`：只绑 `127.0.0.1:0`，返回 `host:port`|P0|
|(续)|`server.go`|`Server`（`http.Server` + `Graceful` 关闭 + 超时）|P0|
|(续)|`middleware.go`|中间链 `recoverLog → requestLog → hostGuard → gzip`；`hostGuard` 拒外部 `Host`（421 `bad_host`）、`strict` 时拒外部 `Origin`（403 `bad_origin`）；`gzipExt` 白名单（跳过 cmaps/wasm/PDF/PNG）|P0|
|(续)|`browser.go`|`Browse(url)`：`rundll32 url.dll,FileProtocolHandler`（Windows）/ `xdg-open` 回退|P0|
|(续)|`version.go`|`BuildInfo`（`debug.ReadBuildInfo` 的 VCS 戳：version/commit/go/os/arch）|P0|
|`internal/api`|`register.go`|`Deps`、`NewMux`（注册静态资产 + `GET /api/health`、`GET/POST /api/settings`、P1 的 `POST /api/fs/pick`、`POST /api/pdf/open`、`GET /api/pdf/raw`、P3 的 `POST /api/pdf/split`、P2 的 `POST /api/pdf/seal/prepare` + `GET /api/pdf/seal/raw`、**P4 的 `POST /api/pdf/apply` + `POST /api/pdf/save`**；未接线的后续路由**不注册**，保留 `ServeMux` 的 405/404，FACTS §1.5）|P0-P4|
|（续）|`pdf.go`|P1 本地文件通道：`handlePick`（原生选择器 + `filePath` 直开授权）、`handleOpen`（grant/multipart 两形态 + 密码两错误码 + `SetRecent`）、`handleRaw`（`http.ServeContent` 的 Range/ETag + owner 绑定 404）、`pdfcore` 密码错误映射|P1|
|（续）|`apply.go`|**P4 矢量落盘**：`handleApply`（`{assetId, instances[]}` → `pdfcore.Stamp` → 先 `Validate` 再注册，kind `applied`，失败删临时文件）、`resolveInstance`（词表逐项解析 + 400 分类：`bad_body`/`not_found`/`kind_denied`）、`(blend,opacity)` 分组、`Origin` 向前继承、`openResult` 复用 open 的响应形状|P4|
|（续）|`save.go`|**P4 写盘**：`handleSave`（目标三选一：`targetPath` / `pathGrantId` / `replaceOriginal`，`replaceOriginal` 走 `tmpstore.Asset.Origin`）+ `fsx.AtomicWriteFunc` 原子写 + 目标校验（拒绝写进会话目录）|P4|
|（续）|`apply_test.go` / `save_test.go`|apply 词表 400 分类、owner 边界、未知字段拒绝、空 instances 拒绝、响应 `kind:applied` + 页元数据；save 目标三选一/互斥、`Origin` 继承链（open→split→apply）、磁盘文件内容 == applied 字节、拒绝写会话目录|P4|
|`internal/config`|`types.go`|`Settings`（`ui`/`overlay`/`split`/`crosspage`/`export`/`recent` 六组，字段名 = UI_SPEC 词表）|P0|
|�|`defaults.go`|`Defaults()`（与 UI_SPEC §2 默认值一致，测试断言）|P0|
|�|`sanitize.go`|枚举/范围校验 + clamp（越界修正并回报 warning；词表 = `allowedBlend`/`allowedDPI`/…）|P0|
|�|`patch.go`|`Patch`（指针字段，只合并送来的部分）|P0|
|�|`store.go`|`Store`：首启写默认、损坏文件备份 + 重置、加载时 clamp、`Apply`、`SetRecent`（去重 + 截断）|P0|
|`internal/fsx`|`atomic.go`|`AtomicWrite`/`AtomicWriteFunc`（temp + `Rename`，跨卷回退）、`ReadIfExists`、`TempName`、`EqualPath`|P0|
|（续）|`path.go`|路径校验（允许根白名单、符号链接解析、扩展名）|P0（P1 起用全量）|
|（续）|`pick.go` / `pick_windows.go` / `pick_script.go` / `pick_other.go`|原生文件选择器：`PickFiles(ctx, PickOptions)` → PowerShell `Forms·FileDialog`（`-STA`、UTF-8 输出、`Cancel` 退出码 3 → `ErrPickCancelled`；`filter pdf|all`、`multi`、`startDir`），非 Windows → `ErrPickUnsupported`（501 `pick_unsupported`）|P1|
|（续）|`pick_test.go` / `pick_windows_test.go`|脚本词表/旗标映射（`TestPickDialogFlags`、`TestPickDialogFilterVocabulary`）、`-STA` 必需、取消退出码、`parsePickScript` 解析|P1|
|`internal/tmpstore`|`store.go`|会话资产库：`Add/AddFile/Get/List/Delete`（owner 绑定 + TTL 2h + 配额 256MiB/2GiB）、`index.json` 持久 + 过期清扫、`GrantPath/CheckGrant/Rename/Rights`（`pathGrantId`）、`SetOrigin/OriginOf`（**P4**：资产来自哪个磁盘文件，split/apply 向前继承，`replaceOriginal` 用）、`ErrNotFound`/`ErrOwner`|P1+P4|
|`internal/console`|`logger.go`|`slog` 封装（级别过滤、stderr、`-verbose`）|P0|
|`internal/webx`|`json.go`|`Envelope{ok,data,code,error}` + `OK/Created/Fail` + `DecodeJSON`（`http.MaxBytesReader`）|P0|
|（续）|`session.go`|`SessionHeader = X-AutoStamp-Session`：前端 `crypto.getRandomValues` 生成的 128-bit 令牌 = 资产/grant 的 owner 能力；`SessionOf` 校验格式（缺失 → 400 `bad_session`）、`NewToken` 服务端测试用|P0（P1 全线使用）|
|`internal/pdfcore`|`read.go`|`Inspect(ctx, r, conf)`：页数、每页 MediaBox pt 尺寸/rotation/`hasFonts`/`hasXObject`、加密探测（`ErrNeedsPassword`/`ErrBadPassword` 再导出 pdfcpu 信号，`DefaultLimits` 显式限流）|P1|
|(续)|`sealimg.go`|印章图通道：`PrepareSeal`(去白底 `despillWhite` despill → alpha 包围盒裁剪 `alphaBounds`/`cropNRGBA` → `scaleDPI` 重采样 + `maxSide` 上限；词表 `despill/alphaTrim/resampleDpi/targetDpi/maxSide`，扩展名按实际内容写)、`SealMeta`(src*/out* 尺寸与 DPI、`AlphaBBox`、`OpaqueRatio` 按**源图**计)、`SealBox`。|P2（骑缝条带切分未做，见 P3）|
|(续)|`split.go`|自动切分：词表 `SplitAuto/SplitRowsCols/SplitCustom/SplitUnsplit` + `SplitSpec{Mode,Rows,Cols,CustomCuts,Veto}`；`PlanForSplit`/`CutPlanForPage`（display 空间,**不按 /Rotate 交换轴**，FACTS §2.3）、`PageIsSpread`(横排且 `w/h>AutoSpreadRatio=0.7`)、`SplitOnePage`（剔掉 pdfcpu 附带的原页）、`MergeCreateFile` 合并回一个 PDF、`sortByPageTail`（按名内页号升序 = reading order）|P3|
|(续)|`stamp.go`|落盘几何与词表：`StampGeom{Scale,Anchor,OffX/OffY,PosX/PosY,CrossPage,Binding,StartOffset,Slot,SlotCount}` + `Box(Page)`（== `app-overlay.rectFor`，条带框高取**整枚印章**的比）、`ParseAnchor`/`ParseBinding`/`ParsePair`、`SealAspect`、`Strips(png,count)`（骑缝条带切片，stdlib 逐列裁切）、`StampInstance`、`ClampScale`|P3+P4|
|(续)|`apply.go`|**落盘主路径** `Stamp(ctx, r, doc, instances)`：按外观分组 → 每组一次 pdfcpu pass → `newStamp` 把契约框翻译成 `model.Watermark{Pos:BottomLeft, Dx/Dy(y 翻转), ScaleAbs}`（FACTS §2.6）→ `BlendApply` 注入本 pass 新 GS 的 `/BM` → 断言页自身的 GS 未被污染|P4|
|(续)|`blend.go`|`/BM` 注入层：`Blend` 16 名 ↔ PDF `/BM`、`BlendApply`、`ExtGStateKeysOf`/`StampGraphicStatesOf`（只注入本 pass 新建、`Artifact/Watermark` 引用的状态；共享对象不重写；已有别的 `/BM` 报错）、内容流 token 扫描器（`>>BDC` 无空格实测）|P4|
|(续)|`pages.go`|pages 词表：`ParsePages`（`all`/`none`/`1,3`/`2-4` → 页号列表，越界拒绝），`/api/pdf/{apply,split,export}` 共用|P4|
|(续)|`pxdims.go` + `validate.go`|`pxDims`（位图字节 → 尺寸，只解头部）、`Validate(ctx, path)` = pdfcpu `ValidateFile` + 显式限流（`DefaultLimits`）|P4|
|(续)|`stamp_test.go` + `apply_test.go`|`Box` 几何镜像（九宫格锚点 / `pos` 通道 / 条带 `startOffset` + 装订边交替 / 非法值拒绝）、`TestStampStripBoxUsesWholeSealAspect`（写进内容流的 `cm` 数字必须来自整枚印章的比）、`TestStampWritesBMAndOpacity`、`TestStampKeepsAppearanceSeparateOnOnePage`、`TestStampDoesNotTouchPageOwnStates`、`TestStampRejectsBadRequests`|P4|
|(续)|`read_test.go` / `sealimg_test.go` / `split_test.go`|`TestPrepareSeal*`（去背/裁剪/重采样/maxSide/拒绝/JPEG）、`TestSplitA4ToHalves`、`TestSplitQuarterGrid`、`TestSplitCustomFractions`、`TestSplitAutoCutsRotatedSpreadOnly`、`TestSplitAutoVetoKeepsPages`、`TestSplitRejectsUnknownMode`、`TestSortByPageTailOrdersNumericTails`、`TestCutPlanForPageKeepsDisplayAxes`|P1-P3|

## 3. `web/`（嵌入 + 前端）

|文件|作用|
|---|---|
|`web/embed.go`|`//go:embed all:static`；`RegisterStatic`：`GET /` → `index.html`（CSP 见下）、`/vendor/*`（长缓存）、`app-*.js`/`style.css`/`favicon.svg`；遍历/未知路径 → 404；`.mjs` → `text/javascript`|
|`web/embed_test.go`|断言：嵌入文件存在、`GET /` 返回壳且**无内联 `<script>`**、CSP 指令逐条（`default-src 'self'`/`script-src 'self'`/`style-src 'self' 'unsafe-inline'`/`object-src 'none'`/`base-uri 'none'`）、`Cache-Control: no-cache`、`nosniff`、遍历拒绝、`.mjs` MIME|
|`web/static/index.html`|壳 DOM（id/`data-field`/`data-i18n` 即契约，`UI_SPEC §6`）；无内联脚本（CSP）。`#preview-stage` **刻意留空**：`app-preview.js` 渲染首个 `page-frame`（canvas + `.textLayer`）后才有内容，P2 在其内加实例叠层；`#asset-hooks` / `pathGrantId` 的 chip 只显示句柄值，本地化文案走 `title`|
|`web/static/app-shell.js`|IIFE + `window.__autoStampShell`：状态机 12 态、i18n（`data-i18n` 与 `data-i18n-placeholder` 独立生效）、密度切换（`two-col`/`single-col`/`collapsed`）、实例列表（增/删/复制/改名 + 选中）、**P2 印章通道**（`sealIdFor`/`restoreInstanceSeals`/`applyTo`、`#stamp-layer` 由 overlay 拥有）、参数控件 ↔ `settings` 持久（`{"patch":{…}}`）、**导出体积预估**（`computeEstimate`/`refreshEstimate`，前端按 FACTS §4 表 × 页面积缩放，无请求；`probe('estimate')`）、P1 打开流程（`pickAndOpen`/`openByPath`/`handleFiles`/`openGrant`/`retryOpen`/`adopt` + 密码弹窗 + `SetRecent` 读回 + 拖放）、`probe()`/`fields()`/`ids()` 给 verify、深链 `#<state>`、toast/modals、`/api/health` 版本校验、`autostamp:lang`/`autostamp:open`/`autostamp:page`/`autostamp:param`/`autostamp:seal`/`autostamp:instance` 事件（跨模块同步）|
|`web/static/app-api.js`|信封解析（`ok/data/code/error`）+ `http_<status>` 上报（未接线路由回 405 纯文本时不假装 JSON，FACTS §1.5）+ `GET/POST /api/settings` + P1 的 `pick/openGrant/uploadPDF/rawURL` 与 sessionStorage 会话令牌（`X-AutoStamp-Session`）|
|`web/static/app-preview.js`|P1 渲染核 + P2/P3 串接：`import()` 载入 vendor `pdf.min.mjs`（`workerSrc`/`cMapUrl`/`standardFontDataUrl`/`wasmUrl` 指向 vendor 路径，`isEvalSupported:false` 保持 CSP 无 `unsafe-eval`）、`getDocument({url: rawURL})` 逐页 `render`（DPR 经 `RenderParameters.transform`，`MAX_RENDER_PIXELS` 超限降级 + `warn.render.hint`）、`goTo/next/prev/zoomBy/fit`、标尺与像素读数、`sample(x,y,w,h)` 按 PDF 点取样、干净页快照（`state.snapshot` → `drawImage`，供 overlay 重合成不重跑 pdf.js）、`overlay.paint/repaint/syncAffordance/selectAt/consumeWheel` 调用点、切分预览（`drawSplitMarks` 按 `split.mode` 在页框上画切点/网格，`probe('splitPreview')`）、`probe()` 供 verify（FACTS §1.7）|
|`web/static/app-textlayer.js`|pdf.js 自带 `TextLayer` 驱动（6.4 无 `renderTextContent` 导出，官方 `TextLayerBuilder` 在未 vendor 的 `web/pdf_viewer.mjs`）：`attach({pdfjs,pageObj,viewport,frame,dpr})` 设 `--total-scale-factor = viewport.scale × OutputScale.pixelRatio` + `--scale-round-x/y` + `transform: scale(1/dpr)`，CSS 用 vendor 的 `.textLayer` 规则；`count(pageObj)` 给验收断言|
|`web/static/app-pager.js`|`#page-pager` 分页条（2026-10-29 P0.5 协议确认：chip + chip 内缩略图，无新增 id）：计数 chip（`pager.count` 走 `title`/`aria-label`）+ 每页一枚 `button.chip[data-page]`（`.pg-no` + `canvas.pg-thumb`，`IntersectionObserver` 懒渲染、重建时 `task.cancel()`）、`All` chip 写 `apply.pages`/`export.pages`|
|`web/static/app-seal.js`|P2 印章图通道：`upload/prepare`（`POST /api/pdf/seal/prepare`，multipart + 页内选项 `seal.prepare.*`）、`revert()`（内存原图 → `despill:false` 重跑 = 「撤销去背」）、`bitmapOf(sealId)`（`/api/pdf/seal/raw` + `createImageBitmap`，给 overlay 合成）、`renderMeta`（chip 文案）、`probe('seals'/'count'/'meta')`。**去背在前端**（UI_SPEC D4 / FACTS §1.8 的反算规则：彩色保留、白/灰丢弃，`min(R,G,B)>=60` 判彩色，彩像素按 `max(0,min(255-c,255-60)/195)` 校正 RGB）|
|`web/static/app-overlay.js`|P2 叠加层：`paint(ctx, info)`（先把干净页存进 `state.snapshot`，再把印章按 alpha 预乘 uint8 + `globalCompositeOperation` + `ctx.filter` 合成进同一 canvas；`save()/restore()` + 显式 `filter='none'`，FACTS §1.4）、`repaint()`（拖拽廉价重合成）、`stripGeometryFor/stripRectsFor`（骑缝条带：单边 right/双面 alternate，宽 = 页宽 ×10%，`startOffset` 位移，逐页不同列）、DOM affordance（`#stamp-layer .instance` + 四角/中心/旋转手柄）、`hitTest/selectAt/beginDrag/moveDrag/endDrag/consumeWheel`（V3：光标在选中实例内时 wheel = `apply.scale` 并 `stopPropagation`）、`parsePages`（`all/none/1,3/2-4`）、`imageDataOf/pixelsForRect`（给 verify 算像素）、`probe()`：`rects strips view affordance drag instancePixels selected filter snapshot canvasRect`（FACTS §1.8）|
|（续）|`web/static/app-shell.js` 的 **P4 落盘通道**|`stampIntoPDF`（`POST /api/pdf/apply` → applied 资产 `adopt`，W2：实例挂到新资产上、`apply-undo` 可用）、`undoRoute('apply'|'split')`、`submitSave`（目标三选一）、`stampBodyOf()` 让 verify 直接读请求体、`probe('chain')` 打印链上 5 个 asset id|
|（续）|`web/static/app-overlay.js` 的 **P4 快照身份**|`paint` 用 `state.surface = info.canvas` 决定快照归属（按**画布元素**，不按 page/scale/尺寸）—— 换文档必须重抓快照，AGENTS §5.18 / FACTS §1.9|
|`web/static/app-i18n.js`|en/cn 文案表（由 `tools/verify/gen-i18n.mjs` 从 `docs/UI_SPEC.md §4` 生成，196 键，禁止手改）|
|`web/static/style.css`|壳样式（两列密度 / 折叠态 / 控件表现代码）+ P1：分页条缩略图（`#page-pager canvas.pg-thumb`）、拖放高亮（`#preview[data-drag]`）|
|`web/static/favicon.svg`|图标（`<link rel="icon">`，否则 Chromium 自动 404 `/favicon.ico`，FACTS §1.5）|
|`web/static/vendor/pdfjs/`|pdf.js 6.4.299 资产（P1 已进）：`build/`（只有 ESM，FACTS §1.1）、`cmaps/`、`standard_fonts/`、`wasm/`、`image_decoders/`、`iccs/`、`web/pdf_viewer.css`（文本层 CSS）；205 文件 / 5,486,850 B，`SHA256.txt` + `web/embed_test.go:TestVendorChecksums` 断言；见该目录 `README.md`|

## 4. `tools/`

|文件|作用|
|---|---|
|`tools/genfix/main.go`|（独立模块 `go.mod`）生成 `docs/ui/fixtures/{page,seal}.png`（stdlib `image/png`，含 alpha 印章）|
|`tools/verify/ui-smoke.mjs`|mock：状态机 15 态 + i18n 196 键 + 0 console error + 无横向溢出 + 切分/骑缝条带 + 混合模式像素矩阵（FACTS §1.2-§1.4）|
|`tools/verify/ui-contract.mjs`|三方契约：mock `data-field` ↔ `UI_SPEC §2` ↔ AGENTS §6 请求字段（含 §6 覆盖度、id 存在性、i18n 表）|
|`tools/verify/shell-smoke.mjs`|真实 `dist/autostamp.exe` + headless Chromium（沙箱 `%APPDATA%`/`%LOCALAPPDATA%`）：壳契约 12 态、en/cn i18n、密度、实例、深链、`/api` 往返、`{"patch":…}` 合并；P1 起断言「未打开文档时 `#preview-stage` 没有假页」|
|`tools/verify/pixel-matrix.mjs`|P2/P4 像素矩阵（页内算法独立重算 vs 真实画布；filter 污染回归；`--only=` 分段）——§1.3/§1.4 的仓库内重跑来源|
|`tools/verify/overlay-smoke.mjs`|**P2 主校验**（真 exe + 真 UI + headless）：上传印章 → 16 模式 ×{1.0,0.6,0.3} → 几何/拖拽/四角/旋转/滚轮 → 骑缝条带 → `ctx.filter` 复位 → 去背计数 → 导出预估 == FACTS §4。分段令牌 `--only=<open\|geometry\|despill\|matrix\|drag\|strip\|filter\|export>`（缺省全跑）；`--reuse-build` 复用 `dist/autostamp-overlay-smoke.exe`（改前端后必须去掉该旗标重建）|
|`tools/verify/preview-smoke.mjs`|P1 端到端：CDP `Page.printToPDF` 现场生成样本（英文多页文字 / 中文 CID / 混合 / 图片型无文字）→ 真 exe → 真 UI 打开（`#empty-path` + `#empty-open`）→ 画布像素、`getTextContent` 条数、`.textLayer` span 计数与层框宽度对齐、翻页/分页条/缩放、切分预览切点计数、vendor 资源 0 失败（FACTS §1.7）|
|`tools/verify/apply-smoke.mjs`|**P4 主校验**（真 exe + 真 UI + headless）：回读一致性矩阵（48 组：落盘 → pdf.js 重渲染 == 独立 blend，FACTS §1.9）、骑缝落盘（逐页半枚 + 条带 bbox 四边 ≤1 pt）、切分→盖章→保存链（磁盘文件再 `fs/pick`+`open`）、撤销盖章/撤销切分。分段 `--only=<matrix|strip|chain|undo>`；改前端后别用 `--reuse-build`|
|`tools/verify/cdp.mjs`|无依赖 CDP 客户端（launch Chrome → `page.*`/`Runtime.evaluate`）|
|`tools/verify/webview-launch.mjs`|`-tags webview` 二进制真窗口启动断言（FACTS §1.6）|
|`tools/verify/comprobe/main.go`|COM `CoInitializeEx` 实测探针（含 `-window` 真窗口泵消息）|
|`tools/verify/gen-i18n.mjs`|从 `docs/UI_SPEC.md §4` 生成 `web/static/app-i18n.js`（改文案只改 §4 表，然后重跑 + 重编 exe）|

## 5. 构建与校验

|文件|作用|
|---|---|
|`build.ps1`|一键：`clean → vet → test → genfix/fixtures → 3 个 exe → verify（ui-smoke/ui-contract/shell-smoke/preview-smoke/overlay-smoke/pixel-matrix/webview-launch/comprobe）→ sizes`；`-Task`、`-Watch`、`-Run`；失败退出码 1（AGENTS §4）|
|`docs/FACTS.md §5.1`|就地可重跑的探针清单 ↔ 本文编号映射|

## 6. 数据目录（运行期，不属于仓库）

|路径|内容|
|---|---|
|`%APPDATA%\AutoStamp\settings.json`|设置（原子写；损坏 → `.corrupt` 备份 + 重置）|
|`%APPDATA%\AutoStamp\seals\`|印章预设（P6）|
|`%LOCALAPPDATA%\AutoStamp\session\`|会话资产 + `index.json`（TTL/配额，`tmpstore`）|
|`%LOCALAPPDATA%\AutoStamp\webview2\`|WebView2 用户数据（`WEBVIEW2_USER_DATA_FOLDER`）|
|`%LOCALAPPDATA%\AutoStamp\crash\`|窗口 goroutine panic 转储|
