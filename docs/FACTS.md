# docs/FACTS.md — 实测事实（依赖与浏览器）

> 最后核对：2026-10-28（本机 Windows + Go 1.26.5 + headless Chromium 151）。
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

### 1.4 陷阱（实测复现）

- `ctx.filter` 是**上下文状态**：一次 `filter='brightness(1.5) saturate(0.2)'` 未复位，
  下一层 `multiply` 绘制结果变为 (54, 33, 25)（应为 (0,0,0)）。
  → 每层叠加必须 `save()/restore()` 或显式 `ctx.filter='none'`。
- `getImageData` 前须确认已 `restore()`，否则采样到的是滤镜后的中间态。

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

## 5. 复现方式（探针已删除，需重写）

- 本文事实来自一次性探针 `C:/tmp/pdfprobe/`（`inpdf` 生成输入 PDF；
  `stampprobe`/`jpprobe` 纯 stdlib 写 PDF；`pcprobe`/`pc2` 走 pdfcpu 的
  `ImageWatermark`+`AddWatermarks`+`Validate`+`Cut`+`Merge`）。
  **该目录已在清理步骤删除**（现已不存在），因此 §1–§4 的数值目前是
  「已观测、不可就地重跑」的状态。
- 浏览器采样方式：omp 托管 headless Chromium（`browser.open` → `tab.run` →
  `page.evaluate`），`pdfjs-dist` 从 jsdelivr 动态 `import()`，PDF 以 base64 在内存喂入，
  采样用 `ctx.getImageData(...).data[i..]`。
- 正式实现时（P0/P1）把这些探针**重写进仓库** `tools/verify/` + `internal/pdfcore` 单测，
  重写后本文各节须逐项重跑并标 `重跑日期`；未重跑前不得把任何结论当作可直接依赖的新事实。

## 6. 未验证（UNVERIFIED）

- `UNVERIFIED`：真实中文 CID 字体的 PDF 文本抽取质量（依赖 `/ToUnicode`；cmaps 只解决渲染）。
- `UNVERIFIED`：AES-256 加密 PDF 的读取+落盘链路。
- `UNVERIFIED`：更窄包（只用 `pkg/pdfcpu` 子集）的体积下界。
- `UNVERIFIED`：未安装 WebView2 Runtime 的机器的回退行为（预期：自动降级为系统浏览器）。
- `UNVERIFIED`：2 拼 1 扫描页的**自动**版面判定（启发式：MediaBox 纵横比 > 0.7 且横排即判 2 拼）
  —— P3 需带样本实测。
