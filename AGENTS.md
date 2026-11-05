# AGENTS.md — AutoStamp 项目指令

> Codex/Agents 在此仓库工作时自动读取本文件。本文件是**约束与事实**；阶段计划见
> [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)，依赖实测依据见
> [`docs/FACTS.md`](docs/FACTS.md)。三者不得互相矛盾；冲突时以 `docs/FACTS.md`（实测）为准。

## 0. 文档清单

|文档|作用|
|`AGENTS.md`（本文件）|技术栈、目录结构、HTTP 契约、编码规范、验证要求、禁止事项|
|`docs/IMPLEMENTATION_PLAN.md`|唯一权威的实施阶段计划（P0–P7，含每阶段验收命令；**P0–P7 已于 2026-11-03 收官**）；**§0 = 新对话的执行入口（恢复协议）；§10.1 = 当前工作模式：人工端到端验收 + 细节调整 + 功能细化**（验收/细化项逐行登记，流程与门槛在该节）|
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
    index.html  app-shell.js  app-api.js  app-preview.js  app-seal.js  app-overlay.js  app-textlayer.js  app-pager.js  app-i18n.js  style.css  favicon.svg
    vendor/pdfjs/build/{pdf.min.mjs,pdf.worker.min.mjs}      (P1 起)
    vendor/pdfjs/{cmaps,wasm,image_decoders,standard_fonts,iccs}/  见 FACTS §3 体积 (P1 起)
    vendor/pdfjs/web/pdf_viewer.css                          (P1 起：文本层 CSS，README 记录裁剪)
  internal/
    config/       types.go defaults.go patch.go sanitize.go store.go   settings.json 读写
    tmpstore/     store.go                               会话资产(TTL/配额/owner)
    fsx/          atomic.go path.go pick*.go             原子写 + 路径校验 + 原生选择器(P1)
    pdfcore/      read.go (P1)  engine/split/sealimg/blend/raster/validate (P2-P5)
    api/          register.go  pdf.go (P1: fs/pick, pdf/open, pdf/raw)  settings.go  seal.go/export.go (P4/P5)
    app/          server.go middleware.go net.go browser.go version.go  中间链/端口/版本
    webx/         json.go session.go                     envelope + DecodeJSON + 会话令牌(X-AutoStamp-Session)
    console/      logger.go
  tools/verify/               headless 数值验证脚本 + cdp.mjs + comprobe（见 FACTS §5.1）
  tools/genfix/               生成 mock fixtures 的 stdlib 探针（P0.5）
  build.ps1                   自动编译/校验入口（任务见 §4；UTF-8 BOM 必需，PS 5.1 兼容）
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
powershell -NoProfile -File build.ps1 -Task stripped,package  # 出货件 + win64 zip（PC1）
powershell -NoProfile -File build1.ps1              # 单 exe 出口：webview+strip -> dist\autostamp.exe（覆盖）
powershell -NoProfile -File buildm.ps1              # 极限压缩：同 build1 构建后 UPX 重打包（覆盖）
```

- 任一任务失败 -> 退出码 1（汇总行「失败 N / 跳过 M」）；根目录还没有 `go.mod`/`*.go` 时
  Go 任务打 `[skip]` 不算失败（P0 之前不会假绿，也不会报错）。
- 版本用 Go 自动 VCS 注入（`debug.ReadBuildInfo` 的 `vcs.revision`），脚本用 `go version -m`
  顺带打印 commit 短号；**不得**手写 `-X main.xxx` 形式 ldflags。
  `internal/app.pickVersion` 只认真实标签：未打标签时 Go 的伪版本（`v0.0.0-<日期>-<hash>+dirty`）
  不进 UI，显示的就是 `devVersion`（当前 `0.1-dev`）——原生窗口标题栏 / 浏览器标签页（`document.title`）/
  `/api/health` 三处同源（UI_SPEC §8 HD2 + HD4 + HD5：`#top-file` 已删，见 §5.24）。
- `-Watch` 观察 `*.go|mod|sum|mjs|js|html|css|ps1`（跳过 `.git`/`dist`/`tmp`），改动后自动跑
  `vet -> test -> genfix -> console -> webview -> verify`；`-Once` 表示只跑一轮（CI 冒烟用）。

- `dist\genfix.exe` 是**命令行**素材生成器（无 GUI，打印 3 行即退出）。在资源管理器里双击它会出现
  「cmd 窗口一闪即退」，那是正常收尾，不是崩溃。它自己从 exe 所在目录向上定位仓库根
  （判定 `AGENTS.md` + `docs/`），因此不会把 PNG 写进 `dist\`；定位失败则报错退出。
  `build.ps1 -Task fixtures` 会显式把目标目录作为参数传给它。
- `-Task` 支持逗号列表（`-Task genfix,fixtures`）；未知任务名报错并以退出码 1 结束（列出可选任务）。
- `-Run` 是开关（等价于在任务列表末尾追加 `run`）；`dist` 里没有 `autostamp*.exe` 时只打提示，
  说明 P0 未开工、当前只有 `genfix.exe` 这类 CLI 产物。
- 上面手敲的 `go build` 命令仍有效，两者等价：脚本只是把本节命令固化 + 加校验/体积输出。
- `build1.ps1` / `buildm.ps1`（2026-11-03 新增的单 exe 出口，用户决定同名 `autostamp.exe`）：产物固定写
  `dist\autostamp.exe`（已存在则覆盖；检测到同名进程在跑时先报错退出，不静默跳过）。build1 = build.ps1 的
  stripped 构建、只是输出名不同；buildm 在 build1 同一构建后加 `UPX --ultra-brute`（`-Fast` 可退到
  `--best --lzma`），PATH 里没有 `upx` 时自动从 GitHub releases 取 v5.0.2 装进 `tools\upx\`（`.gitignore`
  的 `*.exe` 覆盖它，不入库、不进 embed——UPX 只是构建期工具，不随 exe 出货）。打包后门槛两道：`upx -t`
  自校验 + 真启动（`-window=false -no-browser` 沙箱化运行）应答 `/api/health`，任一失败退出码 1。
  **注意两件事**：`build.ps1 -Task console` 同样写 `dist\autostamp.exe`（console 构建），二者互盖、二选一
  别混用；UPX 打包后 `go version -m` 读不出 commit（版本在打包前打印），且压缩产物常被 AV 按打包器签名
  误报（实测体积与耗时见 FACTS §4.3）。

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
12. **印章「去白底」在前端做（D4），后端只存原图 + 选项。** `seal.prepare.despill` 默认开；
   规则：`min(R,G,B) >= 60` 判彩色（保留 alpha），白/灰 alpha 置 0，彩像素按
   `c -= (255-c)*min(255,255-min(c))/195` 反算回红。实测三例见 FACTS §1.8；白底照片类
   印章会被整图丢弃（`UNVERIFIED`，关掉选项是唯一出路）。「撤销去背」= 用内存里的原图
   以 `despill:false` 重跑 `/api/pdf/seal/prepare`，不依赖 undo 栈。
13. **画布合成必须显式预乘 uint8。** `getImageData` 读回的是预乘值；半透明印章要
   `round(a*r/255)` 预乘后再 `source-over`，否则出暗环。预览与落盘的同点像素由
   FACTS §1.3 公式钉死（`overlay-smoke` 的 16 模式 × 3 透明度矩阵 absdiff ≤ 1）。
14. **坐标一律左上原点、y 向下（PDF pt）**：`pos`/`offset`/手柄/标尺/条带同一坐标系
   （C1 未评审默认，`UI_SPEC §8` C1）；P4 落盘换算有单测钉死。滚轮缩放只在**光标位于
   选中实例内**时改 `apply.scale`，且事件必须 `stopPropagation`（FACTS §1.8 V3）。
15. **导出体积预估是前端派生值，不发请求**：按 FACTS §4 实测表 × MediaBox 面积/A4 面积
   缩放，离表 DPI 按对数插值（E1：导出段内联显示 `#estimate-total` / `#estimate-per-page`）。
