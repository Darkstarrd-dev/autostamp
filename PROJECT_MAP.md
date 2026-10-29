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
|`internal/api`|`register.go`|`Deps`、`NewMux`（注册静态资产 + `GET /api/health`、`GET/POST /api/settings`；未接线路由**不注册**，保留 `ServeMux` 的 405/404，FACTS §1.5）|P0（P1/P4/P5 各自加文件）|
|`internal/config`|`types.go`|`Settings`（`ui`/`overlay`/`split`/`crosspage`/`export`/`recent` 六组，字段名 = UI_SPEC 词表）|P0|
|�|`defaults.go`|`Defaults()`（与 UI_SPEC §2 默认值一致，测试断言）|P0|
|�|`sanitize.go`|枚举/范围校验 + clamp（越界修正并回报 warning；词表 = `allowedBlend`/`allowedDPI`/…）|P0|
|�|`patch.go`|`Patch`（指针字段，只合并送来的部分）|P0|
|�|`store.go`|`Store`：首启写默认、损坏文件备份 + 重置、加载时 clamp、`Apply`、`SetRecent`（去重 + 截断）|P0|
|`internal/fsx`|`atomic.go`|`AtomicWrite`/`AtomicWriteFunc`（temp + `Rename`，跨卷回退）、`ReadIfExists`、`TempName`、`EqualPath`|P0|
|�|`path.go`|路径校验（允许根白名单、符号链接解析、扩展名）|P0（P1 起用全量）|
|`internal/tmpstore`|`store.go`|会话资产库：`Add/AddFile/Get/List/Delete`（owner 绑定 + TTL 2h + 配额 256MiB/2GiB）、`index.json` 持久 + 过期清扫、`GrantPath/CheckGrant/Rename/Rights`（`pathGrantId`）|P0 骨架（P1 接 PDF 上传）|
|`internal/console`|`logger.go`|`slog` 封装（级别过滤、stderr、`-verbose`）|P0|
|`internal/pdfcore`|—|`engine/read/split/sealimg/blend/raster/validate`|**P2-P5 未创建**|

## 3. `web/`（嵌入 + 前端）

|文件|作用|
|---|---|
|`web/embed.go`|`//go:embed all:static`；`RegisterStatic`：`GET /` → `index.html`（CSP 见下）、`/vendor/*`（长缓存）、`app-*.js`/`style.css`/`favicon.svg`；遍历/未知路径 → 404；`.mjs` → `text/javascript`|
|`web/embed_test.go`|断言：嵌入文件存在、`GET /` 返回壳且**无内联 `<script>`**、CSP 指令逐条（`default-src 'self'`/`script-src 'self'`/`style-src 'self' 'unsafe-inline'`/`object-src 'none'`/`base-uri 'none'`）、`Cache-Control: no-cache`、`nosniff`、遍历拒绝、`.mjs` MIME|
|`web/static/index.html`|壳 DOM（id/`data-field`/`data-i18n` 即契约，`UI_SPEC §6`）；无内联脚本（CSP）|
|`web/static/app-shell.js`|IIFE + `window.__autoStampShell`：状态机 12 态、i18n（`data-i18n` 与 `data-i18n-placeholder` 独立生效）、密度切换（`two-col`/`single-col`/`collapsed`）、实例列表（增/删/复制/改名 + 选中）、参数控件 ↔ `settings` 持久（`{"patch":{…}}`）、`probe()`/`fields()`/`ids()` 给 verify、深链 `#<state>`、toast/modals、`/api/health` 版本校验|
|`web/static/app-api.js`|信封解析（`ok/data/code/error`）+ `http_<status>` 上报（未接线路由回 405 纯文本时不假装 JSON，FACTS §1.5）+ `GET/POST /api/settings` 客户端|
|`web/static/app-i18n.js`|en/cn 文案表（由 `tools/verify/gen-i18n.mjs` 从 mock 生成，禁止手改）|
|`web/static/style.css`|壳样式（两列密度 / 折叠态 / 控件表现代码）|
|`web/static/favicon.svg`|图标（`<link rel="icon">`，否则 Chromium 自动 404 `/favicon.ico`，FACTS §1.5）|
|`web/static/vendor/pdfjs/`|pdf.js 资产（**P1 才进**；`UI_SPEC`/AGENTS §3 预留）|

## 4. `tools/`

|文件|作用|
|---|---|
|`tools/genfix/main.go`|（独立模块 `go.mod`）生成 `docs/ui/fixtures/{page,seal}.png`（stdlib `image/png`，含 alpha 印章）|
|`tools/verify/ui-smoke.mjs`|mock：状态机 15 态 + i18n 170 键 + 0 console error + 无横向溢出 + 切分/骑缝条带 + 混合模式像素矩阵（FACTS §1.2-§1.4）|
|`tools/verify/ui-contract.mjs`|三方契约：mock `data-field` ↔ `UI_SPEC §2` ↔ AGENTS §6 请求字段（含 §6 覆盖度、id 存在性、i18n 表）|
|`tools/verify/shell-smoke.mjs`|真实 `dist/autostamp.exe` + headless Chromium（沙箱 `%APPDATA%`/`%LOCALAPPDATA%`）：壳契约 12 态、en/cn i18n、密度、实例、深链、`/api` 往返、`{"patch":…}` 合并|
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
