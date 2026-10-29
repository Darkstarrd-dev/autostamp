# docs/FACTS.md — 实测事实（依赖与浏览器）

> 最后核对：2026-10-29（本机 Windows + Go 1.26.5 + Chrome 151 + WebView2 Runtime）。
> §1.5/§1.6/§4.1/§5.1 本轮新增并重跑；§1.1-§1.4、§2、§3、§4 的数值来自 2026-10-19/28
> 的一次性探针（已删除，不可就地重跑，见 §5.2），P1-P5 会把它们重写进仓库探针。
> 本文只记录**已执行验证**得到的事实；决策引用本文编号，不得凭记忆改写。
> 未验证项一律标 `UNVERIFIED`。复现方式见 §5。

## 1. 前端 / 浏览器（Chromium 151，与 WebView2 同族）

### 1.1 pdf.js（`pdfjs-dist@6.4.299`，Apache-2.0）

- 只有 ESM 构建：tarball 的 `build/` 目录内无任何 `.js`（只有 `.mjs`），
  `legacy/build/pdf.js`、`legacy/build/pdf.min.js`、`legacy/build/pdf.worker.min.js`
  经 CDN 探测均 404。在普通 `<script>` 页面里用
  `await import("./vendor/pdfjs/build/pdf.min.mjs")` 成功加载；
  `GlobalWorkerOptions.workerSrc` 指向同源路径可用，`Worker` 支持正常。
- 手写的最小 2 页 PDF（含 Type1 文字）渲染到 canvas 正常，
  `page.getTextContent()` 两页文本 `PAGE 1 contract body` / `PAGE 2 contract body` 正确抽取。
- 保存通道：`PDFDocumentProxy.saveDocument()`（`build/pdf.mjs:16748`）序列化
  `annotationStorage`（含 editor，见 `:6960`），并有 `AnnotationEditorType.STAMP`
  的 Stamp 图片编辑器。**局限**：输出的是 PDF 注释，可被删除/裁剪、无 `/BM`，
  不适用于印章/骑缝章语义 → 本项目不使用该通道。
- 文本层：`build/pdf.mjs` 内 `class TextLayer`；`web/pdf_viewer.mjs` 提供
  `TextLayerBuilder` / `renderTextLayer` / `setTextMapping`。
- 本地资产必需项（选项名在 `pdf.mjs` 中出现）：`cMapUrl`、`standardFontDataUrl`、`wasmUrl`。
  `wasm/` 内含 `jbig2.wasm`（扫描件 JBIG2）、`openjpeg.wasm`（JPX）、`qcms_bg.wasm`
  （色彩管理）、`quickjs-eval.wasm`。

### 1.2 画布合成能力（实测）

- `globalCompositeOperation` 全部 16 种混合模式可用：multiply / screen / overlay /
  darken / lighten / color-dodge / color-burn / hard-light / soft-light / difference /
  exclusion / hue / saturation / color / luminosity（+ `source-over`、`lighter`）。
- `ctx.filter` 支持，写入 `brightness(1.5) saturate(0.2)` 后回读一致。
- 结论：明度、饱和度、透明度、混合模式**全部由浏览器原生承担，无需任何 JS 依赖**。

### 1.3 落盘一致性（实测）

- 画布：`#d9e6ff` 底 + `multiply` 叠 `#c8181c` → **(170, 22, 28)**，等于逐通道
  `dst*src/255`（无色彩管理偏移）。
- 纯 Go stdlib 手写 PDF（`ExtGState <</BM /Multiply /ca 0.6 /CA 0.6>>` +
  Image XObject + `SMask`），经 pdf.js 渲染采样 → **(189, 106, 119)**，
  等于 `dst*0.4 + (dst*src/255)*0.6`。
- 结论：**预览像素 == 落盘后再次渲染的像素**，故预览即所见即所得；
  验证脚本按该公式断言即可（§8 验证要求）。

