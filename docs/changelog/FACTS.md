# docs/changelog/FACTS.md

> `docs/FACTS.md` 的变更叙述历史（最新在上）。正文只留当前态事实。

## 2026-11-10 — §1.10 重算为 CS2 链序 + alpha 覆盖提升（UI8 轮）

契约公式 ×bright → pow(ink)+`a′=255·(a/255)^(1/g)` → sat；金值表重钉（ink3 (123,1,1)、alpha 137→207、链 bright1.5→g3→sat0.5 → (156,30,30)）；identity 只在不烘色时短路，ink≠1 走 alpha lift。复现命令不变。

## 2026-11-10 — §5.1 shell-smoke 行扩 tooltip 断言（UI6 T1）；无新增实测表

`docs/FACTS.md`：头「最后核对」换成 UI6 轮；§5.1 的 `shell-smoke.mjs` 行描述追加 tooltip 浮层断言（show/hide、title 摘挂、aria-label 恒定、反色 token、8px/12.5px 读数）。本轮**无新增实测表**：两主题正文对比 ≥4.5:1 是 ui-ux-pro-max skill pro-rules 的 WCAG 计算值（亮 muted 5.5–6.0、暗 7.2 等），非浏览器实测采样，已在 §5.1 头部注明。

## 2026-11-10 — §1.10 新增：调色烘焙「预览 == 落盘」金值与端到端（UI5-B2）

- 新增 §1.10（UI5-B2，实测 2026-11-09）：契约公式顺序（pow→×brightness→CSS saturate 矩阵
  0.213/0.715/0.072，每步 clamp、末步 round、alpha 不变）+ 落盘链序（调色→旋转→切条）+
  `adjust_test.go` 金值表（fixture (200,40,40)：g=3→(123,1,1)、bright 1.5→(255,60,60)、
  sat 0→(74,74,74)、链 g=3→bright1.5→sat0.5→(113,21,21) 等）+ identity(1,1,1) 字节恒等 +
  JPEG 进 PNG 出（Δ ≤ 2）。
- 端到端：`apply-sm --only=color`（ink 2.2 / bright 0.8 / sat 1.5）落盘回读 == 公式独立重算
  (111,18,53) Δ ≤ 3；Go 侧 `apply_test.go` `ExtractImagesFile` 直读位图独立重算 ±1。
- §5.1：`apply-sm` 行 token 补 `perpage|color`、引用 §1.10；头「最后核对」= UI5-B2。


## 2026-11-03 — §4.3 新增：UPX 极限压缩实测（`buildm.ps1`）

- 输入 20,226,048 B（webview+strip）→ `upx --ultra-brute` 6,157,312 B（30.44%，98.5 s）；
  `--best --lzma` 同字节尺寸只 9.5 s ⇒ brute 零增益，`-Fast` 档写进脚本。
- 门槛两道（`upx -t` + 真启动 `/api/health`）登记进正文；UPX 5.0.2 × Go 1.26.5 无破坏。
- 坑登记：打包后 `go version -m` 读不出 commit；AV 按 UPX 打包器签名误报风险。

## 2026-11-02 — §2.7 新增：原生目录选择器实测（批处理输入 BM1）

- 实测对象：PowerShell `-STA` 下的 `System.Windows.Forms.FolderBrowserDialog`
  （`New-Object` 成功、默认 `SelectedPath` 空、`Description` 存在）= P6 目录输入的
  选择器形态（AGENTS §6 `POST /api/fs/pick{dir:true}`）。
- 复现方式写进正文（`powershell -NoProfile -STA -Command` 三行反射探针）；常驻断言
  = `internal/fsx/pick_windows_test.go` 的 `TestFolderPickScriptShape`（必须出现
  `FolderBrowserDialog`/`SelectedPath`，必须不出现 `OpenFileDialog`）。
- 取消语义沿用 P1：`exit 3` ⇒ `ErrPickCancelled` ⇒ 前端 `{cancelled:true}`。

## 2026-11-02 — P5 实测：§4 真链路块、§4.1 体积重跑、§5.1 加 export-smoke

- §4 加「真链路实测（`export-smoke.mjs`）」块：`bytesPerPage` = 141,139 / 143,019 B
  （前端是 Chromium JPEG 编码器）、导出文件 285,313 B 落在 150dpi q75 行的 ±40% 带、
  页 pt `594.72 × 841.92` Δ 0.000、回读同点像素 Δ (1,-1,0)、vector 零请求、
  W6 预估 156,651,960 B/页 → 只出 warn 且零请求、pdfcpu `ValidateFile` 对手写 raster PDF 通过。
- **原验收的 ±5% 作废，改成 ±40% 量级**：表值来自 Go `image/jpeg` 编码的一张合成图
  （探针重跑 = 89,400 B），前端编码器与样本内容都不同，两者本来就不会对齐。
