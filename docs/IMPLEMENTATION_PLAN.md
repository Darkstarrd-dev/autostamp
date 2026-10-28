# AutoStamp — 实施计划（IMPLEMENTATION PLAN）

> 最后核对：2026-10-28。本文是唯一权威的阶段计划；每阶段完成后勾选状态并回填实测数据。
> 依赖/浏览器事实引用 `docs/FACTS.md` 编号，禁止凭记忆改写。约束见 `AGENTS.md`。

## 0. 新对话恢复执行协议（执行入口）

1. 工作目录必须是 `C:\AutoStamp`（否则先 `/add-dir C:\AutoStamp`）。`AGENTS.md` 随仓库自动加载。
2. 依次读：`AGENTS.md`（约束）→ 本文件 **§10 状态跟踪** → `docs/FACTS.md`（实测事实）。
3. 状态表中第一个 `[ ]` 的阶段即为当前阶段；只在该阶段的「交付 / 关键实现 / 验收」范围内动手，
   不跨阶段抢做（P0 未 `[x]` 之前不动 P1）。
4. 开工前基线：`git status` 干净；已有代码时跑 `go vet ./... ; go test ./...` 记录起点是否全绿。
5. 事实（版本号、体积、参数键、切点、像素值）只允许引用 `docs/FACTS.md` 编号；
   标 `UNVERIFIED` 的必须先写探针实测、回填 FACTS（标重跑日期）再据此决策，**禁止凭记忆**。
   注意 FACTS §5：原一次性探针已删除，首次需要时重写进 `tools/verify/`。
6. 完成判据：该阶段验收命令全部通过 → 状态表勾 `[x]` + 回填实测数据 → 文档同步（`AGENTS.md` §10）。
   阶段收尾提交信息：`P<n>: <摘要>`（例 `P4: blend ExtGState 注入与回读一致性`）。
7. 卡住时优先照 §7 风险表对策做；仍不通就把实测现象写进 FACTS，而不是改需求。
8. 若当前阶段是 **P0.5（UI 契约冻结）**：先读 `docs/UI_SPEC.md` 的决策表（若已存在），
   已确认项**不得重问**；未确认项按 P0.5「与用户的交互协议」用 `ask` 批量提问
   （每轮 2–5 条、选项式），拿到用户答复才写决策表——**禁止把 §9 默认值当作已确认，
   也禁止虚构用户确认**。`UI_SPEC` 不存在时先交付 mock 再问。

## 1. 目标 / 非目标

目标（产品需求 1–5 全量）：PDF 查看（文本/图片/混合）、透明印章叠加与调参预览、
自动切分 + 骑缝章 + 起始位置、混合模式与透明度、带分辨率/质量参数的保存。

非目标：OCR、表单编辑、PDF 结构编辑器、云同步/协作、跨平台原生窗口（Windows WebView2
优先，非 Windows 只回退系统浏览器）、移动端。

## 2. 依赖与代价（决策依据见 FACTS）

|依赖|版本|许可|用途|代价|
|---|---|---|---|---|
|`github.com/pdfcpu/pdfcpu`|v0.16.3|Apache-2.0|解析/校验/切分(Cut)/合并/印章落盘/加密|净 **+11.06 MB**（FACTS §2.5）|
|`pdfjs-dist`|6.4.299|Apache-2.0|页面渲染、文本层、缩略图、导出用位图来源|最小 2.8 MB，全量 5.98 MB（FACTS §3）|
|`github.com/jchv/go-webview2`|latest（同 TinyRouter pin）|MIT|WebView2 窗口|小（纯 Go，无 CGO）|
|stdlib + `golang.org/x/image`|—|BSD|写 PDF（Flate/DCT）、印章重采样、JPEG 质量|0|
|自写 `internal/pdfcore/blend.go`|—|—|ExtGState `/BM`（pdfcpu 不提供，FACTS §2.2）|约 150 行|
|不引入|—|—|外部 mutool/Ghostscript/qpdf（AGPL/无用）；OCR（默认关闭）|—|

预计产物：`dist/autostamp-webview-stripped.exe` ≈ 20 MB。

## 3. 架构与数据流