16. **落盘按实例数组 + ExtGState 归属判定**。`POST /api/pdf/apply` 一次写完所有实例：
    `internal/pdfcore` 按 `(blend, opacity)` 相邻分组，每组走**一次** `AddWatermarksSliceMap`
    （pdfcpu 要求同批外观一致，实测 2026-10-30）。`/BM` 只注入本 pass **新建**的 ExtGState：
    pass 前后的资源名差集 ∩ 章图层引用名（`Artifact/Watermark` 块里的 `/Name gs`），
    绝不写页自身已有的状态；多个页共享同一 ExtGState 对象时第二页不再重写入；
    已有 `/BM` 且不是要求的模式 → 直接报错，不改写别人的模式。
    预览与落盘共用同一几何：`pdfcore.StampGeom.Box` == `app-overlay.rectFor`
    （`pos` 通道 = 实例左上角；`anchor` 通道 = 页角/页中 + `offset`）。

17. **落盘坐标 = 显示空间 + 一次 y 翻转**：`model.Watermark` 的 `Pos:BottomLeft` +
    `Dx/Dy` 写进内容流是 MediaBox 空间（y 向上）的 Form 左下角，换算只有
    `Dy = dispH - box.Y - box.H`，**不加任何旋转量**（pdfcpu 自己用 `PageRot` +
    `ContentBytesForPageRotation` 包掉 `/Rotate`）。条带框的**纵横比必须取自整枚印章**
    （用切片自己的比会把每条做成 `count` 倍高）—— 实测数值见 FACTS §2.6，断言
    `TestStampStripBoxUsesWholeSealAspect`。
18. **叠加层的快照按「画布元素」识别，不按尺寸**：`app-preview.renderCurrent` 每次渲染
    都新建 `canvas.page-canvas`（`stage.replaceChildren`），换文档必然换元素。快照若按
    `page|scale|dpr|尺寸` 识别，盖章前后同一页同一 zoom 完全相同 → `repaint()` 把上一份
    文档的位图画回新画布，落盘后的回读整页 0 命中印章色。实测与断言见 FACTS §1.9
    （验收脚本取样前必须 `preview.redraw()`）。
19. **光栅导出 = 前端渲染回传，服务端只写字节**：`POST /api/pdf/export` 的 raster 半边只吃
    前端回传的页位图（pdfcpu 无 rasterize，FACTS §2.4），JPEG 字节**直传** `/DCTDecode`
    （不重编码，否则质量二次损失）；页 pt = `px*72/dpi`（两位小数）、**不加旋转量**
    （pdf.js 输出的就是显示方向，同 §5.17）；单页 >90 MiB ⇒ 400 `page_too_large`，前端按
    体积预估在发请求前拦下（`UI_SPEC` W6）。vector 走 JSON、只裁页。**保存幂等**：当前文档
    已是光栅化资产且 `dpi/质量/pages` 没变 ⇒ 第二次保存不再光栅化（`app-shell` 的
    `lastExport`），否则就是多一代 JPEG 画质损失；改了参数才重光栅化一次。
20. **预设库 = 索引 + 图片文件**：`seals/presets.json`（数组索引，原子写）+ `seals/<slug>.png`。
    图片**复制**自 tmpstore 的 seal 资产（前端已上传过一次，不再二次上传），参数组 =
    `apply.*` 白名单 + `seal.prepare.*`（去背选项跟着预设走，`apply`/批处理都按它跑）。
    删预设才删图片；重命名不改（同名 = 覆盖，PR2）。
21. **批处理在前端逐文件跑链（BM1，2026-11-02 取代「服务端串行作业 + 只矢量」）**：
    目录 = `fs/pick{dir:true}`（`dirPath` + 一层内每个 PDF 的 grant）；队列并发数
    `api.batch.concurrency`（默认 2，1..8）。每文件：`fs/pick{filePath}` → `pdf/open` →
    （可选 `pdf/split`，词表用面板的 `api.split.*`）→ `pdf/apply`（印章与参数来自预设：
    `GET /api/seal/preset/raw?id=` 的字节 → `pdf/seal/prepare`，一份字节 prepare 一次全批复用）→
    `pdf/export`（multipart 光栅，页位图由前端 pdf.js 渲染回传 ⇒ dpi/质量 真生效，
    pdfcpu 无 rasterize，FACTS §2.4）→ `pdf/save{targetPath,mkdirs:true}`。
    输出 = `源目录\_batch\原名.dpi<数字>.q<数字>.pdf`（例 `a-01.dpi150.q75.pdf`；BM2
    取代 BC2 的 `_seal` 命名；**单扩展名**是硬要求：`fsx.ValidateTargetPath`/`CheckWriteTarget`
    只认 `.pdf`，多后缀会被 `path_denied` 挡掉）；
    加密件不弹密码，跳过并在报表记 `password_required`（BM4）；源文件永不改；
    报表就是前端队列状态，CSV/JSON 由前端生成（需求 9，不发请求）。