- §4.1 体积重跑（P5 全量）：strip 20,111,872 B / 控制台未 strip 25,229,312 B /
  `web/static` 5,731,945 B；相对 P0 骨架净增 12,766,720 B。
- §5.1 登记 `export-smoke.mjs`（分段 `--only=<raster|vector|guard|chain>`）。
- §4 补「保存幂等」条目(二次保存不重光栅化 = export 请求 0 次;改参数后 1 次 + 新 asset),
  并记下连续保存的唯一可靠完成信号是请求本身(`save` 回显同一 assetId)。

## 2026-11-02 — P4 实测：新增 §1.9（回读一致性）与 §2.6（落盘几何）

- 新增 **§2.6**（落盘几何，2026-11-02 重跑）：`model.Watermark` 的 `Pos:BottomLeft` +
  `Dx/Dy` 写在 MediaBox 空间（y 向上），换算只有 `Dy = dispH - box.Y - box.H`，
  **不加旋转量**（pdfcpu 自己用 `PageRot` + `ContentBytesForPageRotation` 包掉 `/Rotate`）；
  条带框的**纵横比必须取自整枚印章**（`SealAspect`），否则切条后会把半枚印成 1:1。
  实测写进内容流的 `cm` 数字：普通实例 `150.0/452.75`，骑缝条带 `535.5/742.5`。
- 新增 **§1.9**（回读一致性）：applied 资产重新喂 pdf.js，同一对颜色在 pdf.js 里独立
  blend 与真实落盘像素一致 → 16 模式 ×{1.0,0.6,0.3} 的 48 组**最大 Δ = 2**
  （@ hard-light ×0.6，阈值 ≤2；取印章框中部避开抗锯齿）。
- §2.2 补记：pdfcpu v0.16.3 写出的 GS 确实带 `/BM` + `/ca`（注入是 `/BM` 的唯一出口）；
  页自身的 ExtGState 不得重写（`TestStampDoesNotTouchPageOwnStates`）；内容流里 GS 标签
  紧贴 `>>`（`/GS0 <<BDC` 无空格），token 扫描器按此实测。
- §6.1 新增两行 UNVERIFIED：400 dpi 印章位图回读、A4 面积页 300 dpi 预估（矩阵样本非 A4）；
  既有 `/Rotate 90` 盖章页项保留。
- §5.1 登记 `tools/verify/apply-smoke.mjs`（分段令牌 `--only=<matrix|strip|chain|undo>`）。
- §4.1 加「重跑（2026-11-02，P4 全量）」表：WebView2 strip **20,059,648 B**、控制台未
  strip 25,159,168 B、`web/static` 5,725,434 B；相对 P0 骨架净增 12,714,496 B，并说明
  §2 的 11.06 MB 是「整包 `pkg/api`」上界（本项目只 import 用到的子集）。P1 的 8.4/9.9 MB
  预估值标注为「已被实测取代」。

## 2026-10-30 — P2 实测：新增 §1.8、§4 预估重跑、§5.1 加脚本、§6 加两条 UNVERIFIED

- 新增 **§1.8**（P2 实测，全部由 `tools/verify/overlay-smoke.mjs` 就地重跑）：
  canvas 读回是**预乘 uint8**（必须显式预乘，否则出暗环）；16 模式 ×{1.0,0.6,0.3}
  与页内独立重算逐点比对（`soft-light` 用 W3C 分段公式 = `ctx.filter` 的实现）；
  去背三例 (255,166,240)/(220,0,0)/(280,0,0) 与反算系数 0.456/0.902/0；条带几何
  （宽 = 页宽 10%、`startOffset` 位移误差 0、`alternate` 条带数 == 页数、逐页列对齐 ≤1 px）；
  **V3 滚轮陷阱**（光标在选中实例内时 wheel 必须 `stopPropagation`，否则 stage 的通用
  wheel 会改 zoom 并重渲染，`apply.scale` 读数被后写覆盖）；`range` 步进会被 Chromium
  规整（写 92 → 回读 90，UI 只能表达 40+5n）。
- §4 加「体积预估」条目：按本表 × MediaBox 面积/A4 面积缩放，重跑命令与数值（±2%）。
- §5.1：加 `overlay-smoke.mjs`（分段 `--only=`）、`gen-i18n` 行、`go test ./internal/api
  -run Seal` / `./internal/pdfcore -run PrepareSeal` 两行；§5.2 进度行同步。
- §6：新增 `UNVERIFIED` —— 去背规则对**白底照片类印章**会把整图判白丢弃（三种红印章
  情形已实测通过，照片类只能关选项）。

## 2026-10-30 — §5.1 加 `gen-i18n.mjs`：文案唯一来源是 mock 的内嵌 JSON 字典