```mermaid
flowchart LR
  W["WebView2 窗口"] --> S["127.0.0.1 随机端口<br/>net/http + embed.FS"]
  S --> JS["前端 app-*.js"]
  JS --> PJS["pdf.js 渲染页 + 文本层 + 缩略图"]
  PJS --> OV["叠加 canvas<br/>filter + globalCompositeOperation"]
  OV -->|预览只在前端| OV
  OV -->|回传页位图 raster only| S
  S --> A["internal/api"]
  A --> TS["internal/tmpstore<br/>assetId · TTL · 配额"]
  A --> PC["internal/pdfcore<br/>read/split/sealimg/blend/raster"]
  PC --> PCPU["pdfcpu"]
  PC --> STD["stdlib writer"]
  A --> SAVE["原子写盘 temp+rename"]
```

不变量：预览像素与落盘后再次渲染的像素一致（FACTS §1.3）；PDF 原文只读不改，
所有修改落到新 asset；写盘只在用户显式保存时发生。

## 4. 阶段

状态：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 完成（并回填实测数据）

### P0 — 工程骨架 `[ ]`

目的：窗口能打开、服务能跑、配置能存、地图有落地。

交付：`go.mod`（module `autostamp`，go 1.26）、`main.go`、`host_webview_windows.go`
（`webview2.NewWithOptions` + `CoInitializeEx`/`LockOSThread` 次序照 FACTS 引用注释实现）、
`host_console.go`（回退浏览器）、`web/embed.go`、`web/static/index.html`+`app-*.js` 外壳
（页面导航/主题/双语 i18n 骨架）、`internal/app/{port.go,server.go,browser.go}`、
`internal/config`（settings.json，默认值 + 原子写 + 指针字段合并）、
`internal/tmpstore`（owner/job/配额/TTL/scavenge）、`internal/console`、
`tools/verify/`（headless 启动脚本）、`PROJECT_MAP.md`。

关键实现：`http.ServeMux` 方法路由；brotli/gzip 中间件（`Accept-Encoding` 协商，
跳过已压缩类型）；`Host`/`Origin` 校验（P7 硬化，先埋开关）；`GET /api/health`。

验收：`go build -tags webview ./... && go vet ./... && go test ./...` 全绿；
headless 打开 `http://127.0.0.1:<port>` 显示外壳、console 0 error；
settings 写盘两次不损坏（单测：中断写 → 文件完整或回滚）。

### P0.5 — UI 契约冻结：与用户交互确定 UI `[ ]`

目的：在写任何功能接线之前，用可交互 mock **和用户一起**把 UI 语义、参数词表、
预览形态定死，使 P1–P5 只替换数据源、不重写 DOM/契约。这是需求侧唯一「必须先问用户」
的阶段——§9 的 D2/D3/D4 只有 UI 才能表达清楚。

前置：无（不依赖 Go 骨架，可与 P0 并行开跑）。但 **P1 开工前 P0.5 必须 `[x]`**，
且 P0 的 `web/static/index.html` 外壳必须按 `UI_SPEC` 的 DOM 骨架与 id 命名搭建。

交付：

- `docs/ui/mockup.html`：standalone HTML（内联 CSS/JS，无第三方依赖、无构建），
  真 DOM + 真 CSS token（与 `style.css` 同一套变量），假数据驱动。
  **只存在于 `docs/ui/`：不进 `web/static/`、不进 `embed.FS`、不进 exe。**
  必须覆盖的状态：无文件空态、已开 PDF、选中印章实例、拖拽/缩放开手柄、
  骑缝章模式（逐页条带 + 起始位置滑杆 + 单面/双面切换）、导出面板（DPI/质量 +
  实时体积预估，数值取 `docs/FACTS.md` §4）、保存/替换原文件的二次确认、错误态。
- `docs/ui/fixtures/{page.png,seal.png}`：由 `tools/genfix/main.go`（stdlib `image/png`，
  带 alpha 的红色 RGBA 印章 + 灰底带文字块的 A4 页位图）生成——避免依赖尚未实现的 P1。
- `docs/UI_SPEC.md`：①组件层级与状态机（asset → 页选择 → 印章实例 → 骑缝章 → 导出/保存）
  ②参数词表（字段名、类型、取值域、单位 pt/mm/%、默认值、是否可空）③控件 ↔ 字段绑定表
  ④空态/禁用态/错误态文案（列 i18n key）⑤快捷键 ⑥决策表（D1–D4 + 布局与预览形态，
  每行含「用户确认」列）⑦与 `AGENTS.md` §6 路由字段的对照表。
