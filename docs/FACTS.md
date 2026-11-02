# docs/FACTS.md — 实测事实（依赖与浏览器）

> 最后核对：2026-11-02（本机 Windows + Go 1.26.5 + Chrome 151 + WebView2 Runtime）。
> §1.2/§1.3/§1.4 由 `tools/verify/pixel-matrix.mjs`（2026-10-29）与
> `tools/verify/overlay-smoke.mjs`（2026-10-30）在仓库内重跑；§1.7 P1、§1.8 P2、
> §1.9 P4 回读、§2.3 切分、§2.6 落盘几何、§4 导出体积表（预估断言，见 §4 末）均可就地重跑，命令见 §5.1。
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

### 1.8 P2 叠加预览（实测 2026-10-30，`tools/verify/overlay-smoke.mjs`，分段 `--only=`）

- **canvas 读回是预乘 uint8**：半透明印章必须先显式预乘（`round(a*r/255)`）再用
  `source-over` 画；不预乘时 Chromium 会把「未预乘值」当预乘解，边缘出现暗环。
  alpha=89 的渐变印章在 `normal`×opacity 1.0 下四角读数精确落在
  `dst*(255-a)/255 + premul*a/255`（absdiff ≤ 1，样本 174,73,174）。
- **16 模式 × {1.0,0.6,0.3} 全部命中**：脚本在页内用同一套 PDF/SVG 混合公式独立重算
  一遍再与真实画布比对（不是只比上一轮输出）。非可分离分量模式（Hue/Saturation/
  Color/Luminosity）走 `rgb↔HSL` 互换，`soft-light` 用 W3C 分段公式 —— 与
  `ctx.filter` 的实现一致（因次两者互为参考，不是自证）。
- **去背（D4）实测**（样本：`docs/ui/fixtures/seal.png` 400x400 白底红印章）：
  alpha 覆盖 22%（未去背）→ 去背后 36%；600x600 渐变印章 alpha 76%、bbox 6..594、
  150 dpi → 353.19 pt。规则见 `UI_SPEC §8` D4：`min(R,G,B) >= 60` 视为彩色并保留
  alpha，白/灰置 0，边缘反算 `c -= (255-c)*min(255,255-min(c))/195`。一次性浏览器
  探针三例（探针已删，数值现由 `overlay-smoke --only=despill` 的 alpha 计数钉住）：
  98% → (255,166,240)@alpha 100%、100% → (220,0,0)@100%、90% → (280,0,0)@alpha 0%；
  去背后依次 → (220,0,0)、(220,0,0)、整块丢弃；反算系数实测 0.456 / 0.902 / 0。
- **骑缝条带（预览半边）**：`binding=right` 每页 1 条，宽 = 页宽 × 10%（样本页
  458 pt → 45.8 pt）；`startOffset`（pt）位移**误差 0**；`alternate` 奇右偶左且
  条带数 == 页数；逐页取印章不同列 → 与「整枚印章切 N 刀」按列对齐（≤1 px）；
  `binding=none` → 0 条。坐标原点（C1 未评审默认）：`offset`/`pos`/手柄/条带一律
  **左上原点、y 向下**（PDF pt），与 `#preview-ruler` 一致。
- **V3 陷阱（滚轮缩放）**：光标落在**选中实例内部**时 wheel 被实例吃掉，若事件继续
  冒泡到 `#preview-stage`，通用 wheel 会改 `zoom` 并整页重渲染，实测 `apply.scale`
  读数被后写覆盖（旧行为 NaN→缺键）。→ `app-overlay.js:consumeWheel` 里
  `stopPropagation()`，实例不缩放时同样不冒泡。
- **range 输入会被步进规整**：`quality` 滑杆 `min=40 max=95 step=5`，脚本写 92 时
  Chromium 回读 **90**（滑杆与数值框同步后同值）→ UI 只能表达 `40+5n`；预估与落盘
  一律按该值。自定义 DPI（96..600，任意整数）走另一条输入框。
