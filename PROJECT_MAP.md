# PROJECT_MAP.md — AutoStamp 代码地图

> 最后核对：2026-10-29（P0 骨架 + P0.5 UI 契约完成）。新增/删除包必须同步本文件
> （AGENTS §10.1）。阶段状态见 `docs/IMPLEMENTATION_PLAN.md §10`。

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
|`internal/api`|`register.go`|`Deps`、`NewMux`（注册静态资产 + `GET /api/health`、`GET/POST /api/settings`、P1 的 `POST /api/fs/pick`、`POST /api/pdf/open`、`GET /api/pdf/raw`；未接线的后续路由**不注册**，保留 `ServeMux` 的 405/404，FACTS §1.5）|P0+P1|
|（续）|`pdf.go`|P1 本地文件通道：`handlePick`（原生选择器 + `filePath` 直开授权）、`handleOpen`（grant/multipart 两形态 + 密码两错误码 + `SetRecent`）、`handleRaw`（`http.ServeContent` 的 Range/ETag + owner 绑定 404）、`pdfcore` 密码错误映射|P1|
|`internal/config`|`types.go`|`Settings`（`ui`/`overlay`/`split`/`crosspage`/`export`/`recent` 六组，字段名 = UI_SPEC 词表）|P0|
|�|`defaults.go`|`Defaults()`（与 UI_SPEC §2 默认值一致，测试断言）|P0|
|�|`sanitize.go`|枚举/范围校验 + clamp（越界修正并回报 warning；词表 = `allowedBlend`/`allowedDPI`/…）|P0|
|�|`patch.go`|`Patch`（指针字段，只合并送来的部分）|P0|
|�|`store.go`|`Store`：首启写默认、损坏文件备份 + 重置、加载时 clamp、`Apply`、`SetRecent`（去重 + 截断）|P0|
|`internal/fsx`|`atomic.go`|`AtomicWrite`/`AtomicWriteFunc`（temp + `Rename`，跨卷回退）、`ReadIfExists`、`TempName`、`EqualPath`|P0|
|（续）|`path.go`|路径校验（允许根白名单、符号链接解析、扩展名）|P0（P1 起用全量）|
|（续）|`pick.go` / `pick_windows.go` / `pick_script.go` / `pick_other.go`|原生文件选择器：`PickFiles(ctx, PickOptions)` → PowerShell `Forms·FileDialog`（`-STA`、UTF-8 输出、`Cancel` 退出码 3 → `ErrPickCancelled`；`filter pdf|all`、`multi`、`startDir`），非 Windows → `ErrPickUnsupported`（501 `pick_unsupported`）|P1|
|（续）|`pick_test.go` / `pick_windows_test.go`|脚本词表/旗标映射（`TestPickDialogFlags`、`TestPickDialogFilterVocabulary`）、`-STA` 必需、取消退出码、`parsePickScript` 解析|P1|
|`internal/tmpstore`|`store.go`|会话资产库：`Add/AddFile/Get/List/Delete`（owner 绑定 + TTL 2h + 配额 256MiB/2GiB）、`index.json` 持久 + 过期清扫、`GrantPath/CheckGrant/Rename/Rights`（`pathGrantId`）、`ErrNotFound`/`ErrOwner`|P1（open/raw 已接线）|
|`internal/console`|`logger.go`|`slog` 封装（级别过滤、stderr、`-verbose`）|P0|
|`internal/webx`|`json.go`|`Envelope{ok,data,code,error}` + `OK/Created/Fail` + `DecodeJSON`（`http.MaxBytesReader`）|P0|
|（续）|`session.go`|`SessionHeader = X-AutoStamp-Session`：前端 `crypto.getRandomValues` 生成的 128-bit 令牌 = 资产/grant 的 owner 能力；`SessionOf` 校验格式（缺失 → 400 `bad_session`）、`NewToken` 服务端测试用|P0（P1 全线使用）|
|`internal/pdfcore`|`read.go`|`Inspect(ctx, r, conf)`：页数、每页 MediaBox pt 尺寸/rotation/`hasFonts`/`hasXObject`、加密探测（`ErrNeedsPassword`/`ErrBadPassword` 再导出 pdfcpu 信号，`DefaultLimits` 显式限流）|P1|
|(续)|`sealimg.go`|印章图通道：`Prepare`(去白底 despill → alpha 包围盒裁剪 `AlphaRect` → `ResampleDPI` 重采样，词表 `alphaTrim/despill/resampleDpi/targetDpi/maxSide`，扩展名按实际内容写)、`SealMeta`(src*/out*/alphaBBox/opaqueRatio 按**源图**计)、`SplitSealImage`+`SplitImage`(骑缝条带几何：奇偶两半 / 外缘 n 条)、`applyCrossPageStrips`+`place`(锚点词表 `pos/anchor/offset`，FACTS §2.3)|P2-P3|
|(续)|`split.go`|自动切分：词表 `SplitAuto/SplitRowsCols/SplitCustom/SplitUnsplit` + `SplitSpec{Mode,Rows,Cols,CustomCuts,Veto}`；`CutPlanForPage`(display 空间,**不按 /Rotate 交换轴**，FACTS §2.3)、`SplitOnePage`(剔掉 pdfcpu 附带的原页)、`MergeCreateFile` 合并回一个 PDF；`TestSplit*` 断言 A4→297.5x842 与旋转页 421x595|P3|
|(续)|`read_test.go` / `sealimg_test.go` / `split_test.go`|结构摘要、去背/裁剪/重采样字节、条带与锚点几何、切分词表与页尺寸|P1-P3|