- `tools/verify/ui-smoke.mjs`、`tools/verify/ui-contract.mjs`（三方一致性校验：
  mock 的 `data-field` 属性 ↔ `UI_SPEC` 字段表 ↔ `AGENTS.md` §6 请求字段；不一致即退出报错）。

与用户的交互协议（**不得替用户虚构确认**，也不得把这些默认值直接当已确认）：

1. 先交付 mock（浏览器打开，用户可点、可拖、可切模式），再用 `ask` 批量提问：
   每轮 2–5 条、选项式、每条附 mock 里对应的 state 名。首轮必问：
   **D2 装订边**（单面右缘连续 / 双面奇右偶左 / 二者可选切换）、
   **D3 自动切分**（自动判定 + 一键否决 / 仅手动指定切点 / 自动但可覆盖）、
   **D4 去白底**（预览即时可撤销 / 仅在保存预设时处理 / 不做）、
   布局密度（左预览+右面板 / 单栏上下 / 面板可折叠）、
   骑缝章预览形态（逐页条带缩略图 / 主画布叠加 + 侧栏放大）。
2. 用户选定后**立即**写进 `UI_SPEC` 决策表（选项文本 + 确认日期 + 引自 ask 的原文摘要），
   并把 mock 默认 state 改为所选；再进入下一轮（第 2 轮：保存/替换语义、体积预估展示、
   错误态文案、多印章实例的命名与列表形态）。
3. 最多 3 轮；2 轮内收敛。仍决不了的按 §9 默认实现，在 `UI_SPEC` 标 `未评审默认`
   （不得留 `TODO`、不得空着）。
4. 每轮结束把「已确认字段 + 相对上轮的变更」摘要回贴用户；已确认项在后续会话中不得重问。

关键实现：mock 的 DOM 骨架即 P0/P1 的真实外壳（容器/画布/面板 id 就是契约的一部分）；
每个可调参数在 mock 里挂 `data-field="<§6 字段名>"`，接线时只换渲染与请求代码。
16 种混合模式在 mock 里必须是**分组选择器**（Normal / 增亮 / 增暗 / 比较 / 分量组），
不许 16 个平铺按钮；透明度、明度、饱和度统一滑杆 + 数值框（滑杆与数值双向绑定）。

验收：

- `node tools/verify/ui-smoke.mjs`：mock 打开 console 0 error、无 404；
  1280×720 与 1440×900 无横向溢出；每个控件都带 i18n key 且 en/cn 两值非空。
- `node tools/verify/ui-contract.mjs`：三方字段一致性通过（mock ↔ `UI_SPEC` ↔ §6）。
- `UI_SPEC` 决策表 D1–D4 与预览形态、布局密度各有用户确认记录（日期 + 所选选项 + 原文摘要）。
- `docs/IMPLEMENTATION_PLAN.md` §9 对应行改为「已在 P0.5 确认」并指向 `UI_SPEC` 行号。

### P1 — PDF 查看（需求 1）`[ ]`

目的：打开本地 PDF，页浏览、缩略图、文本层；打通「本地文件」通道。

交付：`web/static/vendor/pdfjs/{build,cmaps,wasm,standard_fonts,image_decoders}`（提交 +
`LICENSE`/`README`/`SHA256.txt`）；`web/static/app-preview.js`（pdf.js 初始化、
`cMapUrl`/`standardFontDataUrl`/`wasmUrl` 指向 vendor 路径、页渲染 + 缩放 + 翻页）；
`app-thumbs.js`（缩略图，降采样 worker）；`app-textlayer.js`；
`internal/api/pdf.go`：`POST /api/fs/pick`（native picker）、`POST /api/pdf/open`、
`GET /api/pdf/raw`（Range/ETag）；`internal/pdfcore/read.go`（页数、每页 pt 尺寸、
rotation、是否含文字标记——由 pdf.js 抽取，服务端只做结构信息）。

资产获取（本机 2026-10-28 实测可行：`npm pack` 得 `pdfjs-dist-6.4.299.tgz`
8,539,589 B；node v24.18.0 / npm 11.16.0）：