22. **最近文件只有后端，UI 入口已于 2026-11-03 删除**：`config.RecentFiles`（24 条，P0 就有）+
    `SetRecent`（去重 + 截断）就是全部后端 —— `pdf/open` 成功时按路径记录，`settings.json` 的
    `recentFiles` 继续有值。RF1 当年接的两个入口（启动页列表 + 顶栏下拉，点了走 `fs/pick{filePath}`
    直开授权，与手输路径同一条链）在顶栏收尾（`UI_SPEC §8` HD1）时删掉，前端不再读回展示；
    没有新路由、没有新字段；记录的都是真在 `pdf/open` 里成功开过的路径，不编造条目。
23. **粘贴/拖拽装载同一 gate（PD1/PD2，2026-11-03）**：前端 `app-shell.js` 的
    `submitFiles(files, via)` 是唯一装载漏斗 —— 接受条件只有两种：
    **单个 PDF**（`handleFiles` → multipart `pdf/open` → `adopt`，与窗口级拖放同一条链；启动页的
    「打开文件」走 `fs/pick` grant，见 §5.25）或
    **一张/多张图片**（逐个 `seal/prepare`；单张设给选中实例，多张=第一张给选中实例 +
    其余每张**新增实例**按文件名命名；空态无文档只 prepare 不指派）。多个 PDF、PDF+图片混拼、
    其它类型一律 toast 告警不装载。粘贴：焦点在输入框且含 `text/plain` 时放行（路径框语义）；
    拖拽：`dataTransfer` 不含 `Files` 不 `preventDefault`（文本拖拽不被劫持）。无新路由、无新字段。
24. **顶栏契约（HD1/HD2/HD3 + HD5，用户 2026-11-03/11-04 对话指令）**：顶栏**没有任何文本**，
    只有图标控件（内嵌 SVG + `data-i18n-title`，cn 孪生 `data-i18n-title-cn`，`applyLang` 写
    `title` + `aria-label`）：左簇 =「打开」+「保存」相邻贴着左边缘，右簇 = 语言 → 主题 → 快捷键，
    **快捷键最右**（在明暗切档右侧）。品牌文字、最近文件入口、顶栏「上传」、「导出设置」入口、
    密度切档、版本 chip、`#top-file` 标题文本 **都已删除**（HD5 作废 HD2 的顶栏承载半边）。
    版本 + 打开后的文件名只写在**窗口标题**：前端 `setDocTitle()` 写 `document.title` =
    `AutoStamp <版本> [文件名]`，与 Go 原生标题栏 `windowTitle` 同一个串；`#top-file` 的
    `title` 属性（完整路径 · 体积）随元素一起消失。版式**固定 two-col**：
    `ui.density` 契约字段（Go `config.UI.Density` / `PatchUI.Density` / `sanitize` 校验）与 CSS
    `[data-density=…]` 规则整条删除，settings 的 patch 不再接受该字段。驱动面：`probe('version')`
    返回纯版本串、新增 `probe('docTitle')` 读标题，`setDensity()` 与 `probe('density')` 删除。
25. **启动页装载入口（HD6，用户 2026-11-04 对话指令）**：三个入口 —— ①「打开文件」按钮
    `#empty-pick`（与顶栏「打开」同一个 `pickAndOpen()`；i18n 键 `empty.pick.btn` =
    Open file / 打开文件）② 路径框 `#empty-path`，**回车**触发 `openByPath()`（`keydown`
    Enter + `e.preventDefault()`）③ 窗口级拖放/粘贴 → `submitFiles` → `handleFiles`（multipart，
    §5.23）。「上传文件」按钮 `#empty-upload`、路径框右侧的「打开」按钮 `#empty-open`、隐藏
    `<input id="file-input">` 与其 change 监听 **全部删除**（已无触发者）：`UI_SPEC §6` ui-ids
    去掉 `top-file`、`empty-upload`、`empty-open`、`file-input`（93 → 89），§4 删 `empty.open.btn`、
    `empty.upload.btn` 两键（270 → 268；`top.file.hint` 保留，仍用于 `#save-source`/`#confirm-path`）。
    没有新路由、没有新字段。
26. **左列预览出血（HD7，用户 2026-11-04 对话指令）**：左列不再卡片式内缩 —— `#empty-state` 去
    `margin: 24px` + `border-radius: 8px`（占满左列，虚线框保留）、`#preview-stage` 内边距 `18px` →
    `0`、`.page-frame` 圆角 `2px` → `0`；拖放反馈不变（`#preview[data-drag]` + `#drop-hint`）。
27. **预览视口契约（V4–V6 + ghost 修复，用户 2026-11-04 人工验收修正指令）**：fit =
    **整页适配**（`fitZoom = min(stageWidth/pageW, stageHeight/pageH)`，保比例，打开默认 fit，
    两向都不超出容器）；`#preview-stage` `overflow: hidden` = **无滚动条**；缩放超出容器时
    平移走程序化偏移（`app-preview.js` 的 `bindPan`：Space+方向键 / Space+左键拖动（capture
    +`stopPropagation`，不劫持印章选择/拖动）/ 无 Ctrl 滚轮），浏览器对 `scroll[Left|Top]` 的
    原生 clamp 就是「图片上下左右边不会超出容器上下左右边」；**Ctrl+鼠标中键** = `fit()`
    （同时 `preventDefault` 吃掉 autoscroll）。探针 `probe('pan')` 暴露偏移 + clamp 边界。
    叠加层单绘制契约：`.instance` 只挂 `sel-box`，**实例画布不挂 DOM**（只是
    `probe('instancePixels')` 的背板）——旧版把印章同时画进 DOM 实例画布（按 natural size
    溢出选中框，只露出左上部分）造成「完整印章 + 左上角副本」ghost 双绘制，已修复。
    `brightness/saturate` 复核：链路本来就分离（滑杆写 `api.apply.brightness/saturate`，
    `drawSeal` 拼 `ctx.filter`），用户感觉「两滑杆结果相同」的根因就是 ghost——修掉后差异明显。