重跑记录（2026-10-29，`tools/verify/pixel-matrix.mjs --only=matrix`，在**应用的页面
里**跑，吃应用的 CSP、WebView2 同族渲染器；底 `#d9e6ff`、印章 `#c8181c` 实心 fillRect）：
- `multiply` × opacity 1.0 → **(170, 22, 28)**（与上面画布值完全一致，Δ 0）；
- `multiply` × canvas `globalAlpha = 0.6` → **(189, 105, 119)**：绿通道比上面
  PDF `/ca 0.6` 的 (189, 106, 119) 少 1/255。两条分别是**画布 alpha 通道**与
  **PDF 写入通道**的取整结果，差 1 是预期内 —— P4 的回读断言必须用 ≤1 容差。
- 16 个模式名全部被 canvas 接受（读回 `globalCompositeOperation` 与模式名比对；
  非法名会静默保留上一个 gco = 等于没混合，所以读回本身就是断言）；
- `lighten` / `saturation` 与这块底组合时**按数学就不改变像素**（底更亮 / 同饱和），
  「叠图必须变」不能当全模式断言；证明模式确实生效的用例是 `difference` × 1.0。

### 1.4 陷阱（实测复现）

- `ctx.filter` 是**上下文状态**：一次 `filter='brightness(1.5) saturate(0.2)'` 未复位，
  下一层 `multiply` 绘制结果变为 (54, 33, 25)（应为 (0,0,0)）。
  → 每层叠加必须 `save()/restore()` 或显式 `ctx.filter='none'`。
- 污染值随绘制路径变化：上面那组 (54, 33, 25) 出自已删除探针的 `drawImage` +
  半透明印章位图路径（不可就地重跑）。在本脚本的实心 `fillRect` + `multiply`
  路径下重跑（2026-10-29）污染为 **(100, 66, 75)**；复位后 `(170, 22, 28)` 恢复原值。
  结论不变：**污染的具体数值不重要，重要的是「filter 未复位会改变结果」这个机制**，
  所以回归用例必须固定自己的绘制路径并断言该路径的污染值。

- `getImageData` 前须确认已 `restore()`,否则采样到的是滤镜后的中间态。

### 1.5 CSP、静态响应头与 favicon(实测 2026-10-29,`tools/verify/shell-smoke.mjs`)

- `style-src 'self'` 会**阻止 CSSOM 写样式**:`el.style.setProperty(...)` 触发
  Chromium 报 `Applying inline style violates ... 'style-src 'self''`,面板宽度/预览
  transform 一类的动态样式全部失效。→ CSP 必须含 `style-src 'self' 'unsafe-inline'`
  (脚本面仍是 `script-src 'self'`,内联 `<script>` 依旧不可能;`web/embed_test.go`
  断言该指令)。
- Chromium 会自动请求 `/favicon.ico`(无 `<link rel="icon">` 时 404 → console 报错误)。
  本项目提供 `web/static/favicon.svg` + `<link rel="icon">`,该 404 消失。
- 未注册 verb 的 `/api/...` 路径会命中静态 pattern(`GET /`)→ ServeMux 直接回
  **405 + 纯文本 body**(不是我们的 envelope)。前端必须按 `http_<status>` 上报,
  不能报 `bad_json`(`web/static/app-api.js` 已区分;`shell-smoke` 断言 toast 含状态)。

### 1.6 WebView2 / COM(实测 2026-10-29,`tools/verify/comprobe`)

- `windows.CoInitializeEx(0, COINIT_APARTMENTTHREADED=0x2)` 在本机(Go 1.26.5 +
  `golang.org/x/sys/windows`)在**任意顺序**(锁线程前后)都返回
  `errno=0x1`,其 `Error()` 文案是**误导性**的 `Incorrect function.`。
  该 0x1 其实是 `S_FALSE`(=1,「COM 已被初始化」),被 `LazyProc` 当错误抛出;
  `S_OK=0` 才是成功。