- **体积预估 == FACTS §4 表**（前端派生、不请求，UI_SPEC E1）：150dpi q75 每页
  123,796 B ±2%；300/150 dpi 比值 3.06 ±0.12；q40 行 328,844 B ±2%；页面积按
  MediaBox 面积 / A4 面积缩放；`vector` 完全忽略 DPI/质量；离表 DPI 在相邻两行间
  按对数插值（200 dpi 落在 150/300 行之间 ✓）。

### 1.9 P4 落盘回读与快照身份（实测 2026-11-02，`tools/verify/apply-smoke.mjs`，分段 `--only=`）

- **回读像素矩阵 48 组全过**：`盖到 PDF` 后把 applied 资产交给 pdf.js 重渲染，取样像素
  等于同一对颜色在同族渲染器里独立 blend 的参考值。实测最大 Δ = **2**（@ hard-light × 0.6），
  阈值 ≤ 2；样本底 (217,230,255)、印章 `#c8181c` (200,24,28)。
- **叠加层的快照必须按「画布元素」识别**（不是按 page/scale/size）。`app-preview.js:renderCurrent`
  每次渲染都新建 `canvas.page-canvas` 并 `stage.replaceChildren(frame)`，所以画布元素身份
  = 文档身份的信号。旧的 key（`page|scale|dpr|canvas.width|canvas.height`）看不到「文档换了」：
  盖章前后同一页、同一 zoom、同一尺寸 → key 不变 → `repaint()` 把**上一份文档的位图**
  重新画回新画布。实测（改前）落盘后的画布**整页 0 命中**印章色（6 pt 步长扫全页），
  而同一份 applied 字节在独立 pdf.js 里渲染命中 7,921 px、首个印章像素在 (150,300)；
  改成按元素识别后：DOM 画布命中 21,904 px、首个像素 (251,502) = pt(150,300) × 1.67 ✓。
- 因此验收脚本取样前必须 `preview.redraw()` 一次（它才是「换画布」的事件）；不 redraw
  读到的是旧文档的位图。`sample(..., 'page')` = 快照（未叠加），`'composite'` = 画布。
- **pdf.js 三种读法一致**：`data:` 直喂字节 / `url:` + `httpHeaders`（会话令牌）/ 真 UI 画布，
  三者像素相同（同一份 applied 文件）→ 落盘产物与预览所见等同（需求 4 的落盘面）。
- **骑缝落盘**（两页样本 + 水平双色印章）：页 1 条带 = 印章**左**半 (24,190,70)、
  页 2 = 右半 (210,40,90)，Δ 0；条带 59.50 × 59.50 pt，x ∈ [535.5, 595.0]，y ∈ [40, 99.5]，
  四边误差 ≤ 1 pt（框内是印章、框外 2 pt 是底）。
- 落盘文件字节数（样本）：单页 applied 2,267 B；两页（切分+盖章）applied 3,240 B。
- **落盘后的 PDF 里印章是 `/Artifact <</Subtype /Watermark /Type /Pagination >>BDC … EMC`**，
  pdf.js 正常渲染该标记内容（上面 48 组就是证据）。但 pdfcpu 写文件默认用 object stream +
  FlateDecode：直接对原始字节 grep `/Watermark`、`/Fm0`、`cm /GS0` 全部**找不到**
  （`objstm=true`、`flate=true` 实测），要读内容只能用 pdfcpu 自己的路径
  （`ctx.PageContent` / `pdfcpu.ExtractPageContent`），别用字节文本搜索下结论。

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

重跑补充（2026-10-29；`internal/pdfcore/split.go` + `split_test.go`，永久断言在那）：

- 签名全是 `ctx` 打头：`CutFile(ctx, inFile, outDir, outFile, selectedPages []string, *model.Cut, conf)`、
  `ExtractPagesFile(ctx, inFile, outDir, selectedPages, conf)`（**写到 outDir**，一页一个文件，
  不是往某个 dst 写）、`PageCountFile(ctx, file)`、`MergeCreateFile(ctx, files, outFile, dividerPage bool, conf)`、
  `ValidateFile(ctx, file, conf, *api.ProgressOptions)`（末参数可 nil）。`model.Cut` 的字段就叫 `Hor`/`Vert []float64`。
