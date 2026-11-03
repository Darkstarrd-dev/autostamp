# PROJECT_MAP.md — AutoStamp 代码地图

> 最后核对：2026-11-03（**P0–P6 全绿**；当前阶段 = P7）。P6 交付：`internal/presetstore` 预设库 +
> `internal/api/seal_preset.go` 四条预设路由 + `fsx` 的 `PickDirs`/`ListMatching` +
> `POST /api/fs/pick{dir:true}` + `POST /api/pdf/save{mkdirs:true}` + 前端批处理跑链
> （AGENTS §5.21 BM1，**没有后端作业路由/SSE**）+ `build.ps1 -Task package` 的 win64 zip。
> `app-crosspage.js` 这个计划名从未创建，真实形态在 `app-overlay.js`+`app-shell.js`。
>
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
|`internal/api`|`register.go`|`Deps`（含 **P6 `Presets *presetstore.Store`**）、`NewMux`（注册静态资产 + `GET /api/health`、`GET/POST /api/settings`、P1 的 `POST /api/fs/pick`、`POST /api/pdf/open`、`GET /api/pdf/raw`、P3 的 `POST /api/pdf/split`、P2 的 `POST /api/pdf/seal/prepare` + `GET /api/pdf/seal/raw`、P4 的 `POST /api/pdf/apply` + `POST /api/pdf/save`、P5 的 `POST /api/pdf/export`、**P6 的 `GET/POST/DELETE /api/seal/preset` + `GET /api/seal/preset/raw`**；未接线的后续路由**不注册**，保留 `ServeMux` 的 405/404，FACTS §1.5）|P0-P6|
|（续）|`pdf.go`|P1 本地文件通道：`handlePick`（原生选择器 + `filePath` 直开授权）、`handleOpen`（grant/multipart 两形态 + 密码两错误码 + `SetRecent`）、`handleRaw`（`http.ServeContent` 的 Range/ETag + owner 绑定 404）、`pdfcore` 密码错误映射|P1|
|（续）|`apply.go`|**P4 矢量落盘**：`handleApply`（`{assetId, instances[]}` → `pdfcore.Stamp` → 先 `Validate` 再注册，kind `applied`，失败删临时文件）、`resolveInstance`（词表逐项解析 + 400 分类：`bad_body`/`not_found`/`kind_denied`）、`(blend,opacity)` 分组、`Origin` 向前继承、`openResult` 复用 open 的响应形状|P4|
|（续）|`pdf_password_test.go`|**AES-256 密码往返**（FACTS §2.8）：无密码 ⇒ `password_required`（pdfcpu 把空密码判 invalid，`inspectAsset` 按契约收口）、错密码 ⇒ `password_invalid`、userPW/ownerPW 都开成功 ⇒ 201 + 页数|
|（续）|`save.go`|**P4 写盘**：`handleSave`（目标三选一：`targetPath` / `pathGrantId` / `replaceOriginal`，`replaceOriginal` 走 `tmpstore.Asset.Origin`）+ `fsx.AtomicWriteFunc` 原子写 + 目标校验（拒绝写进会话目录；`{mkdirs:true}` 才创建 targetPath 的父目录 = 批处理 `_batch` 输出，BM2）|P4+P6|
|（续）|`seal_preset.go` / `seal_preset_test.go`|**P6 预设路由**：`GET/POST /api/seal/preset`、`DELETE /api/seal/preset?name=`、`GET /api/seal/preset/raw?id=`（`http.ServeContent` 管 Range/ETag）+ `validatePresetParams`（复用 `pdfcore.ParseBlend/ParseAnchor/ParsePair/ParseBinding` 并补 `anchor=center`/`binding=right` 默认 ⇒ 预设存的参数一定过 `apply` 校验）+ `presetError/presetStatus`（`preset_bad_name` 400 / `preset_not_found` 404）|P6|
|（续）|`export.go`|**P5 光栅导出**：`handleExport` 按 `Content-Type` 协商 —— `handleExportVector`（json：`{assetId,mode,pages}`，`all` 原样克隆、子集 `TrimPages`、`none`/越界 400）/ `handleExportRaster`（multipart：`spec` JSON + `page-<n` 逐页字节）；`maxPageImageBytes`（90 MiB，包级 var）→ 400 `page_too_large`、页数上限 200、`maxExportBody` 的 `MaxBytesHandler`、dpi/quality 越界 clamp + `warning`、`carryOrigin`、先写临时文件 → `Validate` → 注册，失败删临时文件|P5|
|（续）|`export_test.go`|vector 克隆（字节相等 + `kind:exported` + Origin 继承）、子集/`none`/越界页数、vector body 带 `dpi/quality/customDpi` ⇒ 400、raster multipart 正常（`bytesPerPage`、页 pt `12x16.8`）、owner/`kind_denied`/无 session、`page_too_large`（把上限临时改小）、200 页上限、clamp 落 `warning`、坏 spec 七例|P5|
|（续）|`apply_test.go` / `save_test.go`|apply 词表 400 分类、owner 边界、未知字段拒绝、空 instances 拒绝、响应 `kind:applied` + 页元数据；save 目标三选一/互斥、`Origin` 继承链（open→split→apply）、磁盘文件内容 == applied 字节、拒绝写会话目录|P4|
|`internal/config`|`types.go`|`Settings`（`ui`/`overlay`/`split`/`crosspage`/`export`/`recent` 六组，字段名 = UI_SPEC 词表）|P0|
|�|`defaults.go`|`Defaults()`（与 UI_SPEC §2 默认值一致，测试断言）|P0|
|�|`sanitize.go`|枚举/范围校验 + clamp（越界修正并回报 warning；词表 = `allowedBlend`/`allowedDPI`/…）|P0|
|�|`patch.go`|`Patch`（指针字段，只合并送来的部分）|P0|
|�|`store.go`|`Store`：首启写默认、损坏文件备份 + 重置、加载时 clamp、`Apply`、`SetRecent`（去重 + 截断）|P0|
|`internal/fsx`|`atomic.go`|`AtomicWrite`/`AtomicWriteFunc`（temp + `Rename`，跨卷回退）、`ReadIfExists`、`TempName`、`EqualPath`|P0|
|（续）|`path.go`|路径校验（允许根白名单、符号链接解析、扩展名）|P0（P1 起用全量）|
|（续）|`pick.go` / `pick_windows.go` / `pick_other.go`|原生选择器：`PickFiles`/`PickDirs(ctx, PickOptions{Filter,Multi,StartDir,Dir})` → PowerShell（`-STA`、UTF-8、取消 ⇒ 退出码 3 → `ErrPickCancelled`；文件 = `Forms·OpenFileDialog` + `filter pdf|all` + `multi`；目录 = `Forms·FolderBrowserDialog`，批处理输入 BM1），非 Windows → `ErrPickUnsupported`（501 `pick_unsupported`）|P1+P6|
|（续）|`pick_test.go` / `pick_windows_test.go`|脚本词表/旗标映射、`-STA` 必需、取消退出码、`pickScript({Dir:true})` 必须是目录弹窗（`TestFolderPickScriptShape`）|P1+P6|
|（续）|`list.go`|`ListMatching(dir, filter)`：目录**一层内**的文件（`pdf` = `.pdf`、`all` = 任意、跳过子目录与点文件、大小写无关的稳定顺序）—— 批处理输入由服务端列目录，不让浏览器决定磁盘上有什么|P6|
|（续）|`list_test.go`|作用域钉死：一层内、扩展名、点文件/子目录排除、空 filter 走 pdf 默认、未知 filter 报错、缺目录报错|P6|
|`internal/tmpstore`|`store.go`|会话资产库：`Add/AddFile/Get/List/Delete`（owner 绑定 + TTL 2h + 配额 256MiB/2GiB）、`index.json` 持久 + 过期清扫、`GrantPath/CheckGrant/Rename/Rights`（`pathGrantId`）、`SetOrigin/OriginOf`（**P4**：资产来自哪个磁盘文件，split/apply 向前继承，`replaceOriginal` 用）、`ErrNotFound`/`ErrOwner`|P1+P4|
|`internal/presetstore`|`store.go` / `store_test.go`|**P6 印章预设库**（`%APPDATA%\AutoStamp\seals`）：`presets.json` 索引（`fsx.AtomicWrite` 原子重写）+ 每预设一张 `p-<hash>.png`；`Save/SaveFile/List/Get/Delete/ImageFile`、`ValidateName`（拒路径分隔符/控制字符/尾点）、`Params` = `apply.*` + `seal.prepare.*`；同名 = 覆盖，索引是权威（损坏 ⇒ 按空库 + 警告）|P6|
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
|(续)|`raster.go`|**P5 writer（stdlib）**：`WriteRaster(w, []RasterPage, {Dpi})` —— JPEG 输入 `/DCTDecode` **原始字节直传**（不重编码），PNG 解码后 `/FlateDecode`（zlib raw scanlines，行前置 filter 0）+ 有 alpha 时 `/SMask` 灰度平面；`/MediaBox` 用 `ptString(px,dpi)` = `px*72/dpi` 两位小数；内容流 `q W 0 0 H 0 0 cm /Im0 Do Q`；xref/`/Size`/`startxref`/`%%EOF` 精确；无 `/Rotate`（前端位图已是显示方向）；`TrimPages` 用 `api.Trim`（`ExtractPagesFile` 只产每页单页文件，产不出子集资产）|P5|
|(续)|`raster_test.go`|字节结构（xref 逐项指向 `N 0 obj`、`/Length`、`/MediaBox` `153.60/115.20`、DCT 流 == 输入字节）、Flate 路径（解压 `h*(1+w*3)`、SMask `h*(1+w)`、无 SMask 反例）、FACTS §4 量级（±40%，注释写明不能钉 ±5%）、`TestRasterWriterPassesPdfcpuValidate`|P5|
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
|（续）|`web/static/app-shell.js` 的 **P5 光栅通道**|`submitSave` 里的 W1/W5 链：`stampIntoPDF` → W6 预估拦截（`MAX_EXPORT_PAGE_BYTES` = 90 MiB，超 ⇒ `warn.export.tooBig` 且**零请求**）→ 前端光栅化（离屏 pdf.js `scale=dpi/72`、显示方向不补偿 → `toBlob('image/jpeg',q/100)`）→ `exportUpload`（multipart）→ `adopt(from:"export")` → `ok.exported`；`exportDpiOf`/`exportQualityOf` 与 `computeEstimate` 共用；`probe('exportBody')` 钉 spec/页号/每页字节/px 框|
|（续）|`web/static/app-api.js` 的 **P5 multipart 通道**|`uploadMultipart(path, fields, files)` 是全仓**唯一**的 multipart 出口（会话头 + same-origin + `envelopeOf` 只此一处）；`uploadPDF`/`uploadPOST` 是它的「单 `file` 形状」包装，`exportUpload` 用它送 `spec` + `page-<n>`|
|（续）|`web/static/app-api.js` 的 **P6 预设通道**|`presetList/presetSave/presetDelete/presetRawURL/rawBytes`（会话头 + 信封复用同一处）|
|`web/static/app-batch.js`|P6 印章**预设库 UI** + **批处理队列**：`window.__autoStampBatch`；预设 存/载/删/列表（列表镜像到印章卡与批处理卡的两个 select）；批处理 = **无后端作业路由的前端跑链**（AGENTS §5.21 BM1）`fs/pick{dir:true}`→`open`→（`split`）→`apply`→`export`(raster，离屏 pdf.js `scale=dpi/72` 回传)→`save{mkdirs}`；`batchTarget()` 输出 `_batch\<原名>.dpi<N>.q<Q>.pdf`（BM2，单扩展名）；`pagesForDoc()` = 预设 pages 词表逐文档求交集（BM5）；并发 `api.batch.concurrency`（1..8）+ 停止；加密行 `batch.status.encrypted`（BM4，不弹密码）；报表 CSV/JSON 由 `Blob`+`a[download]` 生成（不发请求）；`probe("queue"｜"report"｜"presets")` 给 verify|
|`web/static/app-i18n.js`|en/cn 文案表（由 `tools/verify/gen-i18n.mjs` 从 `docs/UI_SPEC.md §4` 生成，276 键，禁止手改）|
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
|`tools/verify/export-smoke.mjs`|**P5 主校验**（真 exe + 真 UI + headless）：保存链里的 raster 通道（apply → 前端位图 → multipart → adopt → 写盘）、页 pt == `px*72/dpi`（Δ 0.000）、导出文件字节落在 FACTS §4 的 ±40% 量级带、回读像素 Δ ≤6、vector 零 `/api/pdf/export` 请求 + 文字仍在、W6 超限只出 warn 且零请求、`pages="2"` 只送 `page-2`。分段 `--only=<raster|vector|guard|chain>`|
|`tools/verify/batch-smoke.mjs`|**P6 主校验**（真 exe + 真 UI + headless）：分段 `--only=<preset|batch>`。preset = 真 UI 存/载/删往返（两个 select 都出现、面板参数写回、删除后列表空）；batch = **P6 验收形态** 22 份（20 份可盖 + 1 份 AES-256 加密 + 1 份故意坏）→ 报表计数 `[22,20,1,1]`、状态分布、`_batch\原名.dpi150.q75.pdf` 全在、产物页数与源一致、**源文件字节不动**、加密/坏文件没有产物、CSV/JSON 真下载（22 行、只有 ok 行带 `_batch`）、两个预期 400（`/api/pdf/open`）之外 0 失败请求与 0 console error|
|`tools/verify/encfx/main.go`|现场生成 **AES-256 加密样本**（`pdfcore.WriteRaster` 一页 JPEG → `api.EncryptFile` + `model.NewAESConfiguration`），给 batch-smoke 的加密行与 `pdf_password_test.go` 用；不落二进制 blob|
|`tools/verify/apply-smoke.mjs`|**P4 主校验**（真 exe + 真 UI + headless）：回读一致性矩阵（48 组：落盘 → pdf.js 重渲染 == 独立 blend，FACTS §1.9）、骑缝落盘（逐页半枚 + 条带 bbox 四边 ≤1 pt）、切分→盖章→保存链（磁盘文件再 `fs/pick`+`open`）、撤销盖章/撤销切分。分段 `--only=<matrix|strip|chain|undo>`；改前端后别用 `--reuse-build`|
|`tools/verify/cdp.mjs`|无依赖 CDP 客户端（launch Chrome → `page.*`/`Runtime.evaluate`）|
|`tools/verify/webview-launch.mjs`|`-tags webview` 二进制真窗口启动断言（FACTS §1.6）+ **P6 冷启动读数**：spawn → `webview window opened`（`window-open N ms`）与首个 `/api/health`（`health N ms`），与 P6 的 1.5 s 判据比对（超过打 error 行）；argv 可指到 `dist/autostamp-webview-stripped.exe`（出货件本身）|
|`tools/verify/comprobe/main.go`|COM `CoInitializeEx` 实测探针（含 `-window` 真窗口泵消息）|
|`tools/verify/gen-i18n.mjs`|从 `docs/UI_SPEC.md §4` 生成 `web/static/app-i18n.js`（改文案只改 §4 表，然后重跑 + 重编 exe）|