- 因此 `host_webview_windows.go` 把 `errno(1)`(S_FALSE)与 `RPC_E_CHANGED_MODE`
  (`0x80010106`)都视为可容忍 —— 照 TinyRouter `host_webview_window.go:120-132` 的
  顺序 `LockOSThread` → `CoInitializeEx` → `defer CoUninitialize`(LIFO 次序不可改)。
- 实测 `-tags webview` 构建窗口正常:`tools/verify/webview-launch.mjs` 打印
  `msg="webview window opened"` 且页面在窗口内完成 `/api/health`、`/api/settings`
  请求(2026-10-29,`autostamp v0.0.0-…+dirty`)。
- 进程被 kill 后 WebView2 仍会**短暂锁定** profile 目录（`WEBVIEW2_USER_DATA_FOLDER`）：
  `rmSync(..., {maxRetries})` 在 12 次 × 250 ms 内仍可能 `EPERM`。因此
  `webview-launch.mjs` 的清理只重试后打一条 soft 警告（目录在 `%TEMP%` 下，不视为失败）。

### 1.7 P1 查看链路（实测 2026-10-29，`tools/verify/preview-smoke.mjs`）

- **pdf.js 取字节要自己带会话令牌**：`getDocument` 用 `httpHeaders` 送
  `X-AutoStamp-Session`；不带则 `/api/pdf/raw` 回 **400 `bad_session`**。该 header 同时
  出现在首个请求与后续 Range 请求上（第 2 页能渲染即为证）。
- **销毁句柄是 loading task，不是 `PDFDocumentProxy`**：6.4.299 的 `PDFDocumentProxy`
  **没有** `destroy()`；直接调用抛 `TypeError`，会让二次打开 / 口令重试整条链路崩。
  正确做法：保留 `getDocument()` 返回的 task，用 `task.destroy()`。
- **同一个 `PageProxy` 同时只能有一个 render**：分页 chip 的缩略图与主画布共用同一
  `PageProxy`，并发渲染会被 pdf.js 取消（实测缩略图 alpha 未满、ink=0）。因此缩略图
  **串行**渲染，且主渲染 `renderTask.promise` 未落定前不排队（`app-pager.js`）。
- **文本层对齐要用 `OutputScale.pixelRatio`**：canvas backing = viewport ×
  `OutputScale(pixelRatio=1)`（本机 dpr 1.25 → backing 490×694，CSS 392×555）；文本层须按
  该 scale 构建，实测层框宽 == 画布 CSS 宽（drift 0）。
- **fit 必须按容器宽算，且容器可能没有布局**：`html[data-state="empty"] #preview-stage`
  是 `display:none`，此时宽度 0 → 旧代码用 240 px 下限会算出错误 fit（0.403）。现规则：
  宽度测不到就不画（`state.pendingFit`），容器一有宽度由 `ResizeObserver` 重画；
  密度切换实测 fit **1.671 → 2.309**（1440×900，A4 = 595.3×841.9 pt）。
- **缩略图可见但不可读**：chip 内缩略图 56 CSS px 高（dpr 1 时 backing 40×56），A4 文字页
  在此尺寸下字形是亚像素 → 实测 ink=0（图片型样本 ink≈815）。因此该断言只能测
  「渲染跑完」（alpha 全覆盖），**不能**测「有字形」。
- **中文 CID 样本**（CDP `Page.printToPDF` 生成的中文 HTML）：渲染与 `getTextContent`
  正常（spans 24，marker 可抽），§6 的该 UNVERIFIED 项消项。
- 样本体积（现场生成，不落仓库）：英文 5 页 54,763 B / 中文 4 页 186,950 B /
  混合型 23,935 B / 图片型 3 页 46,043 B。

## 2. 后端库：`github.com/pdfcpu/pdfcpu v0.16.3`（2026-10-19，Apache-2.0，纯 Go）