28. **顶栏印章装载通道（HD8/HD9，用户 2026-11-04 对话指令）**：侧栏「上传印章 PNG」按钮与
    隐藏 `#seal-file-input` 删除。印章三来源 = ①顶栏 `#btn-seal-upload`（`fs/pick{filter:image}`
    → `seal/prepare` JSON `{pathGrantId,…}` 形态，成功后后端 `SetRecentSeal` 记路径）②顶栏
    `#seal-recent-select`（选项 = `settings.recentSeals` 的**去后缀**文件名，value = 完整路径；
    选择走 `fs/pick{filePath}` → JSON 形态；`path_denied` = 文件已不存在 → 移除选项 +
    `PATCH settings{recentSeals}` 整组替换删记录）③粘贴/拖拽的 File 对象喂 multipart（无路径，
    不记录）。记录存既有唯一设置文件 `%APPDATA%\AutoStamp\settings.json`（不在 exe 目录新建）。
    左列底部 `#seal-preview` = 当前选/刚打开的印章预览（`ImageBitmap` 画进 canvas，不走 CSP
    禁区）。
29. **加章模式 + 实例只作用放置页（HD10/HD11，用户 2026-11-04 对话指令）**：顶栏下拉右侧
    `#btn-seal-add`（`aria-pressed` 切档，不持久化）；开启时左键点击页面空白处 =
    `app-shell.addInstanceAt(pagePoint)`：当前印章（`state.currentSeal`）+ 点击点几何 +
    `pages` = 当前页，新增实例并选中；点击已有实例仍是选择/拖动。实例 `pages` 默认 = 放置页
    （W4 落盘语义不变；`crossPage` 实例开启时 `pages` 归 `all`，逐页条带语义见 §5.7）。
30. **浮动实例参数面板（HD12，用户 2026-11-04 对话指令）**：侧栏 `panel-overlay/panel-position`
    两段删除；`#instance-panel` 贴选中实例右侧（绝对定位在 `#preview` 内，跟随 =
    `autostamp:param/page/lang/theme` 事件 + ResizeObserver；右侧放不下翻转左侧，两向 clamp）。
    成员 = `api.apply.blend/opacity/brightness/saturate/scale/rotation` 六控件（`data-field`
    契约名不变）+ `#instance-reset`（实例参数回 settings 默认组）+ `#instance-remove`。缩放滑杆
    **0.1..2.0（10%..200%）**，拖边角/滚轮/键盘可超出且回显滑杆（落盘词表上限放宽到 0.05..5.0，
    `sanitize` 同步）；旋转滑杆 −180..180。实例几何恒走 `anchor`(center)+`offset`（`geomMode`
    双通道与 `pos` 控件删除，方向键步进改 `offset`）。默认参数与 `#instance-reset` 同源 =
    `DEFAULT_PARAMS` 快照（boot 播种、每次 `applySettings` 与 `apply` 组 `persist` 成功后刷新）；
    面板控件镜像的是选中实例，读实时控件会回显现值 → 复位必须回快照，不能读控件。
31. **预览卡 overlay + 下拉当前选项同步（HD13/HD14，用户 2026-11-05 对话指令）**：
    `#seal-preview` 是 `#preview` 内的绝对定位 overlay（左下距底 10px；分页条可见时上移
    77px 贴其上沿），不再占布局高度；`#seal-recent-select` 每次渲染后 value = 当前印章的
    路径（路径通道打开后自动选中），无路径的当前印章（粘贴/拖拽）以下拉末尾标记项
    （value=`__current__`）显示为当前选项，change 处理器对标记项按 no-op 处理。
32. **后端终端（HD15/HD16，用户 2026-11-05 对话指令）**：顶栏控件同高 34px。右簇快捷键
    按钮左侧 `#btn-console`（`aria-pressed`）切 `#log-console`（左列底部 overlay，180px）；
    面板内容 = `GET /api/logs`（`internal/console.LogRing` 400 条尾窗，写入由
    `console.WithRing` 在 stderr 与环上扇出），仅面板可见时 1.5s 轮询（seq 增量，打开时
    从 0 起 = 本次运行全量）。可见性持久化 = `config.UI.ConsoleVisible`
    （`settings.ui.consoleVisible`，默认 false = 隐藏；`PATCH` 整组走既有通道）。


## 6. HTTP 契约（`/api/*`，全部 JSON；字段在 **P0.5 与用户确认后**才冻结，改动必须同步本文、`docs/UI_SPEC.md` 与前端）