## 3. `web/`（嵌入 + 前端）

|文件|作用|
|---|---|
|`web/embed.go`|`//go:embed all:static`；`RegisterStatic`：`GET /` → `index.html`（CSP 见下）、`/vendor/*`（长缓存）、`app-*.js`/`style.css`/`favicon.svg`；遍历/未知路径 → 404；`.mjs` → `text/javascript`|
|`web/embed_test.go`|断言：嵌入文件存在、`GET /` 返回壳且**无内联 `<script>`**、CSP 指令逐条（`default-src 'self'`/`script-src 'self'`/`style-src 'self' 'unsafe-inline'`/`object-src 'none'`/`base-uri 'none'`）、`Cache-Control: no-cache`、`nosniff`、遍历拒绝、`.mjs` MIME|
|`web/static/index.html`|壳 DOM（id/`data-field`/`data-i18n` 即契约，`UI_SPEC §6`）；无内联脚本（CSP）。`#preview-stage` **刻意留空**：`app-preview.js` 渲染首个 `page-frame`（canvas + `.textLayer`）后才有内容，P2 在其内加实例叠层；`#asset-hooks` / `pathGrantId` 的 chip 只显示句柄值，本地化文案走 `title`|
|`web/static/app-shell.js`|IIFE + `window.__autoStampShell`：状态机 12 态、i18n（`data-i18n` 与 `data-i18n-placeholder` 独立生效）、密度切换（`two-col`/`single-col`/`collapsed`）、实例列表（增/删/复制/改名 + 选中）、参数控件 ↔ `settings` 持久（`{"patch":{…}}`）、P1 打开流程（`pickAndOpen`/`openByPath`/`handleFiles`/`openGrant`/`retryOpen`/`adopt` + 密码弹窗 + `SetRecent` 读回 + 拖放）、`probe()`/`fields()`/`ids()` 给 verify、深链 `#<state>`、toast/modals、`/api/health` 版本校验、`autostamp:lang`/`autostamp:open`/`autostamp:page` 事件（跨模块同步）|
|`web/static/app-api.js`|信封解析（`ok/data/code/error`）+ `http_<status>` 上报（未接线路由回 405 纯文本时不假装 JSON，FACTS §1.5）+ `GET/POST /api/settings` + P1 的 `pick/openGrant/uploadPDF/rawURL` 与 sessionStorage 会话令牌（`X-AutoStamp-Session`）|
|`web/static/app-preview.js`|P1 渲染核：`import()` 载入 vendor `pdf.min.mjs`（`workerSrc`/`cMapUrl`/`standardFontDataUrl`/`wasmUrl` 指向 vendor 路径，`isEvalSupported:false` 保持 CSP 无 `unsafe-eval`）、`getDocument({url: rawURL})` 逐页 `render`（DPR 经 `RenderParameters.transform`，`MAX_RENDER_PIXELS` 超限降级 + `warn.render.hint`）、`goTo/next/prev/zoomBy/fit`、标尺与像素读数、`sample(x,y,w,h)` 按 PDF 点取样 + `probe()` 供 verify（FACTS §1.7）|
|`web/static/app-textlayer.js`|pdf.js 自带 `TextLayer` 驱动（6.4 无 `renderTextContent` 导出，官方 `TextLayerBuilder` 在未 vendor 的 `web/pdf_viewer.mjs`）：`attach({pdfjs,pageObj,viewport,frame,dpr})` 设 `--total-scale-factor = viewport.scale × OutputScale.pixelRatio` + `--scale-round-x/y` + `transform: scale(1/dpr)`，CSS 用 vendor 的 `.textLayer` 规则；`count(pageObj)` 给验收断言|
|`web/static/app-pager.js`|`#page-pager` 分页条（2026-10-29 P0.5 协议确认：chip + chip 内缩略图，无新增 id）：计数 chip（`pager.count` 走 `title`/`aria-label`）+ 每页一枚 `button.chip[data-page]`（`.pg-no` + `canvas.pg-thumb`，`IntersectionObserver` 懒渲染、重建时 `task.cancel()`）、`All` chip 写 `apply.pages`/`export.pages`|
|`web/static/app-i18n.js`|en/cn 文案表（由 `tools/verify/gen-i18n.mjs` 从 mock 生成，禁止手改）|
|`web/static/style.css`|壳样式（两列密度 / 折叠态 / 控件表现代码）+ P1：分页条缩略图（`#page-pager canvas.pg-thumb`）、拖放高亮（`#preview[data-drag]`）|
|`web/static/favicon.svg`|图标（`<link rel="icon">`，否则 Chromium 自动 404 `/favicon.ico`，FACTS §1.5）|
|`web/static/vendor/pdfjs/`|pdf.js 6.4.299 资产（P1 已进）：`build/`（只有 ESM，FACTS §1.1）、`cmaps/`、`standard_fonts/`、`wasm/`、`image_decoders/`、`iccs/`、`web/pdf_viewer.css`（文本层 CSS）；205 文件 / 5,486,850 B，`SHA256.txt` + `web/embed_test.go:TestVendorChecksums` 断言；见该目录 `README.md`|