`go.mod` 依赖：`spf13/cobra`、`google/jsonschema-go`、`hhrutter/tiff`、
`mattn/go-runewidth`、`xdg-go/stringprep`、`go.yaml.in/yaml/v3`、`x/crypto`、`x/image`、`x/text`
（cobra 属 CLI 面，走 `pkg/api` 时不在调用图上）。模块自身要求 `go 1.26.0` ✓。

### 2.1 印章 / 透明度 / 透明通道（实测）

- 生成图形状态字典（关闭 object stream 后直读对象文本）：
  `<</CA 0.600000000000 /Type/ExtGState /ca 0.600000000000>>` → **透明度精确落地**。
- 不透明 PNG → **无** `SMask`；环形（带 alpha）PNG → 1 个 `SMask` 软遮罩
  （`pkg/pdfcpu/model/image.go:161 createSMaskObject`、`:660 extractAlpha`）。
- 像素复核（红色页背景上叠蓝色实心方块，`opacity:0.6`）：中心 = **(120, 36, 120)**
  ＝ `seal*0.6 + bg*0.4`；环形印章的空心区与透明外区背景 (255,0,0) 未被污染；
  抗锯齿/半透明边缘像素 2638 个。
- 印章被包成 Form XObject（`Fm0`，`BBox[0 0 238 238]` 对应 `scalefactor:0.4` × 页宽 595）。
- 支持的印章图片扩展名（`pkg/pdfcpu/stamp.go:597`）：`.jpg .jpeg .png .tif .tiff .webp`。
- 参数键（`pkg/pdfcpu/stamp.go:73-96 wmParamMap`）：`position`、`offset`（两个数以空格分隔）、
  `scalefactor`、`opacity`、`rotation`、`diagonal`、`url`、`fontname`… 描述串语法为
  `key:value` 逗号分隔；也可直接改 `model.Watermark` 字段（`Opacity`、`Pos`、`Dx/Dy`、
  `Scale`/`ScaleAbs`、`Rotation`、`Image io.Reader`、`Update`）。
- `Update: true` 的替换路径实测通过 `ValidateFile`（UI 反复调参不会叠加多份印章）；
  锚点常量 `types.TopLeft…Center…Right…Full`（`types/anchor.go`）。

### 2.2 混合模式（实测）

- 全模块 grep：写路径**从不输出** `/BM`；`/BM` 只出现在
  `pkg/pdfcpu/validate/extGState.go:1142`（校验白名单，白名单即 PDF 表 136 全 16 项）。
- ⇒ 项目必须自写注入层（`internal/pdfcore/blend.go`）：在 pdfcpu 生成的 GS 字典上补
  `/BM /Name`（或直接自建 GS 字典 + Form 内容流 `gs`）。

### 2.3 切分 / 合并（实测）

- `api.CutFile(ctx, in, outDir, "p", nil, cut, conf)`；`model.Cut` 的 `Hor`/`Vert`
  **是相对分数 0..1**（>1 或 ≥1 报错：`cut point must be … < 1`）。
- 实测 595.000000x842.000000 →
  `Vert: []float64{0.5}` 得 `297.500000x842.000000` × 2（左/右）；
  `Hor: []float64{0.5}` 得 `595x421` × 2（上/下）。
- 坑①：`outDir` **必须预先存在**（pdfcpu 不创建目录，实测报 “The system cannot find the path specified.”）。
- 坑②：每个输出文件包含**原页 + 两块**（实测 `pages=3`，`dims=[595x842, 297.5x842, 297.5x842]`）
  → 必须 `Trim`/`ExtractPages` 丢弃未切的原页。
- 逐页半枚印章 + `api.MergeCreateFile` 合成 6 页产物（未剔原页所致）实测通过 `ValidateFile`，
  两页各自带正确半枚印章（bbox 实测 page2 `[69,442,297,841]`、page3 `[0,442,65,529]`）。

### 2.4 能力边界（实测）