```bash
mkdir -p tmp/asset && cd tmp/asset && npm pack pdfjs-dist@6.4.299
tar -xzf pdfjs-dist-6.4.299.tgz                       # → package/
mkdir -p web/static/vendor/pdfjs/build
cp package/build/pdf.min.mjs package/build/pdf.worker.min.mjs \
   web/static/vendor/pdfjs/build/
cp -r package/cmaps package/wasm package/image_decoders package/standard_fonts \
   web/static/vendor/pdfjs/
cp package/LICENSE web/static/vendor/pdfjs/LICENSE
sha256sum web/static/vendor/pdfjs/build/*.mjs > web/static/vendor/pdfjs/SHA256.txt
# 另写 web/static/vendor/pdfjs/README.md：来源 tarball 名+版本+用途+当前裁剪状态
rm -rf tmp/asset                                      # 清理；tmp/ 已 gitignore
```

P1 先 vendor **全量**（≈5.98 MB，FACTS §3）以保证扫描型样本的 JBIG2/JPX 可渲染；
发布期裁剪（`wasm`/`image_decoders`/`standard_fonts`）留到 P6 用实测样本决定，
裁剪后 exe 体积必须回填 §10。PowerShell 下 `tar` 为 bsdtar 等价；`sha256sum`
不可用时改 `Get-FileHash`。

关键实现：pdf.js 仅 ESM，用 `import()` 动态加载（FACTS §1.1）；
`MaxBytesHandler` 上限 256 MiB；Range 直读避免整文件进内存。

验收：三类样本（纯文字 A4、单页扫描 300dpi、混合型含图片+文字）渲染成功；
`getTextContent` 文本条数断言；中文 CID 样本渲染不断字（并把结果回填 FACTS §6）；
headless 无 console error、无 404 资产。

### P2 — 印章叠加与调参预览（需求 2、4 的预览面）`[ ]`

交付：`app-overlay.js`（双层 canvas：页 canvas + 印章 canvas）、拖拽/锚点/手柄缩放/旋转、
`app-panel.js` 控件（透明度 %、混合模式 16 项、明度、饱和度、尺寸 mm/pt、XY 数值框）、
`POST /api/pdf/seal/prepare`（上传 PNG → sealId + alpha 元数据 + 重采样
`golang.org/x/image/draw`）；印章「去白底」前端可选（存为预设时用）。

关键实现：每层 `save()/restore()` 且显式 `filter='none'`（FACTS §1.4 污染回归）；
预览 scale=2 与导出 dpi 之间允许 ±2 通道容差（抗锯齿）；
透明度百分比 = `globalAlpha`；混合模式映射到 `globalCompositeOperation`，
并在 UI 上标注对应的 PDF `/BM` 名称。

验收：`node tools/verify/pixel-matrix.mjs` 断言参考值
(170,22,28)（multiply × 无 filter）与 (189,106,119)（multiply + 0.6）；
新增「filter 未复位」回归用例必须失败→修复→通过；
16 种模式 × {1.0,0.6,0.3} 三档透明度无异常。

### P3 — 自动切分 + 骑缝章（需求 3）`[ ]`

交付：`internal/pdfcore/split.go`（`api.CutFile` + `Trim`/`ExtractPages` 剔原页）、
`sealimg.go`（条带切分 + 重采样）、`app-crosspage.js`（起始位置滑杆、每页预览条带、
装订边选择）、`POST /api/pdf/split`。

关键实现（FACTS §2.3 坑）：切点用**相对分数**；`outDir` 预创建（tmpstore 目录）；
输出含原页 → 剔除；骑缝章 = 第 i 页放第 i 条（`position:r` + `offset:0 -startOffset`），
单面=右缘连续、双面=右/左交替（§9 决策 D2）。自动切分启发式：MediaBox 纵横比
> 0.7 且横排 → 判 2 拼（`UNVERIFIED`，需样本实测回填 FACTS）。

验收：A4→A5 尺寸断言（595×842 → 297.5×842）；两页印章 bbox 断言；
预览合成后再落盘（P4 前用 stdlib writer 过渡）骑缝拼回像素与整枚印章一致（误差 ≤ 1 px）。

### P4 — 矢量落盘 + 混合模式注入（需求 4 的落盘面）`[ ]`

交付：`internal/pdfcore/blend.go`（ExtGState `/BM` + `/ca` `/CA`，幂等 `Update`）、
`validate.go`（`ValidateFile` + 显式 `MaxImageBytes`/`MaxImagePixels`）、
`POST /api/pdf/apply`、`POST /api/pdf/save`（`pathGrantId` / 目标路径 / 替换原文件，
temp+rename）、`internal/pdfcore/engine.go`（open→split→seal→save 状态机，失败回滚 asset）。

