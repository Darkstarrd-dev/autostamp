# AGENTS.md — AutoStamp 项目指令

> Codex/Agents 在此仓库工作时自动读取本文件。本文件是**约束与事实**；阶段计划见
> [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)，依赖实测依据见
> [`docs/FACTS.md`](docs/FACTS.md)。三者不得互相矛盾；冲突时以 `docs/FACTS.md`（实测）为准。

## 0. 文档清单

|文档|作用|
|`AGENTS.md`（本文件）|技术栈、目录结构、HTTP 契约、编码规范、验证要求、禁止事项|
|`docs/IMPLEMENTATION_PLAN.md`|唯一权威的实施阶段计划（P0–P7，含每阶段验收命令）；**§0 = 新对话的执行入口（恢复协议）**|
|`docs/UI_SPEC.md`|UI 状态机、参数词表、控件↔字段绑定、**用户确认决策表**（P0.5 产出；与 §6 字段必须一致）|
|`docs/FACTS.md`|第三方库/浏览器的**实测事实**与体积数据（含复现方式），决策不得凭记忆|
|`docs/changelog/<doc 同名>.md`|各文档的变更叙述历史（最新在上）；正文只留当前态事实|
|`PROJECT_MAP.md`|代码地图（P0 起创建并维护；新增/删除包必须同步）|

## 1. 项目概述

AutoStamp 是把 PDF 印章工具做成**独立桌面 App**：Go 单二进制 + WebView2 窗口 + 内嵌
原生 JS 前端，纯本地运行（监听 127.0.0.1，无对外鉴权、无云上传、无数据库）。

功能范围（对应产品需求 1–5）：

1. 读取并显示文本型 / 图片型 / 混合型 PDF（页面渲染 + 文本层 + 缩略图）。
2. 在显示的 PDF 上叠加指定印章图片（带透明通道），可预览并调尺寸、位置、明度、饱和度。
3. 自动切分（2 拼 1 扫描页 → 单页）并给多页 PDF 加**骑缝章**，可预览、可设起始位置。
4. 印章叠加的混合模式（normal / multiply / color-dodge / … 常用 16 种）与透明度百分比。
5. 保存修改后的 PDF，可设置图片分辨率（DPI）与 JPEG 质量等参数。

产品定位与 TinyRouter/TinyLab 独立，**不共享代码、不引用其模块**；可复用其模式：
原子写（临时文件 + rename）、外部工具解析器（配置路径→环境变量→PATH）、
`pathgrant` 式本地路径授权、headless 数值化验证方法。

## 2. 技术栈（固定，不轻易扩依赖）

- **语言:** Go 1.26（本机 go1.26.5，CGO 不需要）。
- **HTTP:** 标准库 `net/http` + Go 1.22+ `ServeMux` 方法路由（`GET /path`）；
  静态资产用 `http.FileServerFS` / `http.ServeFileFS`，上传限制用 `http.MaxBytesHandler`。
  不引入 chi/echo（独立小 App，路由只有十余条）。
- **窗口:** `github.com/jchv/go-webview2`（纯 Go，无 CGO），Windows WebView2；
  非 Windows/无 WebView2 运行时 → 回退到打开系统浏览器（`internal/app/browser.go`）。
  Windows 下 WebView2 需 `CoInitializeEx` + `runtime.LockOSThread`（照搬 TinyRouter
  `host_webview_window.go:122-160` 的线程/COM 处理顺序，勿自行改动 defer 次序）。
- **PDF 读写:** `github.com/pdfcpu/pdfcpu v0.16.3`（Apache-2.0，纯 Go）仅用于
  **解析/校验/切分(Cut)/合并(Merge)/印章落盘**；PDF 渲染、文本抽取一律在**前端** pdf.js。
- **自写层:** `internal/pdfcore/blend.go`（ExtGState `/BM` + `/ca` `/CA` 注入）与
  `internal/pdfcore/raster.go`（stdlib 写 PDF：`compress/zlib` FlateDecode / `image/jpeg`
  DCTDecode）。stdlib + 已在 `go.mod` 的 `golang.org/x/image/draw`（缩放）足够。