- **无 rasterize**：全模块（含 `cmd`）grep `raster` 无匹配 → 页面渲染只能在浏览器做。
- **无文本抽取 API**：`api/extract.go` 只有 `ExtractImages* / ExtractFonts* /
  ExtractPages* / ExtractContent* / ExtractMetadata*`（Content 是原始内容流，非文字）。
- 加密字段：`Configuration.UserPW/OwnerPW/UserPWNew/OwnerPWNew`（RC4 40/128、AES 40/128/256）。
- 图片护栏默认 `MaxImagePixels=100MP`、`MaxImageBytes=512MB` —— 本项目要显式收紧。
- 写选项：`WriteObjectStream`、`WriteXRefStream`（设 `false` 可得可读明文对象，便于调试与断言）。

### 2.5 体积代价（实测）

- `baseline.exe`（空 Go 程序，strip）1,197,568 B；
  引入 `pkg/api`（`ImageWatermark`+`AddWatermarks`+`Validate`+`Cut`+`Merge`）探针
  strip 后 12,254,720 B → **净 +11.06 MB**（未 strip 17,147,392 B）。

## 3. 前端资产体积（`pdfjs-dist@6.4.299` tarball 实测）

获取方式（本机实测 2026-10-28，node v24.18.0 / npm 11.16.0）：
`npm pack pdfjs-dist@6.4.299` → `pdfjs-dist-6.4.299.tgz` = **8,539,589 B**（554 files），
`tar -xzf` 后目录名为 `package/`；命令全文见 `docs/IMPLEMENTATION_PLAN.md` P1「资产获取」。
（旧会话曾用 jsdelivr CDN 逐文件下载，同样可行；`npm pack` 更快更完整。）

|文件|原始|brotli(q6)|
|---|---|---|
|`build/pdf.min.mjs`|448 KB|118 KB|
|`build/pdf.worker.min.mjs`|1,235 KB|338 KB|
|`web/pdf_viewer.mjs`|312 KB|65 KB|
|`build/pdf.sandbox.min.mjs`|65 KB|19 KB|

目录体积（原始）：`cmaps` 1,140 KB、`wasm` 1,507 KB、`standard_fonts` 779 KB、
`image_decoders` 626 KB、`iccs` 15 KB。

- 最小集（core + worker + cmaps，含中文 CID 显示）≈ **2.8 MB**；
  加扫描图解码（`wasm`+`image_decoders`）≈ **5 MB**；全量 ≈ **5.98 MB**。
- `embed.FS` 不压缩 → 直接计入 exe 体积；传输层用 brotli/gzip 中间件即可
  （TinyRouter 的 `internal/api/compress` 模式，本项目 P0 自带同款中间件）。

## 4. 导出参数实测（纯 stdlib 写 A4 整页 JPEG）

|DPI|页面像素|q40|q75|q92|
|---|---|---|---|---|
|72|595×842|35,582 B|43,722 B|57,259 B|
|150|1239×1754|104,089 B|123,796 B|155,781 B|
|300|2479×3508|328,844 B|378,606 B|459,215 B|

- 该 stdlib writer（`/DCTDecode` + `q … cm /Im0 Do Q`）产物被 pdf.js 正确解析渲染
  （采样点 (241,230,238) 与 JPEG 内容一致，页数 1）。
- 同一 writer 亦输出过含 `SMask` + `ExtGState /BM /Multiply /ca 0.6` 的 2 页骑缝章 PDF，
  渲染采样见 §1.3。

### 4.1 骨架构建体积(实测 2026-10-29)

|构建|命令|strip 后|
|---|---|---|
|控制台构建|`go build -trimpath -ldflags "-s -w" .`|**6,912,512 B**(≈6.6 MB)|
|WebView2 构建|`go build -tags webview -trimpath -ldflags "-s -w" .`|**7,345,152 B**(≈7.0 MB)|
|未 strip(两种构建同法)|去掉 `-s -w`|9,782,784 B / 10,464,256 B|