- 产物命名实测：`CutFile(base="pg", pages=["3"])` → 每页**一个**文件 `pg_page_3.pdf`（内容 = 原页 + 全部切块）；
  再按页抽取 → `pg_page_3_page_2.pdf`（`<inBase>_page_<n>.pdf`）。按名内页号升序读就是 reading order
  （骑缝章条带顺序依赖它）。
- **切分空间是「旋转归一后」的**：`/Rotate 90` 的 595x842 页切出 842x595 且 `rot=0`；
  `Vert:[0.5]` 给两块 **421x595**，`Hor:[0.5]` 给 842x297.5。所以 UI 的「左右切」恒为 `Vert`，
  **不能按 `/Rotate` 交换轴**（换了就切错方向，块变 842x297.5）。
- 自动启发式的实际判定（`cutPlanForPage`）：`w/h > 0.7` 且 `w > h`（display 空间，即归一后）→ 判 2 拼、`Vert:0.5`；
  否则该页不参与。实测 A4 portrait 三页不误切（`pageCount` 不变）；第 3 页 `/Rotate 90` 会被切。
  `splitVeto=true` → 完全不切（`TestSplitAutoVetoKeepsPages`）。真实扫描样本的版面判定仍 `UNVERIFIED`（见 §6）。

- 切分**不会**改动原资产：新资产 kind=`split` 另存，旧资产照旧可 `/api/pdf/raw` 取回
  —— 这就是 UI「撤销切分」不需要 undo 栈的原因。

加密 PDF 的切分：`/api/pdf/split` 走同一 `inspectAsset`，受保护文档会回
`password_required`/`password_invalid`（前端已有的口令通道）。切分请求本身没有 `pw`
字段（词表已冻结），所以口令只能从已打开的那次 open 带过来；这一条属 P7 加固项。


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

### 2.6 落盘几何与放置语义（实测 2026-11-02，`internal/pdfcore/apply.go` + `apply_test.go`）

- `model.Watermark{Pos: types.BottomLeft, Dx, Dy, Scale, ScaleAbs: true, InpUnit: types.POINTS}`
  写出的内容流是 `q 1 0 0 1 Dx Dy cm /GS0 gs /Fm0 Do Q`：`Dx/Dy` = **MediaBox 空间**（y 向上）
  里 Form 的左下角。把 UI 的「左上原点、y 向下」换算过去只需要一次 y 翻转：
  `Dy = dispH - box.Y - box.H`，**不含任何旋转量**（实测见下条）。
- 实测（595x842 一页、`scale .15`、`anchor tl`、`offset 150,300`）：写入
  `150.00000 452.75000` → 按 `dispH - 300 - 89.25` 计算 ✓；pdf.js 独立渲染后印章框落在
  display (150,300)-(239,389)，首个印章像素在 (150,300) ✓（scale 1 渲染，命中 7,921 px）。
- **条带框的纵横比来自「整枚印章」，不是切片**：595x842、`scale .2`、`startOffset 40`、
  整枚 60x30（比 0.5 → 切片 30x30，比 1）→ 正确写入 `535.50000 742.50000`
  （= `595 - 119/2`、`842 - 40 - 119*0.5`）；若按切片的比算，框高变成 119，写入变成
  `535.5 683`（低了一整个条带高）—— 断言 `TestStampStripBoxUsesWholeSealAspect` 钉死，
  变异试验（把切片比塞回去）实测 FAIL。
- `OnTop: true` + `Mode: WMImage`：印章在页面内容之上；pdfcpu 会把整页内容
  （含印章的 Artifact 块）包进 `/Rotate` 归一包装（`model.Watermark.PageRot` +
  `ContentBytesForPageRotation`，源码实测），所以 `Dx/Dy` 说的是**显示空间**的数，
  旋转只是那层包装的事。**印章落在 `/Rotate 90` 页面上的落盘实测仍 `UNVERIFIED`（§6）**。