- §5.1 的 `gen-i18n.mjs` 行原写「从 `docs/ui/mockup.html` 生成」正确，但**易踩坑**：
  它读的是 mock 里 `id="i18n-dict"` 的 JSON 块，**不是** `UI_SPEC §4` 表。只改 §4 表不会
  进目录；必须在 mock 的字典 + 标记里加键，再 `node tools/verify/gen-i18n.mjs` 重生成，
  然后**重编 exe**（`app-i18n.js` 是 embed 资产）。本轮实测：`seal.err.type` /
  `seal.err.nosource` 只加进 §4 时 `shell-smoke` 报「壳解析不出该键」，补进 mock 字典后
  196 键才三方一致（`ui-contract` / `ui-smoke` / `shell-smoke` 同绿）。
## 2026-10-29 — P3 切分重跑 + §2.3 字段名纠正

- §2.3「重跑补充」：`CutFile/ExtractPagesFile/PageCountFile/MergeCreateFile/ValidateFile`
  的实测签名（全部 `ctx` 打头；`ExtractPagesFile` **是写到 outDir**，一页一个文件）、
  产物命名（`<outFile>_page_<n>.pdf`、`<inBase>_page_<n>.pdf`）以及关键事实
  **切分空间 = 旋转归一后**：`/Rotate 90` 的 595x842 切成 421x595（`Vert`），
  `Hor` 给 842x297.5。所以 UI 的「左右切」恒为 `Vert`，**不能按 `/Rotate` 交换轴**。
- §2.3 早先那句「`model.Cut` 没有 `Hor`/`Vcut`」是凭记忆的错话：实测字段名
  `Hor`/`Vert []float64`（分数）。已改正。
- §5.1 补 `pixel-matrix.mjs` 与 `go test -run 'Split'`（pdfcore / api）两行；
  §5.2 写清历史探针目录的实际路径（`_scratch/pdfprobe/`，可 `go run`）与仍未搬的断言。
- 永久断言落点：`internal/pdfcore/split_test.go`（几何 + 词表）与
  `internal/api/split_test.go`（路由响应/词表 400/owner 边界/原资产仍可读）。

## 2026-10-29 — P2 印章通道：探针目录事实纠正 + §1.3/§1.4 重跑

- §5 探针目录那条改成「已入库」：仓库里的探针是 `tools/verify/{cdp,shell-smoke,ui-smoke,
  ui-contract,webview-launch,preview-smoke,pixel-matrix,gen-i18n}.mjs` + `tools/verify/comprobe`
  （早前会话记的「已删除」是未提交状态下的记忆错误，本次实测纠正；§5.1 的清单才是准的）。
  §7.1 的 CSP 未验证项随之闭合：`web/embed.go` 的 CSP 已带 `'unsafe-inline'` + `data:`，
  并有 `web/embed_test.go` 断言。
- §1.3 加重跑记录（`tools/verify/pixel-matrix.mjs --only=matrix`，应用的页面内跑，
  底 `#d9e6ff` 叠实心 `#c8181c`）：`multiply`×1.0 → (170,22,28) 与旧记录一致；
  canvas `globalAlpha=0.6` → (189,105,119)，绿通道比 PDF `/ca 0.6` 那条少 1/255。
  **推论用于 P4**：「预览 == 落盘再渲染」的回读断言只能取 ≤1 容差，不能要求逐字节等。
- §1.4 加第二条：污染数值跟绘制路径走（旧 (54,33,25) 出自已删除探针的 `drawImage`
  路径；本次实心 `fillRect`+`multiply` 路径重跑得 (100,66,75)，复位后回 (170,22,28)）。
  回归用例断言的是机制，不是具体数值。
- §1.2 补：模式名有效性必须靠读回 `globalCompositeOperation` 验（非法名 canvas
  静默保留旧 gco，等于没混合）；`lighten`/`saturation` 与这块底组合时按数学就
  不该改变像素 —— 「叠图必须变」不能当 16 模式的通用断言，`difference` 才行。

## 2026-10-29 — P1 实测：新增 §1.7，§5.1 补探针，§6 消一项

- 新增 §1.7（P1 查看链路，`tools/verify/preview-smoke.mjs`）：pdf.js 必须用 `httpHeaders`
  带 `X-AutoStamp-Session`（缺则 `/api/pdf/raw` 回 400 `bad_session`）；`PDFDocumentProxy`
  **没有** `destroy()`，销毁句柄是 `getDocument` 返回的 task；同一 `PageProxy` 同时只允许
  一个 render（并发会被取消 → 缩略图只能串行）；文本层要按 `OutputScale.pixelRatio`
  构建才有 drift 0；`display:none` 的容器宽度为 0，不能据此算 fit（旧代码用 240 px 下限
  算出 0.403）；56 px 高的 chip 缩略图里文字是亚像素（ink=0），断言只能测 alpha 覆盖；
  中文 CID 样本渲染/抽取正常（spans 24）；四类样本体积。