- P0 阶段 `web/static` 只有壳(100 KB,无 PDF 资产),所以上面就是「Go + 壳 + WebView2
  绑定」的下界;P1 塞进 pdf.js 最小集(§3:core+worker+cmaps ≈ 2.8 MB)后,
  预计控制台构建 ≈ 8.4 MB、WebView2 构建 ≈ 9.9 MB。
- 复现:`powershell -NoProfile -File build.ps1`(带/不带 `-Tag webview`,带版本戳 +
  `winres` 图标资源)。

### 4.2 版本戳与身份(实测 2026-10-29)

- `GET /api/health` 返回 `{status,name:"autostamp",version,commit,go,os,arch}`;
  version 来自 `debug.ReadBuildInfo()` 的 VCS 戳(`v0.0.0-<ts>-<hash>[+dirty]`),
  前端据此确认端口上确实是本 App(`app-shell.js` 名称不匹配时告警)。
- 实测本机输出:`autostamp v0.0.0-20261029…+dirty go1.26.5 windows/amd64 (commit …dirty)`。

## 5. 复现方式

### 5.1 已在仓库内的探针(2026-10-29 起可就地重跑)

|命令|覆盖的本文编号|说明|
|---|---|---|
|`node tools/verify/ui-smoke.mjs`|§1.2 §1.3 §1.4|mock 的数值化 UI 校验(混合模式像素矩阵、`ctx.filter` 泄漏断言、切分几何、骑缝条带)|
|`node tools/verify/shell-smoke.mjs`|§1.5 §4.2|真实二进制 + headless Chromium:壳契约/CSP/`/api` 往返/i18n/状态机/深链|
|`node tools/verify/ui-contract.mjs`|UI 契约|`docs/ui/mockup.html` ↔ `UI_SPEC` ↔ `AGENTS §6` 三方字段一致|
|`node tools/verify/webview-launch.mjs`|§1.6|WebView2 构建真窗口启动(打印 `webview window opened` + 页内 `/api` 请求)|
|`go run ./tools/verify/comprobe [-window]`|§1.6|COM `CoInitializeEx` 返回值实测(三种顺序)+ 真窗口泵消息|
|`go run ./tools/genfix`|mock 资产|重生成 `docs/ui/fixtures/{page,seal}.png`|
|`node tools/verify/preview-smoke.mjs`|§1.1 §1.7|真 exe + headless：四类样本渲染、中文 CID 文本层、分页 chip/缩略图、`/api/pdf/raw` 会话边界 + Range|

### 5.2 尚未搬进仓库的历史探针

- §1.1-§1.4、§2、§3、§4 的原始数值来自一次性探针 `C:/tmp/pdfprobe/`(已删除,
  现不可就地重跑)。P1-P5 会把 PDF 相关断言重写进 `internal/pdfcore` 单测与
  `tools/verify/`(P2 像素矩阵、P3 切分几何、P4 回读一致性、P5 体积表),
  重跑后逐节标注重跑日期。
- 浏览器采样方式(历史):omp 托管 headless Chromium + jsdelivr 动态 `import()` +
  base6 内存喂入 PDF + `ctx.getImageData` 采样;现行做法改为
  `tools/verify/cdp.mjs`(直连本机 Chrome 的 CDP,无 npm 依赖)。

## 6. 未验证(UNVERIFIED)

（已消项：真实中文 CID 文本抽取在 §1.7 实测通过，2026-10-29。）
- `UNVERIFIED`:AES-256 加密 PDF 的读取+落盘链路。
- `UNVERIFIED`:更窄包(只用 `pkg/pdfcpu` 子集)的体积下界。
- `UNVERIFIED`:未安装 WebView2 Runtime 的机器的回退行为(窗口本身已在带 Runtime 的
  本机实测通过,见 §1.6)。
- `UNVERIFIED`:2 拼 1 扫描页的**自动**版面判定(启发式:MediaBox 纵横比 > 0.7 且横排即判 2 拼)
  —— P3 需带样本实测。