- **前端:** 原生 HTML + vanilla JS + CSS，`//go:embed` 内嵌；第三方库以 vendor 目录提交
  （带 `LICENSE`/`README`/`SHA256`），**不使用 npm/打包器/前端框架**。
- **第三方前端:** `pdfjs-dist@6.4.299`（Apache-2.0，仅 ESM `.mjs`）。

## 3. 目录结构（P0 建立，之后按 `PROJECT_MAP.md` 维护）

```
AutoStamp/
  main.go                      入口：端口选择→server→窗口/浏览器
  host_webview_windows.go      //go:build windows  WebView2 窗口
  host_console.go              //go:build !windows 或无 webview tag：仅控制台 + 打开浏览器
  web/embed.go                 //go:embed all:static
  web/static/
    index.html app-*.js style.css
    vendor/pdfjs/build/{pdf.min.mjs,pdf.worker.min.mjs}
    vendor/pdfjs/{cmaps,wasm,image_decoders,standard_fonts}/   见 FACTS §3 体积
  internal/
    config/       types.go defaults.go persistence.go     settings.json 读写
    tmpstore/     store.go                               会话资产(TTL/配额/owner)
    pdfcore/      engine.go read.go split.go sealimg.go blend.go raster.go validate.go
    api/          register.go pdf.go seal.go export.go settings.go
    app/          server.go browser.go port.go
    console/      logger.go
  tools/verify/               headless Chromium 数值验证脚本（node，无依赖）
  tools/genfix/main.go        生成 mock fixtures 的 stdlib 探针（P0.5）
  build.ps1               自动编译/校验入口（任务见 §4；UTF-8 BOM 必需，PS 5.1 兼容）
  docs/  docs/UI_SPEC.md  PROJECT_MAP.md  README.md
  docs/ui/mockup.html       可交互 UI mock（P0.5 设计产物：不进 embed、不进 exe）
  docs/ui/fixtures/         mock 用的假数据（由 tools/genfix 生成，含 alpha 印章 PNG）
```

## 4. 构建与运行

```powershell
go build -o dist/autostamp.exe .                 # 控制台 + 自动打开浏览器
go build -tags webview -o dist/autostamp-webview.exe .
go vet ./... ; go test ./...
# 发布：strip 版本
go build -tags webview -trimpath -ldflags "-s -w" -o dist/autostamp-webview-stripped.exe .
```

**一键脚本 `build.ps1`（推荐；PowerShell 5.1+，文件必须是 UTF-8 **带 BOM**，否则 5.1 按 GBK 解析）**：

```powershell
powershell -NoProfile -File build.ps1                 # clean+vet+test+genfix+3 个 exe+verify+sizes
powershell -NoProfile -File build.ps1 -Task verify     # 只跑 UI 契约/冒烟校验
powershell -NoProfile -File build.ps1 -Task genfix,fixtures   # 只刷新 docs/ui/fixtures 素材
powershell -NoProfile -File build.ps1 -Task webview -Run      # 编窗口版并直接启动
powershell -NoProfile -File build.ps1 -Watch                  # 保存即重编 + 重跑校验（Ctrl+C 退出）
```

- 任一任务失败 -> 退出码 1（汇总行「失败 N / 跳过 M」）；根目录还没有 `go.mod`/`*.go` 时
  Go 任务打 `[skip]` 不算失败（P0 之前不会假绿，也不会报错）。
- 版本用 Go 自动 VCS 注入（`debug.ReadBuildInfo` 的 `vcs.revision`），脚本用 `go version -m`
  顺带打印 commit 短号；**不得**手写 `-X main.xxx` 形式 ldflags。
- `-Watch` 观察 `*.go|mod|sum|mjs|js|html|css|ps1`（跳过 `.git`/`dist`/`tmp`），改动后自动跑
  `vet -> test -> genfix -> console -> webview -> verify`；`-Once` 表示只跑一轮（CI 冒烟用）。
- 上面手敲的 `go build` 命令仍有效，两者等价：脚本只是把本节命令固化 + 加校验/体积输出。