|路由|用途|
|---|---|
|`GET /api/health`|健康检查 + 版本号|
|`POST /api/fs/pick`|原生文件选择器（`{filter,multi,startDir}`；filter 词表 `pdf|image|all`，`image` = 印章图选择器，见 HD8）或 `{"filePath":…}` 直开授权，返回 `pathGrantId`（owner 绑定，TTL）；取消回 `{cancelled:true, picks:[]}`，无选择器的平台回 501 `pick_unsupported`；`{dir:true}` 选**目录**（Windows `FolderBrowserDialog`；`{dir:true,filePath:<目录>}` = 无选择器平台的直开），回 `{dirPath, picks[]}` = 该目录**一层内**匹配的 PDF，每个带自己的 grant（批处理输入，BM1）|
|`POST /api/pdf/open`|按 `pathGrantId` 或 multipart 上传打开 PDF → `assetId` + 页元数据（页数、每页 pt 尺寸、rotation、是否含文字）|
|`GET /api/pdf/raw?id=`|原始 PDF 字节（支持 Range/ETag），供 pdf.js 直接取|
|`POST /api/pdf/split`|**已实现**:切分词表 `{assetId, splitMode, rows, cols, customCuts[], splitVeto, vetoPages[], splitPages}`（词表 = `UI_SPEC §2.2`；`splitVeto` 是指针,`false` 是真答案；`vetoPages` = D3 逐页否决；`splitPages` 用 pages 词表限定可切页）→ 新 `assetId`（kind `split`）+ 同形状页元数据;原资产保留即「撤销切分」的实现|
|`POST /api/pdf/seal/prepare`|**已实现**：两形态靠 `Content-Type` 协商（HD8）。`multipart/form-data` = 上传印章 PNG（粘贴/拖拽/预设重喂走这条，不记路径）；`application/json` = `{pathGrantId, despill, alphaTrim, resampleDpi}`（顶栏「上传印章」/ 最近印章下拉；成功后 `config.SetRecentSeal(path)` 记录）。两形态共用 `pdfcore.PrepareSeal` → `sealId` + alpha 元数据（词表见 `UI_SPEC §2`，去背规则见 §5.12 与 FACTS §1.8）。配套 `GET /api/pdf/seal/raw?id=` 只回印章字节给合成/预览|
|`POST /api/pdf/apply`|**已实现**:矢量落盘词表 `{assetId, instances[]}`，实例字段 `sealId/blend/opacity/scale/pos/anchor/offset/rotation/pages/crossPage/binding/startOffset`（`brightness/saturate` 仅预览，**不发送**；发送即 400）→ 新 `assetId`（kind `applied`）。实例数组是关键：一条请求写完全部实例，同一 `(blend,opacity)` 组走一次 pdfcpu pass|
|`POST /api/pdf/export`|**已实现（P5）**：两形态靠 `Content-Type` 协商。`application/json` = vector：`{assetId, mode:"vector", pages}`，只按 pages 词表**裁页**（`all` 时原样克隆），不重编码；带 `dpi/quality` 即 400。`multipart/form-data` = raster：表单字段 `spec` 是 JSON（`{assetId, mode:"raster", dpi, quality, pages}`），每页一个文件 `page-<n>`（JPEG/PNG 字节，**页位图由前端 pdf.js 渲染回传**，服务端不 rasterize、不重编码 JPEG）→ 新 `assetId`（kind `exported`）+ `bytesPerPage`。单页图像 > 90 MiB ⇒ 400 `page_too_large`；前端按体积预估**提交前拦截**（`UI_SPEC` W6）|
|`POST /api/pdf/save`|**已实现**:`{assetId, targetPath|pathGrantId|replaceOriginal}`（三选一，必须且只能给一个）→ `fsx.AtomicWriteFunc` 原子写盘；`replaceOriginal` 用 `tmpstore.Asset.Origin`（open/split/apply 都向前继承）；`{mkdirs:true}` 才允许创建 targetPath 的父目录（批处理 `_batch` 输出），不开时目标目录不存在仍是 400 `bad_body`，防止把文件写进一个拼错的新目录|
|`GET /api/settings` / `PATCH /api/settings`|读全量设置；`PATCH` 走 `{"patch":{...}}` 信封（嵌套指针字段按需合并）；`recentSeals: []RecentRef` = 最近打开的印章路径（HD8，24 条去重截断，`PATCH` 该字段整组替换 = 兜底删除记录的唯一通道）|
|`GET /api/logs`|**已实现（HD16）**：读 `console.LogRing`（400 条尾窗）→ `{lines:[{seq,time,level,message,attrs}],next}`；`?since=<seq>` 增量语义（回 `next` 供下次轮询）。面板可见时前端 1.5s 轮询，默认面板隐藏（`ui.consoleVisible=false`）|
|`GET /api/seal/preset`|**已实现（P6）**：列出预设 → `{"presets":[{name,imageBytes,updatedAt,params}]}`（索引 `%APPDATA%\AutoStamp\seals\presets.json`）；`params` = `apply.*` + `seal.prepare.*` 白名单，写入前已按 `apply` 词表校验并补默认（`anchor=center`、`binding=right`）|
|`POST /api/seal/preset`|**已实现（P6）**：`{name,sealId,params}` —— 把该 seal 资产的字节**复制**成 `seals/p-<hash>.png` + 原子重写索引（`fsx.AtomicWrite`）；同名 = 覆盖（PR2）；名字空/带路径分隔符/以点或空格结尾 ⇒ 400 `preset_bad_name`；`sealId` 不在 ⇒ 404 `not_found`；不是印章资产 ⇒ 400 `kind_denied`；参数不合法 ⇒ 400 `bad_body`|
|`DELETE /api/seal/preset?name=`|**已实现（P6）**：删索引项 + 图片文件（不存在 ⇒ 404 `preset_not_found`）|
|`GET /api/seal/preset/raw?id=`|**已实现（P6）**：流回预设存的印章字节（Range/ETag 由 `http.ServeContent` 负责）。「载入预设」= 前端把这份字节重新喂给 `/api/pdf/seal/prepare` 得到新 `sealId`（去背选项按预设存的跑）；批处理同一份字节只 prepare 一次，所有文件复用同一个 `sealId`|
|批处理（需求 6/9）|**已实现（前端跑链，BM1–BM4；没有后端作业路由、没有 SSE）**：`fs/pick{dir:true}` ⇒ `dirPath` + 一层内每个 PDF 的 grant → 前端队列（`api.batch.concurrency` 1..8，默认 2）逐文件 `open`→（`split`）→`apply`→`export`(光栅，页位图前端渲染回传)→`save{mkdirs:true}`；输出 `源目录\_batch\原名.dpi<数字>.q<数字>.pdf`；加密件跳过记 `password_required`；报表 + CSV/JSON 由前端生成（不发请求）|

契约细则（P0 已实现，改动必须同步本节 + `UI_SPEC §4` + `web/static/app-api.js`）：

- 统一信封（`internal/webx/json.go`，**扁平**字段）：成功
  `{"ok":true,"data":{…}}`；失败 `{"ok":false,"code":"…","error":"…"}`。
  已注册错误码：`bad_body`(400) `bad_host`(421) `bad_origin`(403) `internal_error`(500)、
  `bad_session` `bad_id` `not_found` `kind_denied` `path_denied` `password_required` `password_invalid`
  `unreadable_pdf` `payload_too_large` `split_failed` `apply_failed` `validate_failed` `not_pdf` `save_failed`
  `pick_failed` `pick_unsupported` `page_too_large` `preset_not_found` `preset_bad_name`
  `preset_list_failed` `preset_save_failed` `http_<status>`（原登记的 `preset_no_seal` / `batch_*`
  随「无后端批处理作业」作废，见 §5.21）。
  新增码必须同时登记进本节 + `UI_SPEC §4` + 前端 i18n 文案表。
- 请求体：`/api/settings` 的 body 是 `{"patch":{…}}`；未知字段一律 400
  （`webx.DecodeJSON` 用 `DisallowUnknownFields`），空体也算 400；
  越界值不报错而是 clamp 并在响应的 `warning` 字段里说明。
