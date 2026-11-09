# PROJECT_MAP.md — AutoStamp 代码地图

> 最后核对：2026-11-09（**IP1/IP2 = 印章参数面板停靠轮**：`style.css` `#instance-panel` 停靠
> `#preview` 右缘（`right/top/bottom:10px` 全高 + `overflow-y:auto`）+ `#instance-fab` 右上角
> 停靠；`app-shell-instances.js` `posInstancePanel` 锚点链删除只留 show/hide；`docs/ui/mockup.html`
> 同形镜像；AGENTS §5.44、`UI_SPEC §8` IP1/IP2。同日前一轮 **Z5 = 骑缝不匀切片模拟轮**：`internal/pdfcore/stamp.go` 新增
> `StripsFractions`（按累计列切条 + 0 槽跳过）+ `StampGeom.SlotFrac`；`api/apply.go` 实例词表
> `slices`（长度 = 作用页数、Σ≤1、全 0 / 非骑缝拒 400）；cp 组「平均|随机」切档 + 覆盖率滑杆 +
> `#crosspage-retry`；`app-shell-instances.js` `randomCrossFractions`/`drawCrossSlices`/
> `retryCrossSlices`；`app-overlay.js` `stripContext` 的 frac/cum + gap 页跳过；`probe('strips')`
> 新读数；settings `apply.sliceMode`/`apply.cover`；AGENTS §5.43、`UI_SPEC §8` Z5。同日前一轮
> **Z1–Z4 = 盖章默认值与骑缝旋转轮**：`internal/pdfcore/rotate.go`
> `RotatePNG` 骑缝章「先旋转整枚、再切竖条」；`app-overlay.js` `rotatedBitmapCanvas` +
> `effectiveBitmap` 同源；`style.css` 删 `[data-mode="crosspage"]` sel-box/handle 隐藏规则
> （骑缝实例单击可选）；`app-shell-kernel.js` `autoScale()` = 42 mm ÷ 页显示宽，新放置/复位
> 覆写 scale；`#apply-blend` multiply 预置 `selected` + 前端 blend 回退 multiply；
> AGENTS §5.39–§5.42、`UI_SPEC §8` Z1–Z4。上一轮 **HD19 = 空态简化**：`#empty-state` 只剩一枚居中的大方圆角按钮
> `#empty-pick`（156 px）+ 一行粘贴/拖拽提示；路径框 `#empty-path`、「多文件」/「过滤」切档
> `#empty-pick-multi`/`#empty-pick-filter` 与 pathGrantId chip 删除，`openByPath(path)` 退化为
> §7 驱动通道；AGENTS §5.38、`UI_SPEC §8` HD19。上一轮 **SP5 = 右侧边栏退场**：`<aside id="right-sidebar">`、
> `form#panel`、`#panel-actions`（含 `#save-open`）删除，导出设置段 `#panel-export` 迁入
> `#save-modal`，`#app-main` grid 改单列 full-bleed；AGENTS §5.37、`UI_SPEC §8` SP5。更早一轮
> **HD13–HD18 细节调整 + P0–P7 全绿**：印章预览卡 = `#preview`
> 左下角 overlay（不再占布局）、下拉自动同步当前打开的印章（无路径印章 = `__current__`
> 标记项）、顶栏控件同高 34px、后端终端 `#btn-console`/`#log-console` + `GET /api/logs`
>（`internal/console/ring.go` `LogRing` + `WithRing` 扇出）+ `config.UI.ConsoleVisible`；
> **装载只设当前印章、实例可全删、boot 无预置实例（HD17）**；**参数面板默认收起 =
> `#instance-fab` 齿轮 ↔ `#instance-collapse`（HD18）**；AGENTS §5.31–§5.34 + §5.35（壳拆分）；
> **V7 = Ctrl+滚轮恒为整页缩放（AGENTS §5.14，取代 V3 实例缩放通道）**；
> i18n **132**（HD19 删 12 个失去控件面的键：`empty.msg`、`empty.path.placeholder`、
> `api.fs.pick.filePath.ctl`/`.hint`、`api.fs.pick.multi.ctl`/`.hint`、`api.fs.pick.filter.ctl`/`.hint`、
> `fs.pick.multi.on`、`fs.pick.filter.pdf`、`fs.pick.filter.all`、`api.fs.pick.pathGrantId.hint`；
> 历史计数 267 → 151 → 144 见 changelog）、ui-ids **56**（HD19 删 `empty-path`/`empty-pick-multi`/
> `empty-pick-filter`；SP5 删 `right-sidebar`/`panel`/`panel-actions`/`save-open`；历史 96 → 63 → 59
> 见 changelog）。出货件 =
> `build.ps1 -Task stripped,package` 的 `dist\autostamp-<rev>-win64.zip`；历轮增量
>（PD1/PD2、build1/buildm、HD1–HD12、V4–V6、P6/P7 接线）见 `docs/changelog/PROJECT_MAP.md`，
> 正文只留当前态事实。`app-crosspage.js` 这个计划名从未创建，真实形态在 `app-overlay.js` +
> `app-shell-*.js` 模块组（7 文件，见下表「壳模块拆分」行）。
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
|(续)|`middleware.go`|中间链 `recoverLog → requestLog → hostGuard → securityHeaders → gzip`；`hostGuard` 拒外部 `Host`（421 `bad_host`）、**P7 起 `strict` 默认 true** 时拒外部 `Origin`（403 `bad_origin`，读动词不查）；`securityHeaders` 给每个响应加 `X-Content-Type-Options: nosniff`（含错误信封）；`gzipExt` 白名单（跳过 cmaps/wasm/PDF/PNG）|P0+P7|
|(续)|`browser.go`|`Browse(url)`：`rundll32 url.dll,FileProtocolHandler`（Windows）/ `xdg-open` 回退|P0|
|(续)|`version.go`|`BuildInfo`（`debug.ReadBuildInfo` 的 VCS 戳：version/commit/go/os/arch）；`pickVersion` 只认真实标签，伪版本/`devel` 回落到 `devVersion`（当前 `0.1-dev`）|P0|
|(续)|`version_test.go`|版本取值表：空/`devel`/伪版本/`+dirty` → dev 横幅，真标签（含 `-rc.1`）原样保留；`ReadBuild()` 永不返回伪版本|P0|
|(续)|`middleware_test.go`|Host 421 / Origin 403（`strict` 两档：外部 Origin 拒、本机 Origin 通、跨站 GET 放行）、`nosniff` 在 API/静态/403 信封上都在、gzip 只压白名单、panic 恢复、日志级别、`LoopbackListener`、优雅关服|P0+P7|
|`internal/api`|`register.go`|`Deps`（含 **P6 `Presets *presetstore.Store`**）、`NewMux`（注册静态资产 + `GET /api/health`、`GET/POST /api/settings`、P1 的 `POST /api/fs/pick`、`POST /api/pdf/open`、`GET /api/pdf/raw`、P3 的 `POST /api/pdf/split`、P2 的 `POST /api/pdf/seal/prepare` + `GET /api/pdf/seal/raw`、P4 的 `POST /api/pdf/apply` + `POST /api/pdf/save`、P5 的 `POST /api/pdf/export`、**P6 的 `GET/POST/DELETE /api/seal/preset` + `GET /api/seal/preset/raw`**；未接线的后续路由**不注册**，保留 `ServeMux` 的 405/404，FACTS §1.5）|P0-P6|
|`internal/api`|`logs.go`|`GET /api/logs`（HD16）：读 `console.LogRing` 400 条尾窗，`{lines, next}` + `?since=` 增量语义|HD16|
|（续）|`pdf.go`|P1 本地文件通道：`handlePick`（原生选择器 + `filePath` 直开授权）、`handleOpen`（grant/multipart 两形态 + 密码两错误码 + `SetRecent`）、`handleRaw`（`http.ServeContent` 的 Range/ETag + owner 绑定 404）、`pdfcore` 密码错误映射|P1|
|(续)|`apply.go`|**P4 矢量落盘**：`handleApply`（`{assetId, instances[]}` → `pdfcore.Stamp` → 先 `Validate` 再注册，kind `applied`，失败删临时文件）、`resolveInstance`（词表逐项解析 + 400 分类：`bad_body`/`not_found`/`kind_denied`；**Z5 `slices`**：只随骑缝实例、长度 = 作用页数、Σ≤1、全 0 拒、非骑缝拒）、`(blend,opacity)` 分组、`Origin` 向前继承、`openResult` 复用 open 的响应形状|P4（Z5 修订）|
|（续）|`pdf_password_test.go`|**AES-256 密码往返**（FACTS §2.8）：无密码 ⇒ `password_required`（pdfcpu 把空密码判 invalid，`inspectAsset` 按契约收口）、错密码 ⇒ `password_invalid`、userPW/ownerPW 都开成功 ⇒ 201 + 页数|
|（续）|`save.go`|**P4 写盘**：`handleSave`（目标三选一：`targetPath` / `pathGrantId` / `replaceOriginal`，`replaceOriginal` 走 `tmpstore.Asset.Origin`）+ `fsx.AtomicWriteFunc` 原子写 + 目标校验（拒绝写进会话目录；`{mkdirs:true}` 才创建 targetPath 的父目录 = 批处理 `_batch` 输出，BM2）|P4+P6|
|（续）|`seal_preset.go` / `seal_preset_test.go`|**P6 预设路由**：`GET/POST /api/seal/preset`、`DELETE /api/seal/preset?name=`、`GET /api/seal/preset/raw?id=`（`http.ServeContent` 管 Range/ETag）+ `validatePresetParams`（复用 `pdfcore.ParseBlend/ParseAnchor/ParsePair/ParseBinding` 并补 `anchor=center`/`binding=right` 默认 ⇒ 预设存的参数一定过 `apply` 校验）+ `presetError/presetStatus`（`preset_bad_name` 400 / `preset_not_found` 404）|P6|
|（续）|`export.go`|**P5 光栅导出**：`handleExport` 按 `Content-Type` 协商 —— `handleExportVector`（json：`{assetId,mode,pages}`，`all` 原样克隆、子集 `TrimPages`、`none`/越界 400）/ `handleExportRaster`（multipart：`spec` JSON + `page-<n` 逐页字节）；`maxPageImageBytes`（90 MiB，包级 var）→ 400 `page_too_large`、页数上限 200、`maxExportBody` 的 `MaxBytesHandler`、dpi/quality 越界 clamp + `warning`、`carryOrigin`、先写临时文件 → `Validate` → 注册，失败删临时文件|P5|
|（续）|`export_test.go`|vector 克隆（字节相等 + `kind:exported` + Origin 继承）、子集/`none`/越界页数、vector body 带 `dpi/quality/customDpi` ⇒ 400、raster multipart 正常（`bytesPerPage`、页 pt `12x16.8`）、owner/`kind_denied`/无 session、`page_too_large`（把上限临时改小）、200 页上限、clamp 落 `warning`、坏 spec 七例|P5|
|（续）|`apply_test.go` / `save_test.go`|apply 词表 400 分类、owner 边界、未知字段拒绝、空 instances 拒绝、响应 `kind:applied` + 页元数据；save 目标三选一/互斥、`Origin` 继承链（open→split→apply）、磁盘文件内容 == applied 字节、拒绝写会话目录|P4|
|`internal/config`|`types.go`|`Settings` 分组（`ui`/`security`/`session`/`seal`/`apply`/`split`/`crosspage`/`export`/`batch`/`recent`（含 `recentFiles` + `recentSeals`，24 条 `SetRecent*` 去重截断，HD8），字段名 = UI_SPEC 词表）|P0-P6+HD8|
|(续)|`defaults.go`|`Default()`（与 UI_SPEC §2 默认值一致，测试断言）；**P7 起 `security.strictOrigin` 默认 `true`**（Origin 校验出货默认开）|P0+P7|
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
|`internal/console`|`logger.go` + `ring.go`|`slog` 封装（级别过滤、stderr、`-verbose`）+ **HD16**：`LogRing`（400 条尾窗、单调 seq、`Since` 增量）与 `WithRing` 扇出 handler（stderr 与环同写）、`ParseSince`；`ring_test.go` 钉序号/边界/扇出|P0+HD16|
|`internal/webx`|`json.go`|`Envelope{ok,data,code,error}` + `OK/Created/Fail` + `DecodeJSON`（`http.MaxBytesReader`）|P0|
|（续）|`session.go`|`SessionHeader = X-AutoStamp-Session`：前端 `crypto.getRandomValues` 生成的 128-bit 令牌 = 资产/grant 的 owner 能力；`SessionOf` 校验格式（缺失 → 400 `bad_session`）、`NewToken` 服务端测试用|P0（P1 全线使用）|
|`internal/pdfcore`|`read.go`|`Inspect(ctx, r, conf)`：页数、每页 MediaBox pt 尺寸/rotation/`hasFonts`/`hasXObject`、加密探测（`ErrNeedsPassword`/`ErrBadPassword` 再导出 pdfcpu 信号，`DefaultLimits` 显式限流）|P1|
|(续)|`sealimg.go`|印章图通道：`PrepareSeal`(去白底 `despillWhite` despill → alpha 包围盒裁剪 `alphaBounds`/`cropNRGBA` → `scaleDPI` 重采样 + `maxSide` 上限；词表 `despill/alphaTrim/resampleDpi/targetDpi/maxSide`，扩展名按实际内容写)、`SealMeta`(src*/out* 尺寸与 DPI、`AlphaBBox`、`OpaqueRatio` 按**源图**计)、`SealBox`。|P2（骑缝条带切分未做，见 P3）|
|(续)|`split.go`|自动切分：词表 `SplitAuto/SplitRowsCols/SplitCustom/SplitUnsplit` + `SplitSpec{Mode,Rows,Cols,CustomCuts,Veto}`；`PlanForSplit`/`CutPlanForPage`（display 空间,**不按 /Rotate 交换轴**，FACTS §2.3）、`PageIsSpread`(横排且 `w/h>AutoSpreadRatio=0.7`)、`SplitOnePage`（剔掉 pdfcpu 附带的原页）、`MergeCreateFile` 合并回一个 PDF、`sortByPageTail`（按名内页号升序 = reading order）|P3|
|(续)|`rotate.go`|**Z4（2026-11-09）** `RotatePNG(pngBytes, deg)`：骑缝章「先旋转整枚、再切竖条」的第一半 —— 屏幕顺时针、画布扩到旋转 bbox（精确 90° = 宽高互换，公式与前端 `rotatedBitmapCanvas` 一致）、最近邻采样、`deg == 0` 恒等|P4（Z4 修订）|
|(续)|`stamp.go`|落盘几何与词表：`StampGeom{Scale,Anchor,OffX/OffY,PosX/PosY,CrossPage,Binding,StartOffset,Slot,SlotCount}` + `Box(Page)`（== `app-overlay.rectFor`，条带框高取**整枚印章旋转后**的比，Z4）、`ParseAnchor`/`ParseBinding`/`ParsePair`、`SealAspect`、`Strips(png,count)`（骑缝条带切片，stdlib 逐列裁切 —— 输入已是 `RotatePNG` 的旋转位图，每列是竖条）、`StripsFractions(png, fractions)`（**Z5**：按各页占比的累计列切条，0 槽返回 nil 不盖章）、`StampInstance`、`ClampScale`|P3+P4（Z4/Z5 修订）|
|(续)|`apply.go`|**落盘主路径** `Stamp(ctx, r, doc, instances)`：按外观分组 → 每组一次 pdfcpu pass → `newStamp` 把契约框翻译成 `model.Watermark{Pos:BottomLeft, Dx/Dy(y 翻转), ScaleAbs}`（FACTS §2.6）→ `BlendApply` 注入本 pass 新 GS 的 `/BM` → 断言页自身的 GS 未被污染|P4|
|(续)|`blend.go`|`/BM` 注入层：`Blend` 16 名 ↔ PDF `/BM`、`BlendApply`、`ExtGStateKeysOf`/`StampGraphicStatesOf`（只注入本 pass 新建、`Artifact/Watermark` 引用的状态；共享对象不重写；已有别的 `/BM` 报错）、内容流 token 扫描器（`>>BDC` 无空格实测）|P4|
|(续)|`pages.go`|pages 词表：`ParsePages`（`all`/`none`/`1,3`/`2-4` → 页号列表，越界拒绝），`/api/pdf/{apply,split,export}` 共用|P4|
|(续)|`pxdims.go` + `validate.go`|`pxDims`（位图字节 → 尺寸，只解头部）、`Validate(ctx, path)` = pdfcpu `ValidateFile` + 显式限流（`DefaultLimits`）|P4|
|(续)|`raster.go`|**P5 writer（stdlib）**：`WriteRaster(w, []RasterPage, {Dpi})` —— JPEG 输入 `/DCTDecode` **原始字节直传**（不重编码），PNG 解码后 `/FlateDecode`（zlib raw scanlines，行前置 filter 0）+ 有 alpha 时 `/SMask` 灰度平面；`/MediaBox` 用 `ptString(px,dpi)` = `px*72/dpi` 两位小数；内容流 `q W 0 0 H 0 0 cm /Im0 Do Q`；xref/`/Size`/`startxref`/`%%EOF` 精确；无 `/Rotate`（前端位图已是显示方向）；`TrimPages` 用 `api.Trim`（`ExtractPagesFile` 只产每页单页文件，产不出子集资产）|P5|
|(续)|`raster_test.go`|字节结构（xref 逐项指向 `N 0 obj`、`/Length`、`/MediaBox` `153.60/115.20`、DCT 流 == 输入字节）、Flate 路径（解压 `h*(1+w*3)`、SMask `h*(1+w)`、无 SMask 反例）、FACTS §4 量级（±40%，注释写明不能钉 ±5%）、`TestRasterWriterPassesPdfcpuValidate`|P5|
|(续)|`stamp_test.go` + `apply_test.go`|`Box` 几何镜像（九宫格锚点 / `pos` 通道 / 条带 `startOffset` + 装订边交替 / 非法值拒绝）、`TestStampStripBoxUsesWholeSealAspect`（写进内容流的 `cm` 数字必须来自整枚印章的比）、`TestStampWritesBMAndOpacity`、`TestStampKeepsAppearanceSeparateOnOnePage`、`TestStampDoesNotTouchPageOwnStates`、`TestStampRejectsBadRequests`|P4|
|(续)|`read_test.go` / `sealimg_test.go` / `split_test.go`|`TestPrepareSeal*`（去背/裁剪/重采样/maxSide/拒绝/JPEG）、`TestSplitA4ToHalves`、`TestSplitQuarterGrid`、`TestSplitCustomFractions`、`TestSplitAutoCutsRotatedSpreadOnly`、`TestSplitAutoVetoKeepsPages`、`TestSplitRejectsUnknownMode`、`TestSortByPageTailOrdersNumericTails`、`TestCutPlanForPageKeepsDisplayAxes`|P1-P3|
|(续)|`rotate_test.go`|**Z4**：`TestRotatePNGClockwise90GrowsCanvas`/`Counter90MirrorDirection`/`180FlipsHalves`/`ZeroIsIdentity`、`TestRotatedStripsAreVerticalColumnsOfRotatedSeal`（旋转 90 后 `Strips` 的切片 = 竖列，两页同一条竖带：上半=印章左半、下半=右半）|P4（Z4）|