- 首次运行在 `%APPDATA%\AutoStamp\` 生成 `settings.json`（印章默认值、切分默认值、
  导出默认 DPI/质量）+ `seals/`（印章预设）；临时会话资产在
  `%LOCALAPPDATA%\AutoStamp\session\`（TTL 2h，单文件上限 256 MiB，总量上限 2 GiB）。
- 一律原子写：同目录 `.tmp-<rand>` + `os.Rename`（跨卷失败则显式拷贝回退）。

## 5. 关键设计决策（含实测数据，勿凭记忆推翻）

1. **前端渲染 PDF。** 印章预览必须由 canvas 合成（叠加层要实时调 brightness/saturate/
   透明度/混合模式）。浏览器内置 PDF 查看器（PDFium/iframe）无法叠加，故用 pdf.js
   渲染页面到 canvas。实测 pdf.js 6.4.299 在本项目路径下渲染 + `getTextContent` 正常。
2. **预览与落盘的混合模式语义一致。** 实测：canvas `globalCompositeOperation=multiply`
   得 (170,22,28)；同参数写进 PDF 的 `ExtGState /BM /Multiply` + `/ca /CA 0.6`，
   经 pdf.js 渲染采样得 (189,106,119)，与手算 `dst*0.4 + (dst*src/255)*0.6` 一致。
   即所见即所得，无色彩管理偏移（FACTS §1.3）。
3. **pdfcpu 不写 `/BM`，只写 `CA/ca`。** 全模块 grep：`/BM` 仅出现在
   `validate/extGState.go:1142` 的白名单。所以混合模式必须由 `internal/pdfcore/blend.go`
   注入 ExtGState 字典（pdfcpu 已把印章包成 Form XObject `Fm0` 并注册
   `Resources/ExtGState/GS0`，注入即在 GS 字典加 `/BM /Name`）。白名单即 PDF 表 136：
   Normal/Multiply/Mult/Screen/Overlay/Darken/Lighten/ColorDodge/ColorBurn/HardLight/
   SoftLight/Difference/Exclusion/Hue/Saturation/Color/Luminosity。
4. **pdfcpu 无 rasterize、无文本抽取 API**（`api/extract.go` 只有
   Images/Fonts/Pages/Content/Metadata）。因此「页面转位图」只在前端做（`getViewport({scale})`），
   「文字内容」抽取也只在前端做（`getTextContent`）；服务端不提供 OCR。
5. **pdfcpu 代价与取舍。** 实测 `pkg/api` 全量引入：strip 后 1.20MB → 12.25MB，
   **净 +11.06MB**；pdf.js 资产最小集（core 2.06MB + cmaps 1.14MB）≈ 2.8MB，
   全量 ≈ 5.98MB。二进制预计 ~20MB。这是允许的代价（需要 PDF reader/writer 的鲁棒性），
   但要记进 `docs/FACTS.md`，且**不得**为省体积自写 PDF parser。
   注：本项目**不采用**外部二进制（mutool/Ghostscript 为 AGPL；qpdf 无用）——保持单二进制交付。
6. **切分用 `api.Cut` 且切点是相对分数**：`model.Cut{Vert: []float64{0.5}}` 实测
   595×842 → 两张 297.5×842（`Hor` 为上下切）。坑：outDir **必须预先存在**；
   每个输出 PDF 含「原页 + 两块」（实测 pages=3），落库前必须 `Trim`/`ExtractPages` 丢弃原页。
7. **骑缝章 = 切分 + 逐页条带。** 印章图先由 `internal/pdfcore/sealimg.go`（stdlib 切片）
   切成 N 条，第 i 页放第 i 条（`position:r` 装订边锚点 + `offset:0 -startOffset`
   为用户可调「起始位置」），再 `MergeCreateFile` 合并；实测产物过 `ValidateFile`。
8. **透明度精确落盘。** pdfcpu `opacity:` → `<</CA 0.6 /Type/ExtGState /ca 0.6>>`
   （实测直读对象文本），透明 PNG 自动生成 `/SMask`（`model/image.go:161`），
   不透明图不生成 SMask。像素复核：不透明印章中心 (120,36,120) 与规格算法一致。
9. **保存不走 PDF 注释。** pdf.js 有 Stamp 注释编辑器与 `saveDocument()`，但输出的是可被
   删除/裁剪的注释、且无 `/BM`，不符合骑缝章语义；一律走后端 page-content 写入。
10. **两条导出路径**：`vector`（保留文字/矢量，默认）与 `raster`（整页位图，
    抗篡改/便于图片型扫描件）。raster 用 stdlib 写 `/DCTDecode`，实测体积表：
    72dpi q40/75/92 = 35.6/43.7/57.3 KB；150dpi = 104/124/156 KB；300dpi = 329/379/459 KB（A4 单页）。
11. **本地安全边界。** 只监听 `127.0.0.1:0`（随机端口）；校验 `Host`/`Origin`
    （防 DNS-rebinding）；上传走 `MaxBytesHandler`；pdfcpu `MaxImageBytes`/`MaxImagePixels`
    显式设限（默认 512MB/100MP 太大）。无鉴权（本机工具），但不得暴露非 loop 接口。

## 6. HTTP 契约（`/api/*`，全部 JSON；字段在 **P0.5 与用户确认后**才冻结，改动必须同步本文、`docs/UI_SPEC.md` 与前端）

|路由|用途|
|---|---|
|`GET /api/health`|健康检查 + 版本号|
|`POST /api/fs/pick`|原生文件/目录选择器，返回 `pathGrantId`（owner 绑定，TTL）|
|`POST /api/pdf/open`|按 `pathGrantId` 或 multipart 上传打开 PDF → `assetId` + 页元数据（页数、每页 pt 尺寸、rotation、是否含文字）|
|`GET /api/pdf/raw?id=`|原始 PDF 字节（支持 Range/ETag），供 pdf.js 直接取|
|`POST /api/pdf/split`|`{auto|rows/cols|cutFractions}` → 新 `assetId` + 切分后页信息|
|`POST /api/pdf/seal/prepare`|上传印章 PNG/生成 → `sealId` + alpha 元数据（可去背/裁剪/重采样）|
|`POST /api/pdf/apply`|矢量路径落盘：`{assetId, sealId, blend, opacity, scale, pos, offset, rotation, pages, crossPage}` → 新 `assetId`|
|`POST /api/pdf/export`|光栅路径：`{assetId, dpi, quality, mode}` → 新 `assetId`（页位图由前端回传）|
|`POST /api/pdf/save`|`{assetId, targetPath|pathGrantId, replaceOriginal}` → 原子写盘|
|`GET/POST /api/settings`|读写 `settings.json`（指针字段按需合并）|
|`GET /api/seal/preset` 等|印章预设 list/save/delete|

## 7. 编码规范

- `gofmt`/`goimports`；导出函数须有文档注释。
- 错误显式处理，不用 panic（例外：`init` 期契约校验、`internal/feature` 式 manifest 检查）。
- 共享状态 `sync.RWMutex`；并发写盘一律 temp+rename。
- 日志用 `internal/console`（`log/slog` 封装），不直接用 `log` 标准库（`main.go` 启动失败回退 `log.Fatalf` 可以）。
- 前端：无全局变量污染，模块用 IIFE + `window.__autoStamp*` 命名空间；字符串一律 `escapeHtml`；
  i18n 双语文本集中在 `web/static/app-i18n.js`（en+cn），不得散落在 JSX/HTML。
- 测试：`internal/pdfcore` 必须有单测（切分几何、条带切片、blend 注入、raster writer 字节结构）；
  前端契约测试用 `web/*.test.js`（node，无框架），照 TinyRouter 惯例。

## 8. 验证要求（每阶段必须执行，不接受主观截图）

- **数值化验证**（`tools/verify/`，headless Chromium，本机 Chrome 151 与 WebView2 同族）：
  1. 采样印章区域像素并与手算公式比对（参考值见 FACTS §1.3）；
  2. 切分后页尺寸断言（A4 → 297.5×842）；
  3. 骑缝章：两页印章 bbox/像素连续性断言；
  4. 落盘后回读：把保存的 PDF 再喂给 pdf.js 渲染采样，必须与预览像素一致；
  5. `ctx.filter` 是上下文状态，每次叠加前后必须 `save()/restore()` 且显式 `filter='none'`，
     否则残留 filter 污染下一层（该污染已在 FACTS §1.4 实测复现）。
  6. UI 契约三方校验（P0.5 起常驻）：`node tools/verify/ui-smoke.mjs`（0 error、
     无横向溢出、每个控件有 en/cn i18n key）+ `node tools/verify/ui-contract.mjs`
     （`docs/ui/mockup.html` 的 `data-field` ↔ `UI_SPEC` 字段表 ↔ 本文 §6 请求字段）。
- `go test ./...` 全绿；`go vet ./...` 无输出。
- UI 阶段用真实窗口（WebView2）+ headless 各跑一次，console 必须 0 error。
- **UI 语义门槛：**任何 UI 语义/字段改动必须能在 `UI_SPEC` 决策表找到用户确认记录
  （选项 + 日期）；无记录即视为未确认，按 P0.5 交互协议先问用户，**禁止虚构确认**。

## 9. 不要做的事

- 不引入数据库、前端框架、npm/打包器、云上传/遥测、任何对外鉴权体系。
- 不引入外部 PDF 二进制（mutool/Ghostscript/qpdf/ImageMagick）——依赖代价见 FACTS。
- 不用 pdf.js 的注释保存通道做印章（见 §5.9）。
- 不做 OCR/文字改写/表单编辑/加密破解/PDF 合并编辑器等无关能力（OCR 若将来需要，
  走可插拔外部模型，且默认关闭）。
- 不交付占位实现：任何 `TODO: implement`、返回假数据、no-op 存根一律视为未完成。
  `docs/ui/mockup.html` 是设计产物（假数据驱动），**不得**复制进 `web/static/` 当实现。
- 不修改 `C:/opencode/tinyrouter` 仓库来支持本项目（模式可复制，代码不共享）。

## 10. 文档同步（强制）

每轮代码变更后在同一次提交里更新：

1. 新增/删除/改名任何 `*.go` 包或 `web/static` 资产 → 更新 `PROJECT_MAP.md`；
2. 触及某文档覆盖的模块 → 替换该文档顶部**单行**「最后核对」摘要（禁止堆叠），
   变更过程叙述追加 `docs/changelog/<同名>.md` 顶部（最新在上）；
3. 依赖版本/体积/实测结论变化 → 同步 `docs/FACTS.md`，并注明复现方式；
4. 阶段完成 → 在 `docs/IMPLEMENTATION_PLAN.md` 勾选状态 + 写实测数据。

代码与文档不得脱节。

## 11. 高频变更速查

|任务|先读|涉及文件|
|---|---|---|
|改切分/骑缝几何|`docs/FACTS.md` §2.3|`internal/pdfcore/split.go`、`sealimg.go`、`web/static/app-crosspage.js`|
|改混合模式/透明度|`docs/FACTS.md` §1.2/§1.3/§2.2|`internal/pdfcore/blend.go`、`web/static/app-overlay.js`|
|改导出 DPI/质量|`docs/FACTS.md` §4|`internal/pdfcore/raster.go`、`internal/api/export.go`|
|改预览渲染|`docs/FACTS.md` §1|`web/static/app-preview.js`、`web/static/vendor/pdfjs/`|
|新增路由|本文件 §6|`internal/api/register.go`、`web/static/app-api.js`|
|窗口/端口/浏览器回退|本文件 §5|`host_webview_windows.go`、`internal/app/`|
|改 UI 契约 / 参数词表|`docs/UI_SPEC.md` + 本文件 §6 + `IMPLEMENTATION_PLAN.md` P0.5|`docs/ui/mockup.html`、`web/static/app-panel.js`、`web/static/app-overlay.js`、`internal/api/{pdf,seal,export}.go`|
|改编译/测试流程|本文件 §4|`build.ps1`（任务分派 `Start-Dispatch`）、`tools/verify/*`|