- 尚未接线的路由**不加** `/api/` 兜底 handler（那会吞掉 `ServeMux` 的免费 405）：
  未注册 verb 的 `/api/...` 命中 `GET /` → **405 纯文本**（不是信封），
  前端按 `http_<status>` 上报（FACTS §1.5）。
- `Host` 必须等于本机监听地址（`127.0.0.1:port` / `localhost:port`），否则 421
  `bad_host`（防 DNS-rebinding）。`Origin` 校验随 **P7 默认开启**（`security.strictOrigin`
  默认 `true`，可 `PATCH` 关）：非 `GET`/`HEAD` 且 Origin 非空又不是本机 → 403
  `bad_origin`；不带 `Origin` 的调用者（curl、Go 测试）不受影响。读动词不查 Origin，
  CSRF 风险只在写。见 `internal/app/middleware.go:hostGuard`。
- 每个响应都带 `X-Content-Type-Options: nosniff`（中间件一处，含 4xx/5xx 信封）。
  静态资产的 CSP 在 `web/embed.go`（`script-src 'self'` = 根本不放内联 JS，
  `style-src` 才带 `'unsafe-inline'`，`frame-ancestors 'none'`、`object-src 'none'`；
  实测见 FACTS §1.5）——**原计划的「内联 hash 策略」不需要**：没有内联脚本可放行。
- gzip 中间件只压白名单扩展（`.html .js .mjs .css .json .txt .map .svg`），
  cmaps/wasm/PDF/PNG 一类已压缩或二进制资产**不重压缩**；响应带 `Vary: Accept-Encoding`。

## 7. 编码规范

- `gofmt`/`goimports`；导出函数须有文档注释。
- 错误显式处理，不用 panic（例外：`init` 期契约校验、`internal/feature` 式 manifest 检查）。
- 共享状态 `sync.RWMutex`；并发写盘一律 temp+rename。
- 日志用 `internal/console`（`log/slog` 封装），不直接用 `log` 标准库（`main.go` 启动失败回退 `log.Fatalf` 可以）。
- 前端：无全局变量污染，模块用 IIFE + `window.__autoStamp*` 命名空间；字符串一律 `escapeHtml`；
  i18n 双语文本集中在 `web/static/app-i18n.js`（en+cn），不得散落在 JSX/HTML。