## 3. `web/`（嵌入 + 前端）

|文件|作用|
|---|---|
|`web/embed.go`|`//go:embed all:static`；`RegisterStatic`：`GET /` → `index.html`（CSP 见下）、`/vendor/*`（长缓存）、`app-*.js`/`style.css`/`favicon.svg`；遍历/未知路径 → 404；`.mjs` → `text/javascript`|
|`web/embed_test.go`|断言：嵌入文件存在、`GET /` 返回壳且**无内联 `<script>`**、CSP 指令逐条（`default-src 'self'`/`script-src 'self'`/`style-src 'self' 'unsafe-inline'`/`object-src 'none'`/`base-uri 'none'`）、`Cache-Control: no-cache`、`nosniff`、遍历拒绝、`.mjs` MIME|
|`web/static/index.html`|壳 DOM（id/`data-field`/`data-i18n` 即契约，`UI_SPEC §6`）；无内联脚本（CSP）。顶栏（`#topbar`）**没有任何文本**（HD5）：`#btn-open`+`#btn-save` 左簇、`#lang-seg`+`#theme-seg`+`#btn-shortcuts` 右簇，全是图标按钮。**SP5（2026-11-06）**：右侧边栏整块删除（`<aside id="right-sidebar">`、`form#panel`、`#panel-actions` 含 `#save-open` 都不存在了），**导出设置段 `#panel-export`（sec-title + 5 个 `.field` + `#estimate`）现在在 `#save-modal` 内**（`#save-source` 之后、`#save-pick` 之前），保存对话框的唯一入口 = `#btn-save` + Ctrl+S。**HD19（2026-11-06）**：启动页装载入口 = **只有 `#empty-pick` 一枚居中的大方圆角按钮（156 px，「打开文件」）+ 一行 `.hint`**；路径框 `#empty-path`、「多文件」切档 `#empty-pick-multi`、「过滤」切档 `#empty-pick-filter` 与 pathGrantId chip 全部删除。`#preview-stage` **刻意留空**：`app-preview.js` 渲染首个 `page-frame`（canvas + `.textLayer`）后才有内容，P2 在其内加实例叠层；`pathGrantId` 的 chip 只显示句柄值，本地化文案走 `title`|
|`web/static/app-shell-*.js`（7 文件模块组，2026-11-05 拆分自单文件；加载顺序 kernel→instances→seals→export→docops→chrome→verify）|IIFE + `window.__autoStampShell`：状态机 12 态、i18n（`data-i18n`、`data-i18n-placeholder`、图标按钮的 `data-i18n-title` 各自独立生效）、**窗口标题**（`setDocTitle()`：原生标题栏与 `document.title` 同串 = `AutoStamp <版本> [文件名]`；`probe('docTitle')`；顶栏无文本，HD2/HD5）、实例列表（增/删/复制/改名 + 选中）、**P2 印章通道**（`sealIdFor`/`restoreInstanceSeals`/`applyTo`、`#stamp-layer` 由 overlay 拥有）、参数控件 ↔ `settings` 持久（`{"patch":{…}}`）、**导出体积预估**（`computeEstimate`/`refreshEstimate`，前端按 FACTS §4 表 × 页面积缩放，无请求；`probe('estimate')`）、P1 打开流程（`pickAndOpen`/`openByPath`/`handleFiles`/`openGrant`/`retryOpen`/`adopt` + 密码弹窗 + 拖放；HD19 起空态没有路径框，`pickAndOpen()` 固定调 `api.pick({filter:"pdf", multi:true})`，`openByPath(path)` 只是 §7 驱动通道）、`probe()`/`fields()`/`ids()` 给 verify、深链 `#<state>`、toast/modals、`/api/health` 版本校验、`autostamp:lang`/`autostamp:open`/`autostamp:page`/`autostamp:param`/`autostamp:seal`/`autostamp:instance` 事件（跨模块同步）|
|`web/static/app-api.js`|信封解析（`ok/data/code/error`）+ `http_<status>` 上报（未接线路由回 405 纯文本时不假装 JSON，FACTS §1.5）+ `GET/POST /api/settings` + P1 的 `pick/openGrant/uploadPDF/rawURL` 与 sessionStorage 会话令牌（`X-AutoStamp-Session`）|
|`web/static/app-preview.js`|P1 渲染核 + P2/P3 串接 + V4–V6 视口：`import()` 载入 vendor `pdf.min.mjs`（`workerSrc`/`cMapUrl`/`standardFontDataUrl`/`wasmUrl` 指向 vendor 路径，`isEvalSupported:false` 保持 CSP 无 `unsafe-eval`）、`getDocument({url: rawURL})` 逐页 `render`（DPR 经 `RenderParameters.transform`，`MAX_RENDER_PIXELS` 超限降级 + `warn.render.hint`）、`goTo/next/prev/zoomBy/zoomTo/fit/panStage`、**fit = 整页适配**（`fitZoom = min(stageWidth,stageHeight)` 比例不变，V4）、**`bindPan`**（无滚动条 V5：Space+方向键 / Space+左键拖动 / 无 Ctrl 滚轮 → `scroll[Left|Top]` 原生 clamp；**Ctrl+中键 = fit**（V6）；`data-pan` cursor）、标尺与像素读数、`sample(x,y,w,h)` 按 PDF 点取样、干净页快照（`state.snapshot` → `drawImage`，供 overlay 重合成不重跑 pdf.js）、`overlay.paint/repaint/syncAffordance/selectAt` 调用点（Ctrl+滚轮的**整页缩放**接线在 `app-shell-chrome.js`，V7；无 Ctrl 滚轮走 `bindPan`）、切分预览（`drawSplitMarks` 按 `split.mode` 在页框上画切点/网格，`probe('splitPreview')`）、`probe()`（含 `pan`：偏移 + clamp 边界 + `zoom`）供 verify（FACTS §1.7）|
|`web/static/app-textlayer.js`|pdf.js 自带 `TextLayer` 驱动（6.4 无 `renderTextContent` 导出，官方 `TextLayerBuilder` 在未 vendor 的 `web/pdf_viewer.mjs`）：`attach({pdfjs,pageObj,viewport,frame,dpr})` 设 `--total-scale-factor = viewport.scale × OutputScale.pixelRatio` + `--scale-round-x/y` + `transform: scale(1/dpr)`，CSS 用 vendor 的 `.textLayer` 规则；`count(pageObj)` 给验收断言|
|`web/static/app-pager.js`|`#page-pager` 分页条（2026-10-29 P0.5 协议确认：chip + chip 内缩略图，无新增 id）：计数 chip（`pager.count` 走 `title`/`aria-label`）+ 每页一枚 `button.chip[data-page]`（`.pg-no` + `canvas.pg-thumb`，`IntersectionObserver` 懒渲染、重建时 `task.cancel()`）、`All` chip 写 `apply.pages`/`export.pages`|
|`web/static/app-seal.js`|P2 印章图通道：`upload/prepare`（`POST /api/pdf/seal/prepare`，multipart + 页内选项 `seal.prepare.*`）、`prepareFromGrant`（JSON `{pathGrantId}` 形态，顶栏「上传印章」/最近印章下拉走这条，HD8）、`revert()`（内存原图 → `despill:false` 重跑 = 「撤销去背」）、`bitmapOf(sealId)`（`/api/pdf/seal/raw` + `createImageBitmap`，给 overlay 合成）、`renderPreview`（把当前印章画进 `#seal-preview-canvas`，HD9）、`renderMeta`（chip 文案）、`probe('seals'/'count'/'meta')`。**去背在前端**（UI_SPEC D4 / FACTS §1.8 的反算规则：彩色保留、白/灰丢弃，`min(R,G,B)>=60` 判彩色，彩像素按 `max(0,min(255-c,255-60)/195)` 校正 RGB）；**HD17（2026-11-05）：`upload`/`revert` 不再调用 `setSealForSelected`——只设当前印章**|
|`web/static/app-overlay.js`|P2 叠加层：`paint(ctx, info)`（先把干净页存进 `state.snapshot`，再把印章按 alpha 预乘 uint8 + `globalCompositeOperation` + `ctx.filter` 合成进同一 canvas；`save()/restore()` + 显式 `filter='none'`，FACTS §1.4；页面 canvas 是**唯一可见合成面**——`.instance` 只挂 `sel-box`，实例画布**不挂 DOM**仅作 probe 背板，ghost 双绘制已修，AGENTS §5.27）、`repaint()`（拖拽廉价重合成）、`stripGeometryFor/stripRectsFor`（骑缝条带：单边 right/双面 alternate，宽 = 页宽 ×10%，`startOffset` 位移，逐页不同列）、DOM affordance（`#stamp-layer .instance` + 四角/中心/旋转手柄）、`hitTest/selectAt/beginDrag/moveDrag/endDrag`（**V7（2026-11-05）：`consumeWheel` 已删除**——滚轮不再属于叠加层，Ctrl+滚轮恒为 chrome 的整页缩放）、`parsePages`（`all/none/1,3/2-4`）、`imageDataOf/pixelsForRect`（给 verify 算像素）、`probe()`：`rects strips view affordance drag instancePixels selected filter snapshot canvasRect`（FACTS §1.8）|
|（续）|**壳模块拆分**（2026-11-05，AGENTS §5.35；用户对话指令「拆分代码文件便于维护」）|7 文件加载顺序固定（kernel→instances→seals→export→docops→chrome→verify，`index.html` 七 `<script defer>`），唯一跨模块通道 = 门面 `window.__autoStampShell`（kernel 创建，后续模块 `Object.assign(S, …)` 登记；跨文件引用一律 `S.` 前缀，局部 helper 不外泄）。契约面零变化：ui-ids/fields/i18n/probe 词表/门面成员（109）全部不变。拆分生成器留档 `tmp/split-shell.mjs`（此后直接改文件，不重跑）|
|（续）|`app-shell-docops.js` 的 **P4 落盘通道**|`stampIntoPDF`（`POST /api/pdf/apply` → applied 资产 `adopt`，W2：实例挂到新资产上、`apply-undo` 可用）、`undoRoute('apply'|'split')`、`submitSave`（目标三选一）、`stampBodyOf()` 让 verify 直接读请求体、`probe('chain')` 打印链上 5 个 asset id|
|（续）|`web/static/app-overlay.js` 的 **P4 快照身份**|`paint` 用 `state.surface = info.canvas` 决定快照归属（按**画布元素**，不按 page/scale/尺寸）—— 换文档必须重抓快照，AGENTS §5.18 / FACTS §1.9|
|（续）|`app-shell-export.js` + `app-shell-docops.js`（`submitSave`）的 **P5 光栅通道**|`submitSave` 里的 W1/W5 链：`stampIntoPDF` → W6 预估拦截（`MAX_EXPORT_PAGE_BYTES` = 90 MiB，超 ⇒ `warn.export.tooBig` 且**零请求**）→ 前端光栅化（离屏 pdf.js `scale=dpi/72`、显示方向不补偿 → `toBlob('image/jpeg',q/100)`）→ `exportUpload`（multipart）→ `adopt(from:"export")` → `ok.exported`；`exportDpiOf`/`exportQualityOf` 与 `computeEstimate` 共用；`probe('exportBody')` 钉 spec/页号/每页字节/px 框|
|（续）|`web/static/app-api.js` 的 **P5 multipart 通道**|`uploadMultipart(path, fields, files)` 是全仓**唯一**的 multipart 出口（会话头 + same-origin + `envelopeOf` 只此一处）；`uploadPDF`/`uploadPOST` 是它的「单 `file` 形状」包装，`exportUpload` 用它送 `spec` + `page-<n>`|
|（续）|`web/static/app-api.js` 的 **P6 预设通道**|**已删（SP1，2026-11-05）**：`presetList/presetSave/presetDelete/presetRawURL/rawBytes` 帮助器随批处理面板删除；路由仍在后端（Go 测试覆盖）|
|（续）|`app-shell-docops.js`（gate 函数）+ `app-shell-chrome.js`（窗口级接线）的 **PD1/PD2 装载 gate**（AGENTS §5.23）|窗口级 `paste` + `dragenter/dragover/dragleave/drop`（`dragDepth` 计数 → `#preview[data-drag]` + `#drop-hint`）经 `submitFiles` 单漏斗：`classifyLoad` = `pdf`/`seals`/`reject(multi|mix|other)`（type 门只认 `Files`，无 type 时按扩展名兜底，`app-seal.js` 的 `upload` 门同步兜底）；单 PDF → `handleFiles` multipart `adopt`；图片 → `loadSeals`：逐个 `seal/prepare` 并设置**当前印章**（HD17：不指派/不新增实例）；焦点输入框含 `text/plain` 的粘贴放行；`probe('load')` 读 `loadLog`|
|（续）|`app-shell-seals.js` + `app-shell-instances.js` 的 **HD8–HD12 印章顶栏通道 + 浮动面板**（AGENTS §5.28–§5.30）|`pickSealUpload`（`fs/pick{filter:image}` → `openSealByGrant`）、`openRecentSeal(path)`（下拉 replay：`fs/pick{filePath}` → JSON `seal/prepare`；`path_denied` → `dropRecentSeal` + `PATCH settings` + warn toast）、`setAddMode`/`addInstanceAt`（加章模式：点击空白 = 当前印章 + `pages` 当前页）、`state.currentSeal` + `#seal-preview`、`posInstancePanel`（贴选中实例框、翻转/`renderInstances` 跟随）、`DEFAULT_PARAMS` 快照 + `resetInstanceParams`、`#instance-remove` → `deleteSelected`；`probe('addMode'/'defaults'/'recentSeals'/'sealPreview'/'instancePanel'/'page'/'currentSeal')`|
|（续）|`app-shell-seals.js` + `app-shell-chrome.js` + `app-shell-verify.js` 的 **HD13–HD16 细节调整**（AGENTS §5.31/§5.32）|`renderRecentSeals` 每次重建后 value = 当前印章路径（HD14），无路径当前印章 = 末尾标记项 `CURRENT_MARK`（change 处理器 no-op）；`setConsoleVisible(on,persist)`（`#btn-console` aria-pressed 对 + `#log-console` hidden + `PATCH settings{ui.consoleVisible}`）+ `pollLogs`（`api.logs` 1.5s 增量轮询，仅面板可见）；`probe('console')`、`probe('recentSeals')` 增 `selected`|
|（续）|`app-shell-docops.js` + `app-shell-instances.js` + `app-shell-chrome.js` 的 **HD17–HD18 装载/面板语义修订**（AGENTS §5.33/§5.34）|`loadSeals` 只 prepare + 设当前印章（不再 `addInstance`/`rollbackInstance`，两函数删除）；`openSealByGrant` 不再 `setSealForSelected`；`addInstance` 创建时快照 `state.currentSeal`；`deleteSelected` 删到零（`instances.err.last` 保护与 i18n 键删除，零后 `setState("opened")`）；boot 无预置「Seal 1」；`state.panelCollapsed` 默认 true + `#instance-collapse`/`#instance-fab` 双向切档，`posInstancePanel` 面板/齿轮双面锚点；probe `instancePanel` = `{visible, collapsed, fabVisible, left, top, w, h}`|
|（已删）|`web/static/app-batch.js` + `app-api.js` 的 preset 通道 |**SP1（2026-11-05）删除**：批处理面板 + 预设库 UI 随右侧边栏收尾移除；后端路由 `GET/POST/DELETE /api/seal/preset*`、`fs/pick{dir}`、`{mkdirs}` 保留并由 Go 测试钉住（AGENTS §5.36）|
|（续）|**SP1–SP4 侧栏收尾**（AGENTS §5.36；`UI_SPEC §8` SP1–SP4）|`index.html`：删 `#panel-seal`/`#panel-instances`/`#panel-split`/`#panel-batch`/`#panel-crosspage`/`#asset-hooks`，顶栏 `#btn-crosspage-add`（`data-field=ui.seal.crosspageAddMode`），面板 cp 组；`app-pager.js` 重写 = 纯缩略图条（`.chip > canvas.pg-thumb`，无编号/无 All，栏高定死）；`app-shell-seals.js` `setCrosspageAdd`（与 `setAddMode` 互斥）、`app-shell-instances.js` `addCrossInstanceAt` + `syncCpGroup`、`app-overlay.js` 骑缝实例（strip 选中/纵拖 = startOffset/四角 + 旋转手柄）+ 空 stage 放置钩子、`app-shell-chrome.js` binding seg 逐实例语义（`none` 降级）+ Ctrl+Enter/Ctrl+Z 落盘键盘入口；`app-shell-docops.js` `runSplit(opts)` 词表驱动 + `renderVetoChips` 删、`vetoPage` 驱动保留；probe 新增 `crosspageAdd`/`strips`、`addMode` 不变；`style.css` z 序 `#seal-preview`=5 低于面板 8|
|（续）|**SP5 右侧边栏退场**（AGENTS §5.37；`UI_SPEC §8` SP5）|`index.html`：删 `<aside id="right-sidebar">`（连带 `form#panel`、`#panel-actions`、`#save-open`），导出设置段 `#panel-export`（sec-title + `api.export.mode/dpi/customDpi/quality/pages` 五个 `.field` + `#estimate`/`#estimate-total`/`#estimate-per-page`）搬进 `#save-modal`（`#save-source` 之后、`#save-pick` 之前），**id 与 `data-field` 不变**；`style.css`：`#app-main` = `grid-template-columns: minmax(0, 1fr)` + `grid-template-areas: "topbar" "preview"`（单列 full-bleed；`#right-sidebar`/`#panel*` 规则删除），新增 `.modal .section` + `.modal .sec-title` 外壳，`#save-modal` = `top: 8vh` + `max-height: 84vh` + `overflow-y: auto`（导出段在 modal 内滚动）；`app-shell-kernel.js`：`setState("export")` 的开 `details` 分支删除（12 态状态机不变）；`app-shell-chrome.js`：`#save-open` 绑定行删除 → `#btn-save` + Ctrl+S 是保存对话框唯一入口。**已删 id（不再复活）**：`right-sidebar`、`panel`、`panel-actions`、`save-open`；**存活**：`panel-export`、`export-mode`、`export-dpi`、`estimate`、`estimate-total`、`estimate-per-page`（宿主 = `#save-modal`）|
|（续）|**Z1–Z4 盖章默认值与骑缝旋转**（AGENTS §5.39–§5.42；`UI_SPEC §8` Z1–Z4；2026-11-09）|`app-shell-kernel.js`：`autoScale()`（42 mm ÷ 页显示宽，§7 门面登记）+ `SEAL_DEFAULT_MM`/`MM_TO_PT`/`A4_SHORT_PT`；`app-shell-seals.js`/`app-shell-instances.js` 新放置与复位都覆写 `api.apply.scale` = `autoScale()`；`app-overlay.js`：blend 回退 `multiply`（Z1）、`rotatedBitmapCanvas`（`rotCache` 按 sealId×deg 缓存旋转 canvas）+ `effectiveBitmap`（骑缝实例的 hitTest/绘制统一走旋转位图），`rectFor` 骑缝纵横比 = 旋转 bbox，`drawSeal` 竖条路径不再 `ctx.rotate`（Z4）；`style.css`：删除 `[data-mode="crosspage"]` 的 sel-box/handle 隐藏规则（Z3，选中即见绿框 + 手柄）；`index.html`/`mockup.html`：`#apply-blend` multiply 选项 `selected`（Z1）；verify：`overlay-smoke` strip Z3 单击/手柄 + Z4 旋转渐变三取样、`apply-smoke` strip 旋转竖条上下沿、`shell-smoke` Z2 缩放断言 + Z3 手柄/单击|
|（续）|**Z5 骑缝不匀切片模拟**（AGENTS §5.43；`UI_SPEC §8` Z5；2026-11-09）|`index.html`（cp 组 `#crosspage-slicemode` 切档 + `ui.crosspage.cover` 滑杆/数值对 + `#crosspage-retry`；`.cp-rand` 类 = 仅随机可见）与 `docs/ui/mockup.html` 同形镜像；`app-shell-instances.js`：`randomCrossFractions(count, cover, rng)`（纯取值：首页 25~50%、末页 20~30%、中间页按覆盖率四舍五入 + 一条平滑趋势、Σ=1）+ `drawCrossSlices`（放置/参数变化时写实例 `api.apply.slices`）+ `retryCrossSlices`（重掷选中实例）；`app-shell-chrome.js` 切档/滑杆/重试接线；`app-overlay.js`：`stripContext` 返回 `frac/cum`、`frac<=0` 的 gap 页跳过绘制（probe 条目保留、无 rect 无像素）、`drawSeal` 源列起点 = `cum × 图宽`；`app-shell-verify.js` `probe('strips')` 带 `frac/cum`；Go 侧 = `pdfcore.StripsFractions` + `api/apply.go` 词表 + config `apply.sliceMode`/`apply.cover`（见对应行）|
|（续）|**IP1/IP2 面板停靠右缘 + 超高滚动**（AGENTS §5.44；`UI_SPEC §8` IP1/IP2；2026-11-09）|`style.css`：`#instance-panel` = 绝对定位 `#preview` 右缘（`right:10px; top:10px; bottom:10px; width:236px` + `overflow-y:auto` + `overscroll-behavior:contain`，z 8 不变），`#instance-fab` 同角右上停靠；`app-shell-instances.js`：`posInstancePanel` 的贴框锚点链删除（HD12 锚点半边作废），只留 show/hide 语义（出现条件 = 选中实例 + 文档，与实例位置无关）；`docs/ui/mockup.html` 同形镜像（`top:76px bottom:10px` 全高滚动）；`shell-smoke`：IP1 停靠几何（三边 gap=10、宽 236）+ IP2 短视口（430 px）强制溢出的滚动断言|
|（续）|**HD19 空态简化**（AGENTS §5.38；`UI_SPEC §8` HD19）|`index.html`：`#empty-state` 只剩 `#empty-pick`（156 px 大方圆角 button + 上传 SVG + `empty.pick.btn` = Open file / 打开文件）与一行 `.hint`（`empty.hint`）——删路径框 `#empty-path`、「多文件」切档 `#empty-pick-multi`、「过滤」切档 `#empty-pick-filter`、pathGrantId chip 与两条选项提示行；`app-shell-docops.js`：`pickAndOpen()` 固定调 `api.pick({filter:"pdf", multi:true})`、`openByPath(path)` 改由参数给路径（空/空白 → 错误 toast）；`app-shell-chrome.js`：删 `#empty-path` 的 `keydown` Enter 接线（保留 `#empty-pick` 的 click）；`style.css`：`#empty-state` flex 列居中 + `#empty-pick` 156×156/`border-radius: 16px` + `.hint` `max-width: 560px`，删 `.msg`/`.btnrow`/`.pathrow`；`docs/ui/mockup.html` 同形镜像；`tools/verify/preview-smoke.mjs` / `overlay-smoke.mjs` / `shell-smoke.mjs` 的打开通道 = `S.openByPath(path)`（§7 驱动）。**已删 id（不再复活）**：`empty-path`、`empty-pick-multi`、`empty-pick-filter`；**存活**：`empty-pick`、`empty-state`、`drop-hint`|
|`web/static/app-i18n.js`|en/cn 文案表（由 `tools/verify/gen-i18n.mjs` 从 `docs/UI_SPEC.md §4` 生成，**141 键**（SP1 → 151、SP5 删 7 个死键 → 144、HD19 删 12 个失去控件面的键 → 132、Z5 加 9 键（cp 切档/滑杆/重试 + `sliceMode.*`）→ 141：`empty.msg`、`empty.path.placeholder`、`api.fs.pick.filePath.ctl`/`.hint`、`api.fs.pick.multi.ctl`/`.hint`、`api.fs.pick.filter.ctl`/`.hint`、`fs.pick.multi.on`、`fs.pick.filter.pdf`、`fs.pick.filter.all`、`api.fs.pick.pathGrantId.hint`；`api.fs.pick.pathGrantId.ctl` 保留 = 保存弹窗 chip 的 `t()` 标题），禁止手改；HD16 增 `app.console.btn`、V7 增 `view.zoom.hint`；`empty.hint` 文本改为「拖进来/粘贴打开 PDF、图片装载为印章」（HD19）；`ui.lang`/`ui.theme` 的 §2 行现挂 `lang.en`/`theme.light`（SP5）|
|`web/static/style.css`|壳样式（**版式单列 full-bleed**（SP5，2026-11-06）= `#app-main` 一栏 `minmax(0, 1fr)`，`grid-template-areas: "topbar" "preview"`；`#right-sidebar`/`#panel*` 与 HD3 时代的 two-col 规则全部删除，仓库内没有 380 px 面板）+ 图标按钮 tooltip / 控件表现代码 + 保存对话框外壳（`.modal .section`、`.modal .sec-title`；`#save-modal` = `top: 8vh` + `max-height: 84vh` + `overflow-y: auto`，导出设置段在 modal 内滚动）+ P1：分页条缩略图（`#page-pager canvas.pg-thumb`）、拖放高亮（`#preview[data-drag]` + `#drop-hint` 悬浮胶囊）；polish：导出段不再有 `opacity:.55` 淡化（误导状态 + 低对比，changelog 2026-11-03）；**左列出血**（HD7，2026-11-04）：`#empty-state` 无 `margin`/`border-radius`、`#preview-stage` `padding: 0`、`.page-frame` 无圆角；`.file-chip` 规则随顶栏文本一起去掉（HD5）；**HD13/HD15/HD16（2026-11-05）**：`#seal-preview` 绝对定位 overlay（左 10px、底 10px，分页条可见时 77px）、`#log-console` 底部 overlay（180px、默认 hidden）、顶栏控件组 `height: 34px`（`.btn.icon`/`.seg.sm`/`#seal-recent-select`）；**HD19（2026-11-06）空态**：`#empty-state` = flex 列居中（`flex-direction: column` + `align-items/justify-content: center` + `gap: 18px` + 文本居中，`html[data-state="empty"]` 下 `display: flex`）、`#empty-pick` 156×156 + `border-radius: 16px`（`.ic` 44 px）、`#empty-state .hint` `max-width: 560px`；`.msg`/`.btnrow`/`.pathrow` 三条规则删除|
|`web/static/favicon.svg`|图标（`<link rel="icon">`，否则 Chromium 自动 404 `/favicon.ico`，FACTS §1.5）|
|`web/static/vendor/pdfjs/`|pdf.js 6.4.299 资产（P1 已进）：`build/`（只有 ESM，FACTS §1.1）、`cmaps/`、`standard_fonts/`、`wasm/`、`image_decoders/`、`iccs/`、`web/pdf_viewer.css`（文本层 CSS）；205 文件 / 5,486,850 B，`SHA256.txt` + `web/embed_test.go:TestVendorChecksums` 断言；见该目录 `README.md`|