- §5.1 增加 `preview-smoke.mjs` 行（覆盖 §1.1 §1.7）；§6 的「真实中文 CID 文本抽取质量」
  改为消项说明。
- §1.6 补一句：进程被 kill 后 WebView2 仍短暂锁定 profile 目录，`rmSync(maxRetries)`
  12×250 ms 仍可能 `EPERM` → `webview-launch.mjs` 只打 soft 警告。

## 2026-10-29 — P0 实测：CSP/静态、COM 次序、体积、探针清单

- 新增 §1.5：`style-src` 必须带 `'unsafe-inline'`（否则 CSSOM 写样式被 Chromium 拦掉，
  面板宽度/预览 transform 全废）；Chromium 会自动请求 `/favicon.ico`（已用
  `favicon.svg` + `<link rel="icon">` 消掉 404）；未注册 verb 的 `/api/...` 命中
  `GET /` → **405 纯文本**，前端必须按 `http_<status>` 上报而不是 `bad_json`。
  实测脚本 `tools/verify/shell-smoke.mjs`，`web/embed_test.go` 逐条断言 CSP 指令。
- 新增 §1.6：本机 `CoInitializeEx(…, 0x2)` 在**任意顺序**（锁线程前后）下返回
  `errno=0x1`（= `S_FALSE`，其 `Error()` 文案「Incorrect function.」是误导），
  因此窗口代码把 0x1 与 `RPC_E_CHANGED_MODE` 都当可容忍；`-tags webview` 真窗口
  实测通过（`webview-launch.mjs` 打印 `webview window opened` 且页内完成
  `/api/health` + `/api/settings`）。探针：`tools/verify/comprobe`。
- 同节补一条：进程被 kill 后 WebView2 仍会短暂锁定 profile 目录，`rmSync` 重试
  12 次仍可能 `EPERM` —— 验证脚本的清理因此只 soft 警告（目录在 `%TEMP%`）。
- 新增 §4.1（控制台 strip 6,912,512 B；WebView2 strip 7,345,152 B；未 strip
  9,782,784 / 10,464,256 B）与 §4.2（`/api/health` 返回 VCS 版本戳字段，
  前端据此确认端口上确实是本 App）。
- §5 拆成 5.1（仓库内可就地重跑的探针清单 + 与本文编号的映射）与 5.2
  （已删除的一次性历史探针：§1.1-§1.4、§2、§3、§4 的数值现不可重跑，
  P1-P5 会把断言重写进 `internal/pdfcore` 单测与 `tools/verify/`）。
- §6 未验证清单：WebView2 回退仍 `UNVERIFIED`，但注明窗口本身已在带 Runtime 的
  本机实测通过（§1.6）。
- 修正引用：`web/embed_test.go` 的注释把 CSP 事实指向 §1.6，实为 §1.5。

## 2026-10-28 — 记录 pdf.js 资产获取方式与 tarball 体积

- §3 加本机实测的获取命令（`npm pack pdfjs-dist@6.4.299` → 8,539,589 B / 554 files）；
  旧的 jsdelivr 逐文件下载同样可行，但 `npm pack` 更快更完整。
- 体积表：`build/pdf.min.mjs` 448 KB（br 118 KB）、`pdf.worker.min.mjs` 1,235 KB（br 338 KB）、
  `cmaps` 1,140 KB、`wasm` 1,507 KB、`standard_fonts` 779 KB、`image_decoders` 626 KB、
  `iccs` 15 KB；最小集（core + worker + cmaps）≈ 2.8 MB，全量 ≈ 5.98 MB。
- §5 记下「探针目录已删除」这一事实：§1-§4 的数值变成「已观测、不可就地重跑」，
  并要求 P0/P1 把探针重写进仓库后再逐节重跑（本次 5.1/5.2 拆分即该要求的开始）。

## 2026-10-19 — 首次实测（pdfcpu v0.16.3 + Chromium 151）

- §1：pdf.js 6.4.299 只有 ESM（`legacy/build/pdf.js` 等 404）；`saveDocument()` 走注释通道，
  不适用于印章语义；`ctx.filter` 泄漏复现（(54,33,25) vs 期望 (0,0,0)）；
  预览与落盘像素一致（`multiply` + `ca/CA 0.6` → (189,106,119)）。
- §2：pdfcpu `Cut` 的 outDir 必须先存在、每个输出含「原页 + 两块」；`opacity:` 写成
  `CA/ca`，透明 PNG 自动 `SMask`；`/BM` 只出现在 validate 白名单 → 混合模式需自写注入。
- §2.5 / §4：pdfcpu 净增 11.06 MB；A4 单页 JPEG 导出体积表（72/150/300 dpi × q40/75/92）。