- 测试：**Go 测试为唯一编译期测试通道**（`go test ./...`，无 npm/node 测试框架）。
  静态契约（CSP 指令、静态资产服务/遍历拒绝、内联脚本禁止）由 `web/embed_test.go` 断言；
  运行时行为（状态机、i18n 覆盖、`data-field` 快照、`/api` 往返、实例交互、窗口标题）由
  `tools/verify/shell-smoke.mjs`（真二进制 + CDP）与 `ui-smoke.mjs`（mock）断言；
  `data-field` ↔ 字段表三方一致性由 `ui-contract.mjs` 断言。
  `internal/pdfcore` 必须有单测（切分几何、条带切片、blend 注入、raster writer 字节结构）。

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
  7. 壳契约（P0 起常驻）：`node tools/verify/shell-smoke.mjs` — 真二进制 + headless
     Chromium（`tools/verify/cdp.mjs`，无 npm 依赖），沙箱化 `%APPDATA%`/`%LOCALAPPDATA%`；
     断言 console 0 error、无 404、12 状态机、深链、en/cn i18n 覆盖（含图标按钮的
     `data-i18n-title` tooltip）、窗口标题（`probe('docTitle')` = `AutoStamp <版本>`）、
    印章顶栏通道 HD8–HD16 全链（`#btn-seal-upload`/`#seal-recent-select`/`#btn-seal-add`/
    `#instance-panel`/`#seal-preview`/`#btn-console`/`#log-console`：最近印章进
    `settings.recentSeals`、不存在路径自动移除记录、预览卡有像素且为左下角 overlay、
    加章模式空白处点击落章且 `pages` = 当前页、浮动面板贴选中实例右侧、复位回 settings
    默认快照、删除实例后选中顺延且面板跟随、打开印章自动成为下拉当前选项、顶栏控件同高
    34px、后端终端开关开面板 + 日志非空 + `ui.consoleVisible` 持久化）、实例增删选中复制、
    `/api` 往返与 `{"patch":…}` 合并。
  8. 窗口通道：`node tools/verify/webview-launch.mjs`（真窗口 + 页内 `/api` 请求）与
       `go run ./tools/verify/comprobe`（COM 返回值实测，FACTS §1.6）。
  9. P1 查看链路（P1 起常驻）：`node tools/verify/preview-smoke.mjs` — 用 CDP
     `Page.printToPDF` 现场生成四类样本（英文多页文字 / 中文 CID / 混合型 / 图片型无文字），
     真 exe + 真 UI（`#empty-path` 回车通道，HD6）跑一遍：断言画布有真实像素、
     `getTextContent` 条数（图片型必须为 0）、`.textLayer` span 计数与层框宽度 == 画布 CSS 宽、
     翻页与分页条 chip 数、缩放后 backing store 尺寸变化、**fit = 整页（两向不超出容器，
     fitZoom == probe('fitZoom')）**、**V5 平移：Space+方向键 / Space+左键拖动移动滚动偏移且
     停在 `probe('pan')` 的 clamp 边界、Space+箭头不劫持印章步进**、**V6 Ctrl+中键回 fit**、
     vendor 资源 0 失败（FACTS §1.7）。
  10. P2 叠加预览（P2 起常驻）：`node tools/verify/overlay-smoke.mjs` — 真 exe + 真 UI，
      分段令牌 `--only=<open|geometry|despill|matrix|drag|strip|filter|export>`（缺省全跑）。
      断言：上传印章 → 16 模式 ×{1.0,0.6,0.3}（脚本页内独立重算再与真实画布比，absdiff ≤ 1）、
      alpha 预乘规则、去背 alpha/bbox 计数、几何（fit 缩放、四角→`scale`、拖拽→`offset`、
      旋转手柄→`rotation`、滚轮只在光标位于选中实例内时改 `scale`）、骑缝条带
      （宽 = 页宽 10%、`startOffset` 位移误差 0、`alternate` 条带数 == 页数、逐页列对齐 ≤1 px）、
      `ctx.filter` 复位读数、**filter 语义：`brightness` 与 `saturate` 的 CSS filter 独立生效
      （两滑杆分别改像素、公式与滤镜矩阵手算比对，且 `#stamp-layer` 内无挂 DOM 的实例画布
      = ghost 双绘制已根除）**、导出体积预估 == FACTS §4（含 vector 忽略 DPI/质量）。
      **改前端后必须去掉 `--reuse-build`**（该旗标复用 `dist/autostamp-overlay-smoke.exe`，
      旧嵌入副本会让新代码看不到 —— 2026-10-30 实测踩过的坑）。
  11. P2 像素等值性：`node tools/verify/pixel-matrix.mjs`（分段 `--only=matrix|chain`）=
      FACTS §1.3/§1.4 就地重跑（48 个模式×透明度组合、污染值复现、复位后回原值），外加
      **真链路桥**：`fs/pick` 直开 → `pdf/open` → `seal/prepare` → 实例 → 叠加层取样，
      断言叠加层像素 == 同一对颜色在同族渲染器里的独立 blend（±2，取印章框中部避开 AA）。
      「必须与底不同」不是断言：lighten/saturation 与这块实心底组合本来就可能等于底。
  12. P4 落盘回读（P4 起常驻）：`node tools/verify/apply-smoke.mjs`（分段令牌
      `--only=<matrix|strip|perpage|chain|undo>`）—— `盖到 PDF` 之后用 applied 资产重新渲染：
      48 组（16 模式 ×{1.0,0.6,0.3}）与「同一对颜色在同族渲染器里的独立 blend」比对，
      阈值 ≤2、取印章框中部避开抗锯齿（FACTS §1.9）；骑缝落盘断逐页一条、按切分顺序
      对应印章左右半、条带 bbox 四边 ≤1 pt；**逐页落盘（HD11）断实例 `pages:"2"` 只盖
      第 2 页：页 2 有印章色、页 1 保持底**；保存链断「写盘后磁盘文件再 `fs/pick`+`open`
      页数 = 切分后的页数」；撤销盖章/撤销切分断 asset 换回 + 实例恢复。取样前必须
      `preview.redraw()`（换文档后快照才重抓，见 §5.18 + FACTS §1.9 —— 这是踩过的坑）。
  13. P5 光栅导出（P5 起常驻）：`node tools/verify/export-smoke.mjs`（分段令牌
      `--only=<raster|vector|guard|chain>`）—— 真 exe + 真 UI 走完「保存」链：断言每页
      pt == `px*72/dpi`（±1 pt）、导出文件字节落在 FACTS §4 行的 ±40% 量级带内（±5%
      钉不住，理由见 FACTS §4）、回读同点像素与导出前预览一致（Δ ≤6，取中部避开 AA）、
      `mode=vector` 的增量网络日志里 `/api/pdf/export` 请求数 0 且回读仍有文字、W6 超限
      只出 warn 且 `/api/pdf/*` 请求数 0、二次保存不重光栅化（export 请求 0 次）/改参数
      后重光栅化恰好一次 + 换来新 export asset。连续保存时完成信号只能等**请求本身**
      （`save` 回显同一 assetId，拿 probe 的 asset id 变化等会一直超时 —— 踩过的坑）。
  14. 以上全部由 `build.ps1` 串成一条命令（`-Task verify` / `go vet` / `go test`），
      任一失败退出码 1。
  15. P6 预设 + 批处理（P6 起常驻）：`node tools/verify/batch-smoke.mjs`
      （分段令牌 `--only=<preset|batch>`）—— 真 exe + 真 UI：预设 保存→列表→载入→删除
      往返（存进去的字节与 `GET /api/seal/preset/raw` 回读的字节一致、参数填回面板），
      批处理 `fs/pick{dir:true,filePath}` 列目录 → `#batch-start` 跑 BM1 前端链 → 断言
      `_batch\原名.dpi<数字>.q<数字>.pdf` 存在、产物再 `fs/pick`+`open` 页数正确、
      源文件字节没变、加密件在报表里记 `password_required` 且不弹密码、CSV 下载含表头与
      每文件一行。批处理没有 SSE/作业路由（BM1 作废 BC1），队列状态就是前端 DOM 的读数。
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
|改切分/骑缝几何|`docs/FACTS.md` §2.3 + §1.8|`internal/pdfcore/split.go`（词表含 `vetoPages`/`splitPages`）、`sealimg.go`（落盘条带）、`web/static/app-preview.js`（`drawSplitMarks` 切点预览）、`web/static/app-overlay.js`（`stripGeometryFor/stripRectsFor` 条带）、`web/static/app-shell.js`（`#split-veto` 逐页否决、`#split-undo`）|
|改叠加层/印章通道|`docs/FACTS.md` §1.8 + §1.3 + §1.9|`web/static/app-overlay.js`（合成/affordance/滚轮/快照 `state.surface`；实例画布只作 probe 背板、不挂 DOM——单绘制契约 §5.27；加章模式点击 `addInstanceAt` §5.29）、`web/static/app-seal.js`（multipart 上传 / `prepareFromGrant` pathGrantId 形态 / 去背撤销 / 左列预览 `renderPreview`）、`web/static/app-shell.js`（`currentSeal`/最近印章下拉/浮动面板 `#instance-panel`）、`internal/api/seal.go`（两形态 + `SetRecentSeal`）|
|改印章顶栏通道 / 实例面板（HD8–HD12）|`docs/UI_SPEC.md` §2/§4/§6/§8 HD8–HD12|`web/static/index.html`（顶栏 `#btn-seal-upload`+`#seal-recent-select`+`#btn-seal-add`、`#seal-preview`、`#instance-panel`）、`web/static/app-shell.js`、`internal/config/{types,store,patch,sanitize}.go`（`recentSeals`、scale 0.05..5）、`internal/api/seal.go`（JSON 形态）、`internal/fsx/pick.go`（`image` 过滤词）|
|改落盘/撤销/保存|`UI_SPEC §8` W1-W4 + 本文件 §5.16/§5.17 + FACTS §1.9 §2.6|`internal/api/apply.go`、`internal/api/save.go`、`internal/pdfcore/{apply,stamp,blend,validate,pxdims,pages}.go`、`web/static/app-shell.js`（`stampIntoPDF`/`undoRoute`/`submitSave`）、`tools/verify/apply-smoke.mjs`|
|改导出体积预估|`docs/FACTS.md` §4|`web/static/app-shell.js`（`computeEstimate/refreshEstimate`、`probe('estimate')`）|
|改混合模式/透明度|`docs/FACTS.md` §1.2/§1.3/§2.2|`internal/pdfcore/blend.go`、`web/static/app-overlay.js`|
|改导出 DPI/质量|`docs/FACTS.md` §4 + `UI_SPEC §8` W5/W6|`internal/pdfcore/raster.go`（writer 字节结构）、`internal/api/export.go`（协商两形态 + 硬限）、`web/static/app-shell.js`（保存内的 raster 通道 + `MAX_EXPORT_PAGE_BYTES` 拦截 + `exportDpiOf/exportQualityOf` + `lastExport` 幂等）、`tools/verify/export-smoke.mjs`|
|改预设库|`UI_SPEC §8` PR1/PR2 + 本文件 §5.20/§6|`internal/presetstore/store.go`（索引 `presets.json` + `p-<hash>.png`，原子写）、`internal/api/seal_preset.go`（四路由 + `validatePresetParams`）、`web/static/app-batch.js`（预设 存/载/删/列表）、`web/static/app-api.js`（`preset*` 通道）、`tools/verify/batch-smoke.mjs --only=preset|
|改批处理|`UI_SPEC §8` BM1-BM5 + 本文件 §5.21（**没有后端作业路由、没有 SSE**）|`web/static/app-batch.js`（`runOne` 跑链 + `batchTarget` + `pagesForDoc` + 报表下载）、`web/static/index.html`（批处理段字段）、`web/static/app-api.js`（`fsPickDir`/`exportUpload`）、`internal/api/pdf.go`（`fs/pick` 的 `dir` 分支）、`internal/api/save.go`（`{mkdirs}`）、`internal/fsx/list.go`（`ListPDFs`）、`tools/verify/batch-smoke.mjs --only=batch|
|改打包/发布物|本文件 §4（PC1）|`build.ps1`（`Start-Package`：`autostamp-<rev>-win64.zip` = strip 窗口版重命名 `autostamp.exe` + `README.md`，25 MB 体积门）、`README.md`（随 zip 一起出货，必须保持准确）、`build1.ps1`/`buildm.ps1`（单 exe 出口 `dist\autostamp.exe`；极限压缩走 UPX，见 FACTS §4.3）|
|改粘贴/拖拽装载|`UI_SPEC §8` PD1/PD2 + 本文件 §5.23/§5.25（无新路由/新字段）|`web/static/app-shell.js`（`submitFiles`/`classifyLoad`/paste/dragover/drop/`state.loadLog`）、`web/static/index.html`（`#drop-hint`；装载入口 = `#empty-pick` + `#empty-path` 回车，无隐藏 `file-input`）、`web/static/style.css`（`[data-drag]`+`#drop-hint`）、`web/static/app-seal.js`（图片经 `seal/prepare`）、`tools/verify/shell-smoke.mjs`（装载断言）|
|改预览渲染/视口（fit、平移、fit 复位）|`UI_SPEC §8` V4–V6 + 本文件 §5.27 + `docs/FACTS.md` §1|`web/static/app-preview.js`（`fitZoom/stageHeight`、`bindPan`、`probe('pan')`、`panStage`）、`web/static/style.css`（`#preview-stage` `overflow: hidden` + `[data-pan]` cursor）、`tools/verify/preview-smoke.mjs`（fit/平移/fit 复位断言）、`web/static/vendor/pdfjs/`|
|预览卡 overlay / 下拉当前选项 / 顶栏高度 / 后端终端|`UI_SPEC §8` HD13–HD16 + 本文件 §5.31/§5.32|`web/static/style.css`（`#seal-preview`/`#log-console` overlay 定位 + 顶栏 34px 高度组）、`web/static/index.html`（`#btn-console` + `#log-console`）、`web/static/app-shell.js`（`renderRecentSeals` 当前选项 + `CURRENT_MARK`、`setConsoleVisible`/`pollLogs`、`probe('console')`）、`internal/console/ring.go`（`LogRing` + `WithRing`）、`internal/api/logs.go`、`main.go`（ring 播种）、`internal/config/{types,patch}.go`（`ui.consoleVisible`）、`tools/verify/shell-smoke.mjs`（HD13–HD16 断言）|
|新增路由|本文件 §6|`internal/api/register.go`、`web/static/app-api.js`|
|窗口/端口/浏览器回退|本文件 §5|`host_webview_windows.go`、`internal/app/`|
|改 UI 契约 / 参数词表 / 顶栏形态|`docs/UI_SPEC.md`（§2 词表、§4 i18n 键表、§6 契约 id、§7 驱动接口、§8 决策表含 HD1–HD16）+ 本文件 §6 + `IMPLEMENTATION_PLAN.md` P0.5|`docs/ui/mockup.html`、`web/static/index.html`（面板标记 + `data-field` + 图标按钮的 `data-i18n-title`；顶栏无文本，启动页入口 = `#empty-pick` + `#empty-path`）、`web/static/app-shell.js`（字段读写/实例/窗口标题 `setDocTitle()` + `probe('docTitle')`/路径框 Enter → `openByPath`）、`web/static/app-i18n.js`（由 §4 生成）、`web/static/style.css`（版式固定 two-col、无密度切档；左列出血 = `#empty-state` 无 margin/radius + `#preview-stage` padding 0 + `.page-frame` 无 radius）、`internal/config/{types,sanitize,patch}.go`（`ui.*` 词表：`lang`/`theme`/`consoleVisible`，已无 `density`）、`main.go`（`windowTitle` = `AutoStamp <版本>`）、`internal/api/{pdf,seal,export}.go`|
|改编译/测试流程|本文件 §4|`build.ps1`（任务分派 `Start-Dispatch`）、`tools/verify/*`|
|改 UI 文案（i18n）|`UI_SPEC §4` 的 i18n 键表是**唯一来源**（`app-i18n.js` 由 `node tools/verify/gen-i18n.mjs` 生成，勿手改）|`docs/UI_SPEC.md` §4/§7、`web/static/app-shell.js` 的 `t()`、`web/static/app-i18n.js`|