## 4. `tools/`

|文件|作用|
|---|---|
|`tools/genfix/main.go`|（独立模块 `go.mod`）生成 `docs/ui/fixtures/{page,seal}.png`（stdlib `image/png`，含 alpha 印章）|
|`tools/verify/ui-smoke.mjs`|mock：状态机 15 态 + i18n 全覆盖（每个 `data-i18n` 键都解析出非空 en/cn，`[data-i18n-title]` 必须有 cn 孪生）+ 0 console error + 无横向溢出 + 切分/骑缝条带 + 混合模式像素矩阵（FACTS §1.2-§1.4）+ **HD19 空态守卫**：mock 里点 `#empty-pick` = 模拟选择器返回样本路径并开文档（`empty.hint` 文案随 en/cn 切换）、deadIds 表含 `empty-path`/`empty-pick-multi`/`empty-pick-filter`|
|`tools/verify/ui-contract.mjs`|三方契约：mock `data-field` ↔ `UI_SPEC §2` ↔ AGENTS §6 请求字段（含 §6 覆盖度、契约 id 存在性（`UI_SPEC §6` 的 **56** 个 id（SP5 → 59、HD19 删 3 个 → 56）与 mock + 壳 markup 三方一致）、i18n 表（**132 键**）、§2 `i18nkey=` 必须存在于 §4（`ui.lang`/`ui.theme` 现挂 `lang.en`/`theme.light`）|
|`tools/verify/shell-smoke.mjs`|真实 `dist/autostamp.exe` + headless Chromium（沙箱 `%APPDATA%`/`%LOCALAPPDATA%`）：壳契约 12 态、en/cn i18n、窗口标题（`probe('docTitle')`）、实例、深链、`/api` 往返、`{"patch":…}` 合并；P1 起断言「未打开文档时 `#preview-stage` 没有假页」；顶栏收尾守卫：删件 id 未复活（`top-file`/`empty-upload`/`empty-open`/`file-input` 等）+ 顶栏图标几何（`#btn-open` 左缘、`#btn-save` 相邻、`#btn-shortcuts` 最右）+「顶栏无文本」计数；**SP5 守卫（2026-11-06）**：`right-sidebar`/`panel`/`panel-actions`/`save-open` 未复活 + 导出设置段（`panel-export`/`export-mode`/`export-dpi`/`estimate*`）在 `#save-modal` 内 + 单列 full-bleed 版式；**HD19 守卫（2026-11-06）**：空态形状 = `#empty-state` 只有 `#empty-pick`（按钮文本 Open file / 打开文件）+ 一行 hint，`empty-path`/`empty-pick-multi`/`empty-pick-filter` 在未复活表里；输入框样本流程改由 `S.openByPath(typedPath)` 驱动，仍断言 opened + `docTitle` + `pageCount`|
|`tools/verify/pixel-matrix.mjs`|P2/P4 像素矩阵（页内算法独立重算 vs 真实画布；filter 污染回归；`--only=` 分段）——§1.3/§1.4 的仓库内重跑来源|
|`tools/verify/overlay-smoke.mjs`|**P2 主校验**（真 exe + 真 UI + headless）：上传印章 → 16 模式 ×{1.0,0.6,0.3} → 几何/拖拽/四角/旋转/滚轮（V7：滚轮经过选中印章 = **视图 zoom 变、`apply.scale` 不变**）→ 骑缝条带 → `ctx.filter` 复位 → 去背计数 → 导出预估 == FACTS §4。分段令牌 `--only=<open\|geometry\|despill\|matrix\|drag\|strip\|filter\|export>`（缺省全跑）；`--reuse-build` 复用 `dist/autostamp-overlay-smoke.exe`（改前端后必须去掉该旗标重建）|
|`tools/verify/preview-smoke.mjs`|P1 端到端：CDP `Page.printToPDF` 现场生成样本（英文多页文字 / 中文 CID / 混合 / 图片型无文字）→ 真 exe → 真 UI 打开（打开通道 = `S.openByPath(path)` 的 §7 驱动 API，HD19；界面已无路径框）→ 画布像素、`getTextContent` 条数、`.textLayer` span 计数与层框宽度对齐、翻页/分页条/缩放、切分预览切点计数、vendor 资源 0 失败（FACTS §1.7）|
|`tools/verify/export-smoke.mjs`|**P5 主校验**（真 exe + 真 UI + headless）：保存链里的 raster 通道（apply → 前端位图 → multipart → adopt → 写盘）、页 pt == `px*72/dpi`（Δ 0.000）、导出文件字节落在 FACTS §4 的 ±40% 量级带、回读像素 Δ ≤6、vector 零 `/api/pdf/export` 请求 + 文字仍在、W6 超限只出 warn 且零请求、`pages="2"` 只送 `page-2`。分段 `--only=<raster|vector|guard|chain>`|
|`tools/verify/encfx/main.go`|现场生成 **AES-256 加密样本**（`pdfcore.WriteRaster` 一页 JPEG → `api.EncryptFile` + `model.NewAESConfiguration`），给 `pdf_password_test.go` 用（原 batch-smoke 加密行随 SP1 面板删除）；不落二进制 blob|
|`tools/verify/apply-smoke.mjs`|**P4 主校验**（真 exe + 真 UI + headless）：回读一致性矩阵（48 组：落盘 → pdf.js 重渲染 == 独立 blend，FACTS §1.9）、骑缝落盘（逐页半枚 + 条带 bbox 四边 ≤1 pt）、切分→盖章→保存链（磁盘文件再 `fs/pick`+`open`）、撤销盖章/撤销切分。分段 `--only=<matrix|strip|chain|undo>`；改前端后别用 `--reuse-build`|
|`tools/verify/cdp.mjs`|无依赖 CDP 客户端（launch Chrome → `page.*`/`Runtime.evaluate`）|
|`tools/verify/webview-launch.mjs`|`-tags webview` 二进制真窗口启动断言（FACTS §1.6）+ **P6 冷启动读数**：spawn → `webview window opened`（`window-open N ms`）与首个 `/api/health`（`health N ms`），与 P6 的 1.5 s 判据比对（超过打 error 行）；argv 可指到 `dist/autostamp-webview-stripped.exe`（出货件本身）|
|`tools/verify/comprobe/main.go`|COM `CoInitializeEx` 实测探针（含 `-window` 真窗口泵消息）|
|`tools/verify/gen-i18n.mjs`|从 `docs/UI_SPEC.md §4` 生成 `web/static/app-i18n.js`（改文案只改 §4 表，然后重跑 + 重编 exe）|