## 4. `tools/`

|文件|作用|
|---|---|
|`tools/genfix/main.go`|（独立模块 `go.mod`）生成 `docs/ui/fixtures/{page,seal}.png`（stdlib `image/png`，含 alpha 印章）|
|`tools/verify/ui-smoke.mjs`|mock：状态机 15 态 + i18n 170 键 + 0 console error + 无横向溢出 + 切分/骑缝条带 + 混合模式像素矩阵（FACTS §1.2-§1.4）|
|`tools/verify/ui-contract.mjs`|三方契约：mock `data-field` ↔ `UI_SPEC §2` ↔ AGENTS §6 请求字段（含 §6 覆盖度、id 存在性、i18n 表）|
|`tools/verify/shell-smoke.mjs`|真实 `dist/autostamp.exe` + headless Chromium（沙箱 `%APPDATA%`/`%LOCALAPPDATA%`）：壳契约 12 态、en/cn i18n、密度、实例、深链、`/api` 往返、`{"patch":…}` 合并；P1 起断言「未打开文档时 `#preview-stage` 没有假页」|
|`tools/verify/preview-smoke.mjs`|P1 端到端：CDP `Page.printToPDF` 现场生成样本（英文多页文字 / 中文 CID / 混合 / 图片型无文字）→ 真 exe → 真 UI 打开（`#empty-path` + `#empty-open`）→ 画布像素、`getTextContent` 条数、`.textLayer` span 计数与层框宽度对齐、翻页/分页条/缩放、vendor 资源 0 失败（FACTS §1.7）|
|`tools/verify/cdp.mjs`|无依赖 CDP 客户端（launch Chrome → `page.*`/`Runtime.evaluate`）|
|`tools/verify/webview-launch.mjs`|`-tags webview` 二进制真窗口启动断言（FACTS §1.6）|
|`tools/verify/comprobe/main.go`|COM `CoInitializeEx` 实测探针（含 `-window` 真窗口泵消息）|
|`tools/verify/gen-i18n.mjs`|从 `docs/ui/mockup.html` 生成 `web/static/app-i18n.js`|

## 5. 构建与校验

|文件|作用|
|---|---|
|`build.ps1`|一键：`clean → vet → test → genfix/fixtures → 3 个 exe → verify（ui-smoke/ui-contract/shell-smoke）→ sizes`；`-Task`、`-Watch`、`-Run`；失败退出码 1（AGENTS §4）|
|`docs/FACTS.md §5.1`|就地可重跑的探针清单 ↔ 本文编号映射|

## 6. 数据目录（运行期，不属于仓库）

|路径|内容|
|---|---|
|`%APPDATA%\AutoStamp\settings.json`|设置（原子写；损坏 → `.corrupt` 备份 + 重置）|
|`%APPDATA%\AutoStamp\seals\`|印章预设（P6）|
|`%LOCALAPPDATA%\AutoStamp\session\`|会话资产 + `index.json`（TTL/配额，`tmpstore`）|
|`%LOCALAPPDATA%\AutoStamp\webview2\`|WebView2 用户数据（`WEBVIEW2_USER_DATA_FOLDER`）|
|`%LOCALAPPDATA%\AutoStamp\crash\`|窗口 goroutine panic 转储|