- 一次 pass 的约束（已登记 AGENTS §5.16）：pdfcpu 的 `AddWatermarksSliceMap` 对同一页
  要求外观一致（`Opacity` 不同会拒绝：实测报 “inconsistent Opacity: got 1, want 0.6”），
  所以按 `(blend, opacity)` 分组多次 pass；每组各得自己的 GS 字典 ✓（`apply_test.go` 断言）。

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

- 前端「体积预估」（UI_SPEC E1，纯前端派生、不请求）按本表 × MediaBox 面积 / A4 面积
  缩放。重跑（2026-10-30，`node tools/verify/overlay-smoke.mjs --only=export`）：
  150dpi q75 每页 == 123,796 B（±2%）、300/150 比值 == 3.06、q40 行 == 328,844 B
  （±2%）；离表 DPI 在相邻两行间按对数插值；`vector` 模式不受 DPI/质量影响。

### 4.1 骨架构建体积(实测 2026-10-29)

|构建|命令|strip 后|
|---|---|---|
|控制台构建|`go build -trimpath -ldflags "-s -w" .`|**6,912,512 B**(≈6.6 MB)|
|WebView2 构建|`go build -tags webview -trimpath -ldflags "-s -w" .`|**7,345,152 B**(≈7.0 MB)|
|未 strip(两种构建同法)|去掉 `-s -w`|9,782,784 B / 10,464,256 B|

- P0 阶段 `web/static` 只有壳(100 KB,无 PDF 资产),所以上面就是「Go + 壳 + WebView2
  绑定」的下界;P1 塞进 pdf.js 最小集(§3:core+worker+cmaps ≈ 2.8 MB)后,
  曾**预估**控制台构建 ≈ 8.4 MB、WebView2 构建 ≈ 9.9 MB —— 该预估已被下面的实测取代。
- 复现:`powershell -NoProfile -File build.ps1`(带/不带 `-Tag webview`,带版本戳 +
  `winres` 图标资源)。

**重跑(2026-11-02,P4 全量:pdfcpu + pdf.js 全量资产 + P2/P4 前端)**:

|东西|命令|实测|
|---|---|---|
|WebView2 strip 二进制|`build.ps1 -Task stripped`(`-tags webview -trimpath -ldflags "-s -w"`)|**20,059,648 B**(≈19.1 MiB)|
|控制台二进制(未 strip)|`go build -o dist/autostamp.exe .`|25,159,168 B|
|`web/static` 全量|`Get-ChildItem -Recurse web\static \| Measure-Object -Sum`|5,725,434 B|

- 相对 P0 骨架(7,345,152 B)的**净增 12,714,496 B**,其中内嵌前端资产 5,725,434 B、
  其余 ≈6.99 MB 是 pdfcpu 子集 + `pdfcore` + P2/P4 后端。§2 的「整包 `pkg/api` 净增
  11.06 MB」是**上界**(探针拉了全部子包),本项目只 import 用得到的子集,实测更低。