## 5. 构建与校验

|文件|作用|
|---|---|
|`build.ps1`|一键：`clean → vet → test → genfix/fixtures → 3 个 exe → verify（十脚本）→ sizes`；**P6 起 `package`（PC1）**：`autostamp-<rev>-win64.zip` = `autostamp.exe` + `README.md`，带 25 MB 体积门；`-Task`（逗号列表）/`-Watch`/`-Run`；失败退出码 1（AGENTS §4）。VCS 短号取 `go version -m` 的 `vcs.revision=`（旧正则按空白匹配，所以之前打印 `commit n/a`）|
|`docs/FACTS.md §5.1`|就地可重跑的探针清单 ↔ 本文编号映射|

## 6. 数据目录（运行期，不属于仓库）

|路径|内容|
|---|---|
|`%APPDATA%\AutoStamp\settings.json`|设置（原子写；损坏 → `.corrupt` 备份 + 重置）|
|`%APPDATA%\AutoStamp\seals\`|印章预设（P6）|
|`%LOCALAPPDATA%\AutoStamp\session\`|会话资产 + `index.json`（TTL/配额，`tmpstore`）|
|`%LOCALAPPDATA%\AutoStamp\webview2\`|WebView2 用户数据（`WEBVIEW2_USER_DATA_FOLDER`）|
|`%LOCALAPPDATA%\AutoStamp\crash\`|窗口 goroutine panic 转储|