关键实现：pdfcpu 已生成 `GS0`，注入即在 GS 字典补 `/BM`；若 pdfcpu 未生成 GS 则自建字典 +
Form 内容流 `gs`（两条路径都要有单测）。加密 PDF 走 `UserPW/OwnerPW`（FACTS §2.4）。

验收：`ValidateFile` 通过；**回读一致性**：保存的 PDF 再喂 pdf.js 渲染，
采样像素 == P2 预览值（16 模式 × 3 透明度矩阵）；重复调整同一印章不叠加
（`Update` 幂等，实测已验证）；`go test ./internal/pdfcore` 全绿。

### P5 — 光栅导出与保存参数（需求 5）`[ ]`

交付：`internal/pdfcore/raster.go`（`/DCTDecode` 与 `/FlateDecode` 两条 writer，
页尺寸/DPI/旋转矩阵、`/Length` 精确）、`POST /api/pdf/export`
（`{dpi ∈ 72/150/300/custom, quality ∈ 40..95, mode ∈ vector|raster, pages}`）、
前端「导出设置」面板 + 体积预估。

关键实现：页位图由 pdf.js 按目标 scale 渲染后回传（避免服务端 rasterize，
FACTS §2.4 无该能力）；每页 X/Y DPI 元数据（`/DECODE` 由 1pt=1/72in 换算）；
超过 90 MB/页时提示并降 DPI；印章在 raster 模式下已被前端合成，无需 `/BM`。

验收：复现 FACTS §4 体积表（±5%）；导出 PDF 被 pdf.js 解析渲染采样一致；
300dpi + q92 单页 ≤ 500 KB 量级；`go test` writer 字节结构断言（xref 偏移、`/Length`）。

### P6 — 预设 / 批处理 / 打包 `[ ]`