## 5. 构建与校验

|文件|作用|
|---|---|
|`build.ps1`|一键：`clean → vet → test → genfix/fixtures → 3 个 exe → verify（十脚本）→ sizes`；**P6 起 `package`（PC1）**：`autostamp-<rev>-win64.zip` = `autostamp.exe` + `README.md`，带 25 MB 体积门；`-Task`（逗号列表）/`-Watch`/`-Run`；失败退出码 1（AGENTS §4）。VCS 短号取 `go version -m` 的 `vcs.revision=`（旧正则按空白匹配，所以之前打印 `commit n/a`）|
|`build1.ps1`|单 exe 出口：webview+strip → `dist\autostamp.exe`（覆盖；运行中进程先报错）；与 build.ps1 的 stripped 同构建、输出名不同（AGENTS §4）|
|`buildm.ps1`|极限压缩出口：同 build1 构建 → `UPX --ultra-brute`（`-Fast` = `--best --lzma`；upx 缺失自动装 `tools\upx\`）→ `upx -t` + 真启动 `/api/health` 两道门槛（AGENTS §4、FACTS §4.3）|
|`docs/FACTS.md §5.1`|就地可重跑的探针清单 ↔ 本文编号映射|

## 6. 数据目录（运行期，不属于仓库）

|路径|内容|
|---|---|
|`%APPDATA%\AutoStamp\settings.json`|设置（原子写；损坏 → `.corrupt` 备份 + 重置）|
|`%APPDATA%\AutoStamp\seals\`|印章预设（P6）|
|`%LOCALAPPDATA%\AutoStamp\session\`|会话资产 + `index.json`（TTL/配额，`tmpstore`）|
|`%LOCALAPPDATA%\AutoStamp\webview2\`|WebView2 用户数据（`WEBVIEW2_USER_DATA_FOLDER`）|
|`%LOCALAPPDATA%\AutoStamp\crash\`|窗口 goroutine panic 转储|