- 复现:`powershell -NoProfile -File build.ps1`(末尾 `sizes` 段直接列 `dist` 体积)。

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
|`node tools/verify/pixel-matrix.mjs`|§1.3 §1.4|混合模式 × 透明度像素矩阵 + filter 污染断言（P2 重跑来源；本机 Chrome 151）|
|`node tools/verify/overlay-smoke.mjs [--only=<open\|geometry\|despill\|drag\|strip\|filter\|export>]`|§1.3 §1.8|真 exe + 真 UI：上传印章→16 模式×{1.0,0.6,0.3}（页内独立重算比对）、去背 meta 计数、几何/拖拽/四角/旋转/滚轮、骑缝条带、`ctx.filter` 复位、导出体积预估 == §4|
|`go test ./internal/api -run 'Seal'`|§2.1 §1.8|`/api/pdf/seal/prepare` 词表 + `/api/pdf/seal/raw` 只发印章资产（owner 绑定）|
|`go test ./internal/pdfcore -run 'PrepareSeal'`|§2.1|`PrepareSeal`/`SealMeta`/`SealBox`（去背/裁剪/重采样的后端等价实现，供对照）|
|`go test ./internal/pdfcore -run 'Split'`|§2.3|切分词表 + 页尺寸断言（A4→297.5x842；`/Rotate 90`→421x595）|
|`go test ./internal/api -run 'Split'`|AGENTS §6/§8.2|`/api/pdf/split` 的响应形状、词表 400、owner 边界、原资产仍可读|
|`node tools/verify/apply-smoke.mjs [--only=<matrix\|strip\|chain\|undo>]`|§1.9 §2.6|真 exe + 真 UI：`盖到 PDF` → applied 资产重渲染的 48 组像素矩阵、骑缝落盘逐页半枚 + 条带 bbox 四边、切分→盖章→保存链（磁盘文件再 open）、撤销盖章/撤销切分|
|`go test ./internal/pdfcore -run 'Stamp'`|§2.2 §2.6|落盘写 `/BM`+`/ca`、多外观分 pass 各得自己的 GS、页面自己的 GS 不被污染、条带框比来自整枚印章（`TestStampStripBoxUsesWholeSealAspect`）、非法请求拒绝|
|`go test ./internal/api -run 'Apply\|Save'`|AGENTS §6|`/api/pdf/apply` 词表 + owner 边界 + 400 分类；`/api/pdf/save` 目标三选一、`Origin` 继承、原子写|

### 5.2 尚未搬进仓库的历史探针

- §1.1-§1.4、§2、§3、§4 的原始数值来自一次性探针 `C:/AutoStamp/_scratch/pdfprobe/`
  （**仍在**，不是「已删除」——早先这句写错了；2026-10-29 实测：`pdfprobe/main.go`
  + `sample.pdf`/`cmap.pdf`/`cn.pdf`/`image3.pdf` + `go.mod`，`go run .` 可直接跑）。
  仓库内对应断言进度：§1.1-§1.4 → `pixel-matrix.mjs` / `preview-smoke.mjs` /
  `overlay-smoke.mjs`（P2 全绿，§1.3/§1.4 标注重跑日期）；§2.3 切分几何 →
  `internal/pdfcore/split_test.go`；§2.1 印章 prepare/raw → `internal/api` +
  `internal/pdfcore` 测试；§4 的**缩放规则**由 `overlay-smoke --only=export` 钉住
  （字节表本身仍是探针数值）；§2 的 `/BM` 注入 + 落盘几何已搬进仓库（§2.6 +
  `internal/pdfcore/apply_test.go`，2026-11-02）。
- 浏览器采样方式(历史):omp 托管 headless Chromium + jsdelivr 动态 `import()` +
  base64 内存喂入 PDF + `ctx.getImageData` 采样;现行做法改为
  `tools/verify/cdp.mjs`(直连本机 Chrome 的 CDP,无 npm 依赖)。

## 6. 未验证(UNVERIFIED)

（已消项：真实中文 CID 文本抽取在 §1.7 实测通过，2026-10-29。）
- `UNVERIFIED`:AES-256 加密 PDF 的读取+落盘链路。
- `UNVERIFIED`:更窄包(只用 `pkg/pdfcpu` 子集)的体积下界。
- `UNVERIFIED`:未安装 WebView2 Runtime 的机器的回退行为(窗口本身已在带 Runtime 的
  本机实测通过,见 §1.6)。
- `UNVERIFIED`:2 拼 1 扫描页的**自动**版面判定（启发式：MediaBox 纵横比 > 0.7 且横排即判 2 拼）
  —— P3 需带样本实测。
- `UNVERIFIED`:去背规则（§1.8）对**白底照片类印章**会把整图判为白→丢弃；三种红印章
  情形（98%/100%/90%）已实测通过，照片类只有「关掉 `seal.prepare.despill`」这条出路，
  是否需要按色相分档尚未评审。

- `UNVERIFIED`:印章落在 `/Rotate 90` 页面上的落盘几何 —— pdfcpu 的 `PageRot` +
  `ContentBytesForPageRotation` 旋转包装是源码读过的，但没有跑过「旋转页 + 印章 →
  pdf.js 回读」的像素断言（P4 的矩阵样本全是 `rot=0` 页）。