印章预设库（`%APPDATA%\AutoStamp\seals\`：名称、图片、参数组，CRUD + 导出 zip）；
最近文件列表；**批处理**（同参数套用到多个 PDF/一个目录，队列 + 进度 SSE）；
页眉页脚/多印章（可选，若 P2 面板已支持多印章则复用）；
`build.ps1`（default/webview/strip 变体 + 版本注入 + `rsrc` 图标 exe）；
体积与冷启动实测回填本文。

验收：批处理 20 个 PDF（含混合/扫描）全成功、失败项不影响其他；exe 体积 ≤ 25 MB；
双击启动到首屏可交互 ≤ 1.5 s。

### P7 — 加固与文档核对 `[ ]`

`Host`/`Origin` 强制校验、`X-Content-Type-Options`、`CSP`（仅 self + 内联 hash 策略）；
上传/渲染内存预算与大图分块；加密 PDF 口令弹窗与失败提示；
崩溃恢复（tmpstore scavenge、崩溃后重启清空）；i18n 全覆盖；
`PROJECT_MAP.md`/`docs/*` 核对与 `docs/changelog/` 建立。

## 5. 验证约定

- Go：`go vet ./... && go test ./...`（`internal/pdfcore`、`internal/config`、
  `internal/tmpstore`、`internal/api` httptest 契约）。
- 前端：`web/*.test.js`（node、无框架、DOM 桩）+ `tools/verify/*.mjs`
  （headless Chromium：渲染采样、bbox、0 console error）。
- UI 契约（P0.5 起常驻回归）：`node tools/verify/ui-smoke.mjs`（0 error、无横向溢出、
  i18n 覆盖）与 `node tools/verify/ui-contract.mjs`（mock ↔ `UI_SPEC` ↔ `AGENTS.md` §6
  字段三方一致）。
- 每阶段至少一次真实窗口冒烟（WebView2），并记录截图到 `tmp/verify/evidence/`（gitignore）。

## 6. 里程碑顺序与依赖

P0（骨架）∥ P0.5（UI 契约冻结）→ P1 → P2 →（P3 ∥ P4 设计并行）→ P4 → P3 完整 → P5 → P6 → P7。
P0.5 与 P0 可并行开跑，但 **P1 开工前 P0.5 必须 `[x]`**；P0 的 `index.html` 外壳按
`UI_SPEC` 的 DOM 骨架与 id 命名搭建，避免二次改壳。
关键前置：P4 的 blend 注入是唯一自写难点（无现成依赖，FACTS §2.2），
P3 的切分几何依赖 P4 的落盘才有完整「预览→保存」闭环。

## 7. 风险与对策

|风险|影响|对策|
|---|---|---|
|pdfcpu API 命名不稳（v0.16 已把 stamp 改成 watermark 系列）|升级即断|`go.mod` 精确 pin v0.16.3；只在 `internal/pdfcore` 包一层适配；升级需跑 P4 回归矩阵|
|exe 体积（pdfcpu +11 MB、pdf.js ≈3–6 MB）|分发/杀软误报|构建期裁剪 pdf.js 资产（非扫描场景去掉 `wasm`/`image_decoders`）；发布加签名/说明|
|预览(2× scale) 与导出(300 dpi) 抗锯齿差异|像素比对波动|验证容差 ±2/通道；关键断言用整数区域|
|中文 CID / 无 `/ToUnicode` PDF 抽不出文字|文本层为空|提示「该文件无可提取文字」，不假装成功；P1 实测回填 FACTS|
|超大扫描 PDF 占用内存|卡顿/崩溃|Range 直读、分页处理、`MaxImagePixels` 收紧、raster 分页|
|骑缝章装订边定义（单面/双面）|成品顺序错|P0.5 与用户确认（D2）后定死几何；预览逐页显示条带位置|
|UI 契约在 P0.5 之后漂移（字段名/预览形态/语义）|P1–P5 返工、用户可见语义混乱|`ui-contract.mjs` 三方校验常驻；任何字段变更必须先改 `UI_SPEC` + `AGENTS.md` §6 再改代码|

## 8. 可测量的完成标准（Definition of Done）

1. 需求 1–5 全部在真实 WebView2 窗口内可用（非 CLI、非占位）；
2. 保存后的 PDF 在外部查看器（Edge/Acrobat）中印章位置、透明度、混合模式与预览一致；
3. 数值验证矩阵全绿（P2/P4/P5 的采样断言）；
4. `go test`/`go vet`/`node tools/verify` 无失败；
5. 文档（`PROJECT_MAP.md`、`docs/*`）与代码同提交更新。
6. P0.5 之后：`docs/UI_SPEC.md` 字段表与 `AGENTS.md` §6 一致，且
   `node tools/verify/ui-contract.mjs` 三方校验（mock ↔ `UI_SPEC` ↔ §6）通过。

## 9. 待定决策（P0.5 与用户确认后回填「确认」列）

|编号|问题|推荐默认|确认（P0.5）|
|---|---|---|---|
|D1|保存默认路径|`vector`（保留文字/可搜索），需要抗篡改时切 `raster`|待 P0.5|
|D2|骑缝章装订边|单面：右缘连续条带；双面：奇右偶左交替；页内起始偏移可调|**必问**（UI 才能表达）|
|D3|自动切分触发|MediaBox 横排且纵横比 > 0.7 才自动 2 拼；否则手动指定切点|**必问**（含一键否决形态）|
|D4|印章去白底|前端做（红印章扫描白底常见），存预设时保留 alpha；不做服务端 OCR|**必问**（预览可撤销性）|
|D5|是否支持 macOS/Linux|不支持原生窗口（需 CGO），只回退浏览器；`UNVERIFIED`|不阻塞 P0.5|
|D6|批处理并发|3（与 IO 竞争最小化），失败不中断整批|不阻塞 P0.5|

P0.5 追加必问项（不属上表）：布局密度、骑缝章预览形态、多印章实例形态、
保存/替换原文件的确认方式、导出体积预估的展示位置。全部结论只落 `UI_SPEC` 决策表。

## 10. 状态跟踪

|阶段|状态|实测数据（回填）|
|---|---|---|
|P0 骨架|`[ ]`||
|P0.5 UI 契约冻结|`[ ]`|用户确认轮次：待记录|
|P1 查看|`[ ]`||
|P2 叠加预览|`[ ]`||
|P3 切分+骑缝|`[ ]`||
|P4 矢量落盘+BM|`[ ]`||
|P5 光栅导出|`[ ]`||
|P6 预设/批处理/打包|`[ ]`||
|P7 加固/文档|`[ ]`||
