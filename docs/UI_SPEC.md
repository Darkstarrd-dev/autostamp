# AutoStamp — UI_SPEC（P0.5 UI 契约）

> 最后核对：2026-11-04（版本号取值定为 `0.1-dev`：§8 新增 HD4，伪版本不再进 UI；
> 顶栏收尾的 2026-11-03 记录（§2 删 `ui.density` 字段行、§4 删 12 个键（282 → 270）、
> §6 删 6 个契约 id、§7 驱动去 `setDensity`、§7.1 probe 加 `docTitle`、§8 新增 HD1/HD2/HD3，
> L1/RF1 的 UI 形态已作废）沿用；P2–P6 接线记录沿用 2026-10-30/11-02）。
> 本文是 **UI 语义唯一权威**：字段名/取值域/控件绑定/DOM id/状态机
> 在此冻结；P0 起 `web/static/index.html` 必须照 §1 骨架与 §7 id 搭建，P1–P5 只换数据源。
> 与 `AGENTS.md` §6 路由字段冲突时：先改本文 + §6（同一提交），再改代码。
> 三方一致性由 `node tools/verify/ui-contract.mjs` 常驻校验；mock 行为 `node tools/verify/ui-smoke.mjs`。
> **§8 决策表** 记录用户确认（选项文本 + 日期 + ask 原文摘要）；未确认项标 `待 P0.5 确认`，
> 不得引用为已定，也不得虚构确认。

## 1. 组件层级与状态机

层级：`asset（PDF 会话资产）→ 页选择 → 印章实例（instance）→ 骑缝章（crossPage）→ 导出/保存`。
实例是叠加单位：一个实例可作用于多页（`apply.pages`）；骑缝章把实例切成逐页条带（`crossPage=true`）。

状态（`<html data-state>`，与 mock `__autoStampMock.STATES` 一致）：

```ui-states
empty            无文件空态（拖拽 / 选择 / 路径输入）
open-error       打开失败（非 PDF 或文件损坏）
opened           已打开 PDF，未选中实例交互
stamp-selected   实例被选中（选择框 + 手柄可见）
stamp-dragging   画布拖拽移动中（pos 实时更新）
stamp-resizing   句柄缩放中（scale 实时更新）
split-preview    切分预览（2 拼结果页 + 切点）
crosspage        骑缝章模式（逐页条带 + 起始位置 + 装订边）
export           导出面板（dpi/quality/mode + 体积预估）
save-confirm     保存对话框（targetPath / replaceOriginal）
replace-confirm  替换原文件的二次确认
password-error   加密 PDF 需口令
save-error       写盘失败（权限 / 占用，可改存新文件）
warn-no-text     无文字层警告（扫描件；不假装成功）
warn-large-page  超大页面降采样警告（MaxImagePixels 收紧）
```

转移（关键路径）：`empty → opened`（失败 → `open-error` / `password-error`）；
`opened ⇄ split-preview`（切分产生新 asset，原文只读）；`opened → crosspage`
（`crossPage=true` 且切分生效，实例模式变 crosspage）；`opened/stamp-* →
stamp-dragging/stamp-resizing → stamp-selected`（pointerup）；`stamp-selected →
save-confirm → replace-confirm`（`replaceOriginal=true`）→ 成功 toast 或 `save-error`；
`opened → warn-no-text / warn-large-page`（渲染与文字抽取的降级提示）。

不变量（AGENTS §3）：预览像素 == 落盘后再次渲染像素；PDF 原文只读，所有修改落到新 asset；
写盘只在显式保存时发生。

## 2. 参数词表（冻结）

`field=` 是契约名，mock 的 `data-field` 与之逐字相同（含 `api.` / `ui.` 前缀）；
`api=` 必须镜像去掉 `api.` 后的字段名，其首段前缀在 §6 路由词表里映射到 `/api/...`；
`ctl=no` 表示只作响应/内部状态显示（`data-field-role="display"`）。
单位：`pt` = PDF 点（1pt=1/72in）；前端一律以 **左上原点** 换算，落盘转 pdfcpu 的左下原点。
`nullable` = 是否允许 `null`/空串。默认值即 mock 初值，也是 settings.json 默认。

```ui-fields
field=ui.lang api=- type=segmented range=en|cn default=en nullable=no ctl=yes i18nkey=ui.lang.ctl decision=-
field=ui.theme api=- type=segmented range=light|dark default=light nullable=no ctl=yes i18nkey=ui.theme.ctl decision=-
field=decision.assetIds api=- type=display range=5个 assetId chip default=- nullable=yes ctl=yes i18nkey=asset.hint decision=-
field=api.fs.pick.filePath api=fs.pick.filePath type=text range=绝对路径 default=- nullable=no ctl=yes i18nkey=api.fs.pick.filePath.ctl decision=-
field=api.fs.pick.multi api=fs.pick.multi type=toggle range=bool default=true nullable=no ctl=yes i18nkey=api.fs.pick.multi.ctl decision=-
field=api.fs.pick.filter api=fs.pick.filter type=select range=pdf|all default=pdf nullable=no ctl=yes i18nkey=api.fs.pick.filter.ctl decision=-
field=api.fs.pick.pathGrantId api=fs.pick.pathGrantId type=text range=grantId default=- nullable=yes ctl=yes i18nkey=api.fs.pick.pathGrantId.ctl decision=- unit=grantId
field=api.open.assetId api=open.assetId type=text range=assetId default=- nullable=yes ctl=no i18nkey=api.open.assetId.ctl decision=-
field=api.split.assetId api=split.assetId type=text range=assetId default=- nullable=yes ctl=no i18nkey=api.split.assetId.ctl decision=-
field=api.apply.assetId api=apply.assetId type=text range=assetId default=- nullable=yes ctl=no i18nkey=api.apply.assetId.ctl decision=-
field=api.export.assetId api=export.assetId type=text range=assetId default=- nullable=yes ctl=no i18nkey=api.export.assetId.ctl decision=-
field=api.save.assetId api=save.assetId type=text range=assetId default=- nullable=yes ctl=no i18nkey=api.save.assetId.ctl decision=-
field=api.seal.prepare.despill api=seal.prepare.despill type=toggle range=bool default=true nullable=no ctl=yes i18nkey=api.seal.prepare.despill.ctl decision=D4
field=api.seal.prepare.alphaTrim api=seal.prepare.alphaTrim type=toggle range=bool default=true nullable=no ctl=yes i18nkey=api.seal.prepare.alphaTrim.ctl decision=-
field=api.seal.prepare.resampleDpi api=seal.prepare.resampleDpi type=number range=72..600 default=300 nullable=no ctl=yes i18nkey=api.seal.prepare.resampleDpi.ctl decision=-
field=api.seal.preset.presetName api=seal.preset.presetName type=text range=string default=- nullable=no ctl=yes i18nkey=api.seal.preset.presetName.ctl decision=I1
field=api.apply.blend api=apply.blend type=select-grouped range=16blend词表 default=multiply nullable=no ctl=yes i18nkey=api.apply.blend.ctl decision=-
field=api.apply.opacity api=apply.opacity type=slider+number range=0..1 default=0.6 nullable=no ctl=yes i18nkey=api.apply.opacity.ctl decision=-
field=api.apply.brightness api=apply.brightness type=slider+number range=0..2 default=1 nullable=no ctl=yes i18nkey=api.apply.brightness.ctl decision=-
field=api.apply.saturate api=apply.saturate type=slider+number range=0..3 default=1 nullable=no ctl=yes i18nkey=api.apply.saturate.ctl decision=-
field=api.apply.scale api=apply.scale type=slider+number range=0.05..0.9 default=0.202 nullable=no ctl=yes i18nkey=api.apply.scale.ctl decision=- unit=相对页宽分数
field=api.apply.pos api=apply.pos type=text range=x,y default=130,480 nullable=no ctl=yes i18nkey=api.apply.pos.ctl decision=- unit=pt
field=api.apply.anchor api=apply.anchor type=segmented range=tl|tr|center|bl|br default=center nullable=no ctl=yes i18nkey=api.apply.anchor.ctl decision=-
field=api.apply.offset api=apply.offset type=text range=dx,dy default=0,0 nullable=no ctl=yes i18nkey=api.apply.offset.ctl decision=- unit=pt
field=api.apply.rotation api=apply.rotation type=slider+number range=-180..180 default=0 nullable=no ctl=yes i18nkey=api.apply.rotation.ctl decision=- unit=deg
field=api.apply.pages api=apply.pages type=text range=pages词表 default=1-2,5 nullable=no ctl=yes i18nkey=api.apply.pages.ctl decision=-
field=api.split.auto api=split.auto type=toggle range=bool default=true nullable=no ctl=yes i18nkey=api.split.auto.ctl decision=D3
field=ui.split.mode api=- type=segmented range=off|v2|h2|grid default=v2 nullable=no ctl=yes i18nkey=ui.split.mode.ctl decision=D3
field=api.split.rows api=split.rows type=number range=1..6 default=1 nullable=no ctl=yes i18nkey=api.split.rows.ctl decision=-
field=api.split.cols api=split.cols type=number range=1..6 default=2 nullable=no ctl=yes i18nkey=api.split.cols.ctl decision=-
field=api.split.cutFractions api=split.cutFractions type=text range=0..1逗号列表 default=0.5 nullable=no ctl=yes i18nkey=api.split.cutFractions.ctl decision=-
field=api.split.pages api=split.pages type=text range=pages词表 default=all nullable=no ctl=yes i18nkey=api.split.pages.ctl decision=-
field=api.export.mode api=export.mode type=segmented range=vector|raster default=vector nullable=no ctl=yes i18nkey=api.export.mode.ctl decision=D1
field=api.export.dpi api=export.dpi type=segmented range=72|150|300|custom default=150 nullable=no ctl=yes i18nkey=api.export.dpi.ctl decision=D1 unit=dpi
field=api.export.customDpi api=export.customDpi type=number range=96..600 default=150 nullable=no ctl=yes i18nkey=api.export.customDpi.ctl decision=- unit=dpi
field=api.export.quality api=export.quality type=slider+number range=40..95 default=75 nullable=no ctl=yes i18nkey=api.export.quality.ctl decision=-
field=api.export.pages api=export.pages type=text range=pages词表 default=all nullable=no ctl=yes i18nkey=api.export.pages.ctl decision=-
field=api.apply.crossPage api=apply.crossPage type=toggle range=bool default=false nullable=no ctl=yes i18nkey=api.apply.crossPage.ctl decision=D2
field=ui.crosspage.binding api=- type=segmented range=right|alternate|none default=right nullable=no ctl=yes i18nkey=ui.crosspage.binding.ctl decision=D2
field=api.apply.startOffset api=apply.startOffset type=slider+number range=0..200 default=0 nullable=no ctl=yes i18nkey=api.apply.startOffset.ctl decision=D2 unit=pt
field=api.save.targetPath api=save.targetPath type=text range=绝对路径 default=- nullable=yes ctl=yes i18nkey=api.save.targetPath.ctl decision=-
field=api.save.replaceOriginal api=save.replaceOriginal type=toggle range=bool default=false nullable=no ctl=yes i18nkey=api.save.replaceOriginal.ctl decision=S1
field=api.open.pw api=open.pw type=password range=string default=- nullable=yes ctl=yes i18nkey=api.open.pw.ctl decision=-
field=api.batch.files api=batch.files type=text range=绝对路径列表 default=- nullable=no ctl=yes i18nkey=api.batch.files.ctl decision=BC2
field=api.batch.dirPath api=batch.dirPath type=text range=绝对路径 default=- nullable=yes ctl=yes i18nkey=api.batch.dirPath.ctl decision=BC2
field=api.batch.autoSplit api=batch.autoSplit type=toggle range=bool default=false nullable=no ctl=yes i18nkey=api.batch.autoSplit.ctl decision=BC3
field=api.batch.splitMode api=batch.splitMode type=select range=auto|rows-cols|custom|unsplit default=auto nullable=no ctl=yes i18nkey=api.batch.splitMode.ctl decision=BC3
field=api.batch.rows api=batch.rows type=number range=2..6 default=2 nullable=no ctl=yes i18nkey=api.batch.rows.ctl decision=BC3
field=api.batch.cols api=batch.cols type=number range=1..3 default=2 nullable=no ctl=yes i18nkey=api.batch.cols.ctl decision=BC3
field=api.batch.crossPage api=batch.crossPage type=toggle range=bool default=false nullable=no ctl=yes i18nkey=api.batch.crossPage.ctl decision=BC3
field=api.batch.binding api=batch.binding type=select range=right|alternate default=right nullable=no ctl=yes i18nkey=api.batch.binding.ctl decision=BC3
field=api.batch.startOffset api=batch.startOffset type=slider+number range=0..200 default=0 nullable=no ctl=yes i18nkey=api.batch.startOffset.ctl decision=BC3 unit=pt
field=api.batch.presetName api=batch.presetName type=select range=预设名 default=- nullable=yes ctl=yes i18nkey=api.batch.presetName.ctl decision=BM1
field=api.batch.dpi api=batch.dpi type=segmented range=72|150|300|custom default=150 nullable=no ctl=yes i18nkey=api.batch.dpi.ctl decision=BM1 unit=dpi
field=api.batch.customDpi api=batch.customDpi type=number range=72..600 default=- nullable=yes ctl=yes i18nkey=api.batch.customDpi.ctl decision=BM1 unit=dpi
field=api.batch.quality api=batch.quality type=slider+number range=40..95 default=75 nullable=no ctl=yes i18nkey=api.batch.quality.ctl decision=BM1
field=api.batch.concurrency api=batch.concurrency type=number range=1..8 default=2 nullable=no ctl=yes i18nkey=api.batch.concurrency.ctl decision=BM1 unit=并发
field=api.fs.pick.dir api=fs.pick.dir type=toggle range=bool default=false nullable=no ctl=no i18nkey=- decision=BM1
field=api.save.mkdirs api=save.mkdirs type=toggle range=bool default=false nullable=no ctl=no i18nkey=- decision=BM2
```

`pages-词表`：`all | none | <页号>[-<页号>][,...]`（1 基，例 `1-2,5`）。
`16blend词表`（PDF 表 136 / FACTS §1.2）：`normal screen lighten color-dodge hard-light multiply
darken color-burn overlay soft-light difference exclusion hue saturation color luminosity`；
控件必须是**分组** `<select>`（normal/增亮/增暗/对比/比较/分量 六组），不得 16 个平铺按钮。

语义要点（实测见 FACTS，不得凭记忆改）：
- `api.apply.opacity` → 落盘 `ExtGState /CA /ca`（pdfcpu `opacity:` 同义，FACTS §2.1）；
  `api.apply.blend` → `blend.go` 注入 `/BM`（pdfcpu 不写 `/BM`，FACTS §2.2）。
- `api.apply.brightness/saturate` 只在预览（`ctx.filter`），**落盘不写**；每层叠加前显式
  `ctx.filter='none'`（FACTS §1.4 的污染坑）。
- `api.apply.scale` 是相对页宽分数（换算显示 pt/mm）；`api.apply.pos` 与 `api.apply.anchor`
  二选一（选锚点后 pos 归算）。**页内坐标约定（P2 实测；见 §8「页内坐标原点」行）**：
  display 空间、原点左上、y 向下（与 `#preview-ruler` 的「标尺原点在左上」一致）。
  落盘侧换算到 pdfcpu 的 y 向上 MediaBox（含 `/Rotate` 补偿），换算在 P4 apply 内做并有单测钉死。
  - 二选一是**逐实例**的（实例上的 `geomMode`）：改 `pos` 输入框或方向键 → 该实例走 pos 通道
    （`offset` 归零，落盘发 `pos` 不带 `anchor`）；改锚点/拖拽/缩角 → 走 anchor+offset 通道
    （`pos` 只作派生读数）。预览与落盘共用同一套换算：`app-overlay.rectFor` == `pdfcore.StampGeom.Box`。
- `api.apply.startOffset` 是骑缝条带沿装订边的起始偏移（pdfcpu `offset:0 -N`），与 `api.apply.offset` 独立。
- `api.export.dpi/customDpi/quality` 仅 `mode=raster` 生效（页位图由前端回传，FACTS §2.4 无 rasterize）。
- `api.batch.*`（BM1/BM2）= 前端逐文件跑完整链：`fs/pick` → `open` →（`split`）→ `apply` →（`export` 光栅）→ `save(mkdirs)`；
  并发 = 前端队列数（默认 2，1..8）；加密件不弹密码，跳过并在报表记 `password_required`；
  输出写进 `原目录\_batch\`，文件名加前后缀（`原文件名.dpi<数字>.q<数字>.pdf`，
  例 `a-01.dpi150.q75.pdf`）；绝不改源文件（BC2 的命名被 BM2 取代）。单扩展名是硬要求：
  `fsx.ValidateTargetPath`/`CheckWriteTarget` 只认 `.pdf`，多一层后缀会被 `path_denied` 挡掉。
- `api.open.pw`：UserPW/OwnerPW 都试；AES-256 链路 `UNVERIFIED`（FACTS §6）。
- `ui.*` 字段不进请求（`api=-`）；`ui.split.vetoedPages` 是 `split` 的派生参数，切分时随请求带上。

## 3. 控件 ↔ 字段绑定表

| 面板/控件 | 字段 | 控件形态 | 落点 |
|---|---|---|---|
| 印章段 · 上传印章 PNG | `sealId`（响应侧） | button | `POST /api/pdf/seal/prepare` |
| 印章段 · 撤销去背 | `seal.prepare`（`despill:false` 重跑） | button | `POST /api/pdf/seal/prepare`（同一份字节） |
| 印章段 · 元数据 | `sealId` + `alpha`/`opaque`（响应侧） | chip（只读） | 无请求 |
| 主画布 · 选中实例（`#stamp-layer`） | `apply.offset`（拖框）/ `apply.scale`（四角、Ctrl+滚轮 V3）/ `apply.rotation`（顶部手柄） | 虚线框 + 手柄 | 无请求（叠加层内部状态） |
| 印章段 · 去白底 | `api.seal.prepare.despill` | toggle + 撤销 | 同上 |
| 印章段 · 存为预设 | `api.seal.preset.presetName` | text + button | `GET/POST /api/seal/preset` |
| 批处理段 · 输入 | `api.batch.files` / `api.batch.dirPath` | text + 两个按钮 | 前端逐文件走 `fs/pick`(filePath/dir) → `pdf/open` → …（BM1） |
| 批处理段 · 印章来源 | `api.batch.presetName` | select（预设库） | 预设图像字节 → `POST /api/pdf/seal/prepare` |
| 批处理段 · 光栅参数 | `api.batch.dpi` / `customDpi` / `quality` | segmented + number + 滑杆 | `POST /api/pdf/export`（multipart 光栅） |
| 批处理段 · 并发 | `api.batch.concurrency` | number | 前端队列（不落请求） |
| 批处理段 · 链路开关 | `api.batch.autoSplit` / `splitMode` / `rows` / `cols` / `crossPage` / `binding` / `startOffset` | toggle + select + number | `POST /api/pdf/split`；骑缝参数走预设 |
| 印章段 · 载入/删除预设 | `api.seal.preset.select`（响应侧） | select + 两个按钮 | `GET/DELETE /api/seal/preset` |
| 实例段 · 列表 | instance（名称/模式/删除） | list + text | 内部状态 |
| 叠加段 · 混合模式 | `api.apply.blend` | 分组 `<select>` | `/api/pdf/apply` |
| 叠加段 · 透明度/明度/饱和度 | `api.apply.opacity/brightness/saturate` | 滑杆 + 数值（双向绑定） | 同上 / 仅预览 |
| 位置段 · 印章宽度 | `api.apply.scale` | 滑杆 + 数值 + pt 换算 | 同上 |
| 位置段 · 位置 | `api.apply.pos` | text(x,y) + 居中 | 同上 |
| 位置段 · 页内锚点 | `api.apply.anchor` | segmented | 同上 |
| 位置段 · 偏移 | `api.apply.offset` | text(dx,dy) | 同上 |
| 位置段 · 旋转 | `api.apply.rotation` | 滑杆 + 数值 | 同上 |
| 位置段 · 作用页 | `api.apply.pages` | text + All/Current | 同上 |
| 切分段 · 自动判定 | `api.split.auto` | toggle | `/api/pdf/split` |
| 切分段 · 已判定页 | `ui.split.vetoedPages` | 逐页 chip | 同上（veto 列表） |
| 切分段 · 手动切分 | `ui.split.mode` | segmented off/v2/h2/grid | 同上 |
| 切分段 · rows/cols | `api.split.rows` / `api.split.cols` | number | 同上 |
| 切分段 · 切点 | `api.split.cutFractions` | text + 切分预览 | 同上 |
| 切分段 · 切分页 | `api.split.pages` | text | 同上 |
| 骑缝段 · 骑缝章 | `api.apply.crossPage` | toggle | `/api/pdf/apply` |
| 骑缝段 · 装订边 | `ui.crosspage.binding` | segmented | 同上（几何见 §8 D2） |
| 骑缝段 · 起始位置 | `api.apply.startOffset` | 滑杆 + 数值 | 同上 |
| 骑缝段 · 逐页条带放大 | `ui.crosspage.stripPreview` | 每页 `<canvas>` | 预览（CP1） |
| 导出段 · 导出方式 | `api.export.mode` | segmented | `/api/pdf/export` |
| 导出段 · DPI | `api.export.dpi` + `customDpi` | segmented + number | 同上 |
| 导出段 · JPEG 质量 | `api.export.quality` | 滑杆 + 数值 | 同上 |
| 导出段 · 导出页 | `api.export.pages` | text + All | 同上 |
| 导出段 · 体积预估 | （只读派生） | `#estimate` | 由 FACTS §4 表算，不请求 |
| 保存弹窗 · 目标路径 | `api.save.targetPath` | text | `/api/pdf/save` |
| 保存弹窗 · 系统选择器 | `api.fs.pick.filePath` + `pathGrantId` | button + display chip | `/api/fs/pick` |
| 保存弹窗 · 替换原文件 | `api.save.replaceOriginal` | toggle + 二次确认 | 同上 |
| 口令弹窗 · PDF 口令 | `api.open.pw` | password | `/api/pdf/open` |
| 顶栏 · 语言/主题 | `ui.lang` / `ui.theme` | segmented | 无（前端） |
| 空态 · 路径输入 | `api.fs.pick.filePath` | text | `/api/fs/pick` |
| 资源钩子 · assetId | `decision.assetIds`（5 个 display chip，只显示句柄值，文案走 `title`） | 只读 | 响应侧 |
| 预览区 · 页框 / 画布 / 文本层 | （无字段：渲染态，页尺寸来自 `pdf.open` 响应） | `#preview-stage` 内 JS 生成 `.page-frame` → `canvas.page-canvas` + `.textLayer` | `GET /api/pdf/raw?id=`（pdf.js 逐页取字节） |
| 分页条 · 计数 + 每页 chip（chip 内含缩略图） | （无字段；形态见 §8 V2） | `#page-pager` 内 JS 生成 `span.chip[data-role=pager-count]` + `button.chip[data-page]`（`.pg-no` + `canvas.pg-thumb`） | 无（前端） |
| 标尺 / 像素读数 | （只读派生） | `#preview-ruler`、`#pixel-readout` | 由 `pdf.open` 的页 pt 尺寸 + 当前视图 scale 计算，不请求 |

滑杆 + 数值必须**双向绑定**（同一 `data-field` 复用两次，mock 已实现 `bindPair`）；
隐藏 `type=file` input 只作选择器触发器，不占字段。

## 4. i18n 清单（key | en | cn；共 270 键，全部由 mock + 状态文案生成；`node tools/verify/gen-i18n.mjs` 打印同数）

规则（AGENTS §7）：每个可见控件/文案必须有 `data-i18n` key，en/cn 两值非空；
`data-i18n-cn`（及 `-placeholder`、`-title`）提供中文值，en 取元素自身文本或 `class="tag"` 的字段名。
控制 key 约定 `<field 去掉 api. 前缀>.ctl` / `.hint`；JS 动态写入的 key（`dataset.i18n = …`、toast 文案）
同样在下表登记。`ui-contract.mjs` 校验 mock 的每个 key 都在表中、表中每行的 en/cn 非空。

|key|en|cn|
|---|---|---|
|api.apply.anchor.ctl|apply.anchor|页内锚点|
|api.apply.anchor.hint|Nine-point anchor; pdfcpu anchor constant.|九宫格锚点；落盘用 pdfcpu 锚点常量，pos 会被覆盖。|
|api.apply.blend.ctl|apply.blend|混合模式|
|api.apply.blend.hint|16 blend modes (PDF Table 136) grouped; backend writes ExtGState /BM.|16 种 PDF 混合模式（PDF 表 136），分组选择器；落盘写 ExtGState /BM。|
|api.apply.brightness.ctl|apply.brightness 0..2|明度|
|api.apply.brightness.hint|Preview-only (canvas filter), not written to PDF.|仅预览（前端 ctx.filter brightness），落盘不写。|
|api.apply.crossPage.ctl|apply.crossPage|骑缝章|
|api.apply.crossPage.hint|One strip per page, strip i on page i; merged after per-page stamping.|切分后每页放一枚条带，第 i 页第 i 条；落盘后逐页合并（P3）。|
|api.apply.offset.ctl|apply.offset|偏移（pt）|
|api.apply.offset.hint|Offset from anchor, may be negative.|相对锚点的偏移，可负；与骑缝章 startOffset 互相独立。|
|api.apply.opacity.ctl|apply.opacity 0..1|透明度|
|api.apply.opacity.hint|0..1 writes ExtGState /CA and /ca.|0..1，落盘 ExtGState /ca /CA（pdfcpu opacity 同义）。|
|api.apply.pages.ctl|apply.pages|作用页|
|api.apply.pages.hint|Accepts all, none, single pages, ranges.|支持 all / none / 单页 / 区间，例如 1-2,5。|
|api.apply.pos.ctl|apply.pos|位置（pt，左上原点）|
|api.apply.pos.hint|Either pos or anchor; anchor recomputes pos.|与页内锚点二选一；选锚点后 pos 自动归算。|
|api.apply.rotation.ctl|apply.rotation|旋转（度）|
|api.apply.rotation.hint|Degrees around the seal centre.|-180 到 180；印章绕自身中心旋转。|
|api.apply.saturate.ctl|apply.saturate 0..3|饱和度|
|api.apply.saturate.hint|Preview-only (canvas filter), not written to PDF.|仅预览（前端 ctx.filter saturate），落盘不写。|
|api.apply.scale.ctl|apply.scale|印章宽度（相对页宽）|
|api.apply.scale.hint|scale is a fraction of page width; pt shown in brackets.|scale 为相对页宽分数；括号内为换算后的 pt（A4 = 595.3pt）。|
|api.apply.startOffset.ctl|apply.startOffset|起始位置（pt）|
|api.apply.startOffset.hint|Start offset along the binding edge (pdfcpu offset:0 -N).|沿装订边的起始偏移（pdfcpu offset:0 -N）；0 为页首。|
|api.export.customDpi.ctl|export.customDpi|自定义 DPI|
|api.export.customDpi.hint|96..600, raster + custom only.|96..600，仅 raster 且 dpi=custom 时读取。|
|api.export.dpi.ctl|export.dpi|分辨率 DPI|
|api.export.dpi.hint|Effective in raster mode; custom uses customDpi.|raster 模式生效；custom 时取 customDpi。|
|api.export.mode.ctl|export.mode|导出方式（D1）|
|api.export.mode.hint|vector keeps text/vectors (searchable); raster flattens each page to a bitmap.|vector 保留文字/矢量（默认可搜索）；raster 整页位图，抗篡改、便于扫描件。|
|api.export.pages.ctl|export.pages|导出页|
|api.export.pages.hint|Same vocabulary as apply.pages.|与 apply.pages 同一词表。|
|api.export.quality.ctl|export.quality 40..95|JPEG 质量|
|api.export.quality.hint|40..95, raster only.|40..95；仅 raster。落盘用 stdlib DCTDecode（FACTS §4）。|
|api.open.pw.ctl|open.pw|PDF 口令|
|api.fs.pick.filePath.ctl|C:\docs\contract.pdf|文件路径（空态输入框 / 保存弹窗目标路径）|
|api.fs.pick.filePath.hint|Open the file by path; the picker grants a bounded pathGrantId.|按路径打开；选择器只授权一个有 TTL 的 pathGrantId。|
|api.fs.pick.pathGrantId.ctl|pathGrantId: grant-x9z|授权句柄（只读显示）：选择器返回的 pathGrantId|
|api.fs.pick.pathGrantId.hint|Owner-bound grant with TTL; upload falls back to multipart.|owner 绑定 + TTL；未授权时退化为 multipart 上传。|
|api.fs.pick.multi.ctl|multi|多文件选择|
|api.fs.pick.multi.hint|Allow selecting several PDFs (batch queue, P6).|允许多选 PDF（进入批处理队列，P6）。|
|api.fs.pick.filter.ctl|PDF only / All files|仅 PDF / 所有文件|
|api.fs.pick.filter.hint|Filter of the native picker; only .pdf is accepted by the app.|原生选择器过滤条件；应用只接受 .pdf。|
|api.open.pw.hint|UserPW and OwnerPW are both tried; AES-256 read is UNVERIFIED (FACTS 6).|UserPW/OwnerPW 都试；AES-256 读取链路目前 UNVERIFIED（FACTS §6）。|
|api.save.replaceOriginal.ctl|save.replaceOriginal|替换原文件|
|api.save.targetPath.ctl|save.targetPath|目标路径|
|api.save.targetPath.hint|Blank means same name + .stamp.pdf; atomic temp+rename.|留空则用同名 + .stamp.pdf；写盘走 temp+rename（原子写）。|
|api.seal.prepare.alphaTrim.ctl|seal.prepare.alphaTrim|自动裁边|
|api.seal.prepare.alphaTrim.hint|Trims the alpha bounding box, keeps the seal aspect ratio.|按 alpha 包围盒裁掉空白，保持印章本体比例。|
|api.seal.prepare.despill.ctl|seal.prepare.despill|去白底|
|api.seal.prepare.despill.hint|White-background keying applied live; reversible before save.|对白底扫描件即时去背；预览可撤销，预设保存时保留 alpha。|
|api.seal.prepare.resampleDpi.ctl|seal.prepare.resampleDpi|印章重采样 DPI|
|api.seal.prepare.resampleDpi.hint|Affects baked-in pixels only, not preview sharpness.|只影响落盘像素，不影响预览清晰度。|
|api.seal.preset.presetName.ctl|seal.preset.presetName|存为预设|
|api.seal.preset.presetName.hint|Presets keep image and parameter group together.|预设写入 %APPDATA%\AutoStamp\seals：图片与参数一起存。|
|api.split.auto.ctl|split.auto|自动判定 2 拼|
|api.split.auto.hint|Aspect-based heuristic; per-page veto list (decision D3).|按 MediaBox 纵横比判定；判定结果可被 vetoedPages 逐页否决（D3）。|
|api.split.cols.ctl|split.cols|网格列数 cols|
|api.split.cols.hint|cols >= 1.|cols >= 1。|
|api.split.cutFractions.ctl|split.cutFractions|切点（相对分数）|
|api.split.cutFractions.hint|Relative fractions 0..1, comma separated; pdfcpu rejects >= 1.|0..1 的相对分数，可多个（逗号分隔）；>1 或 >=1 会被拒绝（pdfcpu 实测）。|
|api.split.pages.ctl|split.pages|切分页范围|
|api.split.pages.hint|Same vocabulary as apply.pages.|与 apply.pages 同一词表。|
|api.split.rows.ctl|split.rows|网格行数 rows|
|api.split.rows.hint|rows >= 1.|rows >= 1；与 cols 一起决定等分网格。|
|app.open.btn|Open PDF|打开 PDF|
|app.save.btn|Save|保存|
|app.shortcuts.btn|Shortcuts|快捷键|
|split.undo.btn|Undo split|撤销切分|
|apply.undo.btn|Undo stamping|撤销盖章|
|apply.write.btn|Stamp into PDF|盖到 PDF|
|apply.write.hint|Bakes the instances into a new session asset; the original file is untouched. Saving stamps first if anything is still unbaked.|把实例烘焙成新的会话 asset（原文件不动）；保存时若仍有未落盘实例会自动先盖章。|
|asset.hint|asset ids|会话资产 ID（内部状态，只读）|
|binding.alternate|Duplex: odd right / even left|双面：奇右偶左|
|binding.none|No cross-page seal|无骑缝章|
|binding.right|Single-sided: right edge|单面：右缘连续|
|blend.group.compare|Compare|比较|
|blend.group.component|Component|分量|
|blend.group.contrast|Contrast|对比|
|blend.group.darken|Darken|增暗|
|blend.group.lighten|Lighten|增亮|
|blend.group.normal|Normal|正常|
|chip.2up|2-up|2 拼|
|chip.veto|vetoed|已否决|
|confirm.cancel|Save as new file|改存新文件|
|confirm.hint|The original will be overwritten (atomic temp+rename). This cannot be undone.|将覆盖原文件（原子写：先写临时文件再改名）。此操作不可撤销。|
|confirm.ok|Replace|确认替换|
|confirm.title|Replace original file?|替换原文件？|
|crosspage.binding.fixed|binding edge restored to right: a cross-page seal cannot stay on "no cross-page seal"|装订边已回到右缘：骑缝章不能停在「无骑缝章」|
|crosspage.on|on|开|
|del.hint|delete selected instance|删除选中的印章实例|
|dup.hint|duplicate instance|复制印章实例|
|empty.hint|Drop or paste a PDF here to open it, or drop/paste images to load them as seals. You can also pick a file or type a path.|把这里拖入或粘贴（Ctrl+V）一个 PDF 即打开；拖入/粘贴图片装载为印章。也可以选择文件 / 直接填写路径。|
|empty.msg|No PDF open|还没有打开 PDF|
|empty.open.btn|Open|打开|
|empty.path.placeholder|C:\docs\contract.pdf|C:\docs\contract.pdf|
|empty.pick.btn|Pick file|选择文件|
|empty.upload.btn|Upload|上传文件|
|err.corrupt.hint|Not a PDF or damaged header: cannot open|不是 PDF 或文件头损坏，无法打开|
|err.encrypted.hint|PDF is encrypted: password required|PDF 已加密，需要口令|
|err.fix.ext.hint|Remove .bin suffix|移除 .bin 后缀|
|err.apply.noDoc|no document is open|未打开文档|
|err.apply.noSeal|the selected instance has no seal yet|该实例还没有印章|
|err.pwEmpty.hint|password is empty|口令为空|
|err.savePermission.hint|Cannot write the file: locked by another process|无法写入文件：被另一进程占用|
|err.undo.empty|nothing to undo|没有可回退的步骤|
|err.undo.newer|undo the newer step first|请先回退更后的一步|
|esc.hint|close dialog / clear toast|关闭对话框 / 清除提示|
|export.customDpi.placeholder|96..600|96..600|
|export.dpi.custom|Custom|自定义|
|export.estimate.hint|about 124 KB/page (150dpi q75, A4).|每页约 124 KB（150dpi q75，A4 单页）。|
|export.estimate.label|Estimate|体积预估|
|export.estimate.note|Estimate scales the FACTS 4 measured table by page area and count.|预估值由 FACTS §4 实测表按页面积与页数缩放；raster 才受 DPI/质量影响。|
|fs.pick.filter.all|All files|所有文件|
|fs.pick.filter.pdf|PDF only|仅 PDF|
|fs.pick.multi.on|multi|多文件|
|instances.add.btn|Add instance|新增实例|
|instances.delete.btn|Delete|删除|
|instances.duplicate.btn|Duplicate|复制|
|instances.err.last|At least one stamp instance is required|至少需要保留一个印章实例|
|instances.rename.placeholder|Instance name|实例名称|
|load.drop.hint|Drop a PDF to open it, or images to load as seals|拖入 PDF 即打开文档；拖入图片装载为印章|
|load.paste.hint|paste or drop: one PDF opens, images load as seals|粘贴或拖入：单个 PDF 直接打开，图片装载为印章|
|load.reject.mix.hint|a drop or paste must be one PDF or images only, never mixed|PDF 与图片不能混在一起：要么单个 PDF，要么图片|
|load.reject.multi.hint|open one PDF at a time; use the batch panel for many files|一次只打开一个 PDF；多个文件请用批处理面板|
|load.reject.other.hint|only PDF files and images can be loaded here|这里只支持 PDF 文件与图片|
|load.seals.ok|seal images loaded|图片已装载为印章|
|lang.cn|中|中|
|lang.en|EN|EN|
|modal.cancel|Cancel|取消|
|modal.close|Close|关闭|
|nudge.hint|move 1pt (Shift: 10pt)|移动 1pt（Shift = 10pt）|
|ok.saved|saved (atomic temp+rename, ValidateFile passed)|已保存（原子 temp+rename，ValidateFile 通过）|
|ok.applied|stamped（已盖章，新 asset 已就绪）|已盖章（新 asset 就绪）|
|ok.exported|rasterised %d page(s) at %d dpi q%d|已光栅化 %d 页（%d dpi，质量 %d）|
|ok.undoStep|reverted to the previous step|已回退到上一步|
|open.hint|open a PDF|打开 PDF|
|overlay.filter.note|ctx.filter is context state: reset to none per layer (FACTS §1.4).|注意：ctx.filter 是上下文状态，每层叠加前必须置 none（FACTS §1.4）。|
|page.hint|jump to page|跳到某页|
|pager.count|page 1/5|页 1/5|
|pages.all.btn|All|全部|
|pages.current.btn|Current|当前页|
|panel.crosspage.title|Cross-page seal|骑缝章|
|panel.export.title|Export|导出设置|
|panel.instances.title|Instances|印章实例|
|panel.overlay.title|Overlay|叠加参数|
|panel.position.title|Position|位置与尺寸|
|panel.seal.title|Stamp|印章|
|panel.split.title|Split|切分（2 拼 → 单页）|
|position.center.btn|Center|居中|
|preset.ok|preset stored|预设已写入|
|pw.open.btn|Password|输入口令|
|pw.retry|Retry|重试打开|
|pw.title|Password required|需要口令|
|render.full.btn|Render at full size|按原尺寸渲染|
|ruler.hint|page size in pt; origin at top-left|页面尺寸（pt）；标尺原点在左上|
|save.confirm|Save|保存|
|save.hint|save dialog|保存对话框|
|save.open.btn|Save to file|保存到文件|
|save.pick.btn|System file picker|系统文件选择器|
|save.replace.hint|Replacing the original needs a second confirmation.|替换原文件需要再确认一次，且会丢弃原 PDF 的可选内容层。|
|save.replace.on|on|开|
|save.retryNew.btn|Save to a new file|改存新文件|
|save.title|Save PDF|保存 PDF|
|scale.hint|scale +-0.01|缩放 +-0.01|
|seal.alphatrim.on|on|开|
|seal.despill.on|on|开|
|seal.despill.revert|revert|撤销|
|seal.ok|sealId ready (alpha ring, SMask generated on save)|印章已就绪（带 alpha 环，落盘自动生成 SMask）|
|seal.preset.placeholder|Company A - red seal|公司甲 · 红章|
|seal.preset.save|Save preset|保存预设|
|seal.upload.btn|Upload seal PNG|上传印章 PNG|
|seal.meta.label|Seal metadata|印章元数据|
|seal.upload.hint|Keying, trim and resample follow the options above; revert re-runs from the source.|去白底/自动裁边/重采样按上方参数处理；「撤销」会用原图重跑一次。|
|seal.err.type|Stamp image must be PNG or JPEG with an alpha channel|印章图片必须是带透明通道的 PNG 或 JPEG|
|seal.err.nosource|Upload a seal image first, then revert|先上传印章图片，再点撤销|
|stamp.box.aria|Selected stamp instance position|选中印章实例的位置|
|stamp.drag.hint|Drag the dashed box to move; corners resize; the top handle rotates|拖动虚线框移动，四角缩放，顶部手柄旋转|
|shortcuts.hint|shortcut list|快捷键列表|
|shortcuts.title|Shortcuts|快捷键|
|split.apply.btn|Split preview|切分预览|
|split.auto.on|on|开|
|split.err.badFraction.hint|cut fraction must be in (0,1) - pdfcpu rejects >= 1|切点必须落在 (0,1)；pdfcpu 会拒绝 >=1|
|split.mode.grid|Grid|网格|
|split.mode.h2|2-up TB|2 拼（上下）|
|split.mode.off|No split|不切|
|split.mode.v2|2-up LR|2 拼（左右）|
|split.ok|split preview ready|切分预览就绪（剔除原页后替换页面列表）|
|theme.dark|Dark|深色|
|theme.light|Light|浅色|
|top.file.hint|no file open|未打开文件|
|ui.crosspage.binding.ctl|Binding edge (D2)|装订边（D2）|
|ui.crosspage.binding.hint|Right edge, duplex odd-right/even-left, or no cross-page seal; picking none clears apply.crossPage.|右缘连续 / 双面奇右偶左 / 无骑缝章；选无骑缝章即清掉 apply.crossPage。|
|ui.crosspage.stripPreview.ctl|Per-page strip zoom|逐页条带放大|
|ui.crosspage.stripPreview.hint|Zoomed strip per page; the main canvas shows the same strip.|每页一枚条带的放大预览；主画布也叠加同一条带（CP1）。|
|ui.split.mode.ctl|Manual split|手动切分|
|ui.split.mode.hint|manual overrides auto; rows/cols and cutFractions go to the API.|manual 覆盖 auto；rows/cols 与 cutFractions 都进 /api/pdf/split。|
|ui.split.vetoedPages.ctl|Auto-detected pages|已判定页|
|ui.lang.ctl|EN / 中文|语言切换|
|ui.lang.hint|Interface language; every label carries a key.|界面语言；每个标签都有 i18n key。|
|ui.theme.ctl|Light / Dark|浅色 / 深色|
|ui.theme.hint|Colour tokens (UI_SPEC 6) switch as one set.|配色令牌（UI_SPEC §6）一并切换。|
|ui.split.vetoedPages.hint|Click a page to veto its auto-split.|点击某页即否决其自动切分；否决页保持原样不切。|
|warn.noText.hint|No extractable text layer: this file has only scanned images|无可抽取文字层：该文件只有扫描图像|
|warn.render.hint|Page 3 has 33 MP: rendered at reduced scale|第 3 页 33 MP：已按缩略尺寸渲染|
|warn.export.tooBig|page bitmap exceeds the 90 MB cap: lower DPI to 300 or fewer pages|单页位图超过 90 MB 上限：请把 DPI 降到 300 或少选几页|
|api.batch.files.ctl|batch input|批处理输入|
|api.batch.files.hint|picked with the native picker; a folder picks every *.pdf in it|由原生选择器取得；选目录则收该目录下所有 .pdf|
|api.batch.dirPath.ctl|folder|目录|
|api.batch.autoSplit.ctl|auto split first|先自动切分|
|api.batch.splitMode.ctl|split mode|切分方式|
|api.batch.rows.ctl|rows|行数|
|api.batch.cols.ctl|cols|列数|
|api.batch.crossPage.ctl|cross-page seal|骑缝章|
|api.batch.binding.ctl|binding edge|装订边|
|api.batch.startOffset.ctl|start offset|起始位置|
|api.batch.presetName.ctl|preset|批处理预设|
|api.batch.presetName.hint|the preset carries the seal image and the stamp/cross-page parameters|预设提供印章图与盖章/骑缝参数（PR1）|
|api.batch.dpi.ctl|resolution DPI|分辨率 DPI|
|api.batch.dpi.hint|every file is re-exported raster at this DPI (BM1)|每个文件都按此 DPI 光栅重导出（BM1）|
|api.batch.customDpi.ctl|custom DPI|自定义 DPI|
|api.batch.quality.ctl|JPEG quality|JPEG 质量|
|api.batch.concurrency.ctl|concurrency|并发数|
|api.batch.concurrency.hint|how many files the front-end queue runs at once|前端队列同时处理几个文件（1..8）|
|batch.preset.placeholder|pick a preset|选择预设|
|batch.skip.encrypted.hint|encrypted PDFs are skipped and listed in the report, no password prompt|加密 PDF 直接跳过并在报表列出，不弹密码框|
|batch.report.title|Report|报表|
|batch.report.hint|one row per file; CSV/JSON download below|每文件一行；下方可下载 CSV/JSON|
|batch.export.csv|CSV|CSV|
|batch.export.json|JSON|JSON|
|batch.status.encrypted|skipped (encrypted)|跳过（加密）|
|seal.preset.select|preset list|预设列表|
|seal.preset.saved|preset saved|预设已保存|
|seal.preset.deleted|preset deleted|预设已删除|
|seal.preset.empty|no presets yet|还没有预设|
|seal.preset.nameNeeded|preset name is required|预设名不能为空|
|seal.preset.noSeal|upload a seal before saving a preset|先上传印章再存预设|
|seal.preset.loaded|preset loaded, panel updated|预设已载入,参数已写入面板|
|batch.started|batch started|批处理已启动|
|batch.done|batch finished|批处理结束|
|batch.stopped|batch stopped by user|批处理已被用户停止|
|batch.empty|no PDF in this folder|该目录下没有可处理的 PDF|
|batch.noPreset|pick a preset first|请先选择预设|
|batch.fileFail|file failed|文件处理失败|
|batch.title|Batch|批处理|
|batch.pickFiles|Pick PDFs|选择 PDF|
|batch.pickDir|Pick folder|选择目录|
|batch.start|Run batch|开始批处理|
|batch.cancel|Cancel|取消|
|batch.queue.hint|one row per file, in order|每个文件一行，按顺序|
|batch.progress.idle|idle|空闲|
|batch.status.pending|queued|排队|
|batch.status.running|running|进行中|
|batch.status.ok|ok|成功|
|batch.status.fail|failed|失败|
|batch.files.count|%d file(s) selected|已选 %d 个文件|
|batch.out.hint|writes into <folder>\_batch, dpi/quality in the file name|写进 <目录>\_batch，文件名带 dpi 与质量（BM2）|
|ok.batch.started|batch started: %d file(s)|批处理已开始：%d 个文件|
|ok.batch.done|batch done: %d ok, %d failed|批处理完成：%d 成功，%d 失败|
|warn.batch.rasterUnsupported|batch writes vector only: raster needs the on-screen preview|批处理只做矢量落盘：光栅化要有预览页面|
|err.batch.noPreset|pick a seal preset first|先选一个印章预设|
|err.batch.noSources|pick files or a folder first|先选文件或目录|
|err.batch.dirEmpty|no PDF under that folder|该目录下没有 PDF|
|seal.preset.label|Preset|预设|
|seal.preset.load|Apply preset|应用预设|
|seal.preset.delete|Delete preset|删除预设|
|ok.preset.applied|preset applied|预设已应用|
|ok.preset.deleted|preset deleted|预设已删除|
|warn.preset.name|preset name is empty|预设名不能为空|
|warn.preset.noSeal|upload a seal image first|请先上传印章图片|

## 5. 快捷键（mock 已注册，P1/P2 起在真实 UI 里同样注册）

|键|动作|字段|
|---|---|---|
|Ctrl+O / Ctrl+S|打开 / 保存弹窗|open.* / save.*|
|Ctrl+V / 拖入窗口|装载：单个 PDF 打开文档；图片（单/多张）装载为印章（PD1/PD2）|load.*|
|Ctrl+D / Del|复制 / 删除当前实例|instance|
|左键拖拽 / 拖句柄|移动 / 缩放|pos / scale|
|旋转句柄拖拽|按中心旋转|rotation|
|←↑↓→（Shift=10pt）|1pt 步进|pos|
|+ / −|scale ±0.01|scale|
|1..9 / PgUp/PgDn|跳页|current|
|Ctrl+滚轮|按中心缩放（P1 = 预览视图缩放；P2 起光标在选中实例上时 = `apply.scale`，见 §8 V3）|scale / 视图|
|Esc / ?|关闭弹窗、清除 toast / 快捷键表|—|

## 6. 契约 DOM id

P0/P1 的 `index.html` 必须使用下表 id（`ui-ids` 块 = `ui-contract.mjs` 校验表）；
新增 id 要先登记，mock 缺该 id 即报错。

```ui-ids
app-main  app-root  apply-anchor  apply-blend  asset-hooks  batch-auto-split  batch-binding  batch-cols  batch-cross-page  batch-files  batch-pick-dir  batch-pick-files  batch-progress  batch-queue  batch-rows  batch-split-mode  batch-start  batch-start-offset  btn-open  btn-save  btn-shortcuts  confirm-cancel  confirm-modal  confirm-ok  crosspage-binding  drop-hint  empty-open  empty-path  empty-pick  empty-pick-filter  empty-pick-multi  empty-state  empty-upload  estimate  estimate-per-page  estimate-total  export-dpi  export-mode  instance-add  instance-delete  instance-duplicate  lang-seg  modal-layer  page-pager  panel  panel-actions  panel-batch  panel-crosspage  panel-export  panel-instances  panel-overlay  panel-position  panel-seal  panel-split  password-modal  pixel-readout  pos-center  preview  preview-ruler  preview-stage  pw-cancel  pw-retry  right-sidebar  save-cancel  save-confirm  save-modal  file-input  error-toast  save-open  save-pick  save-source  scale-pt  seal-despill-revert  seal-file-input  seal-instances  seal-meta  seal-preset-delete  seal-preset-load  seal-preset-name  seal-preset-save  seal-preset-select  seal-upload  stamp-layer  shortcuts-close  shortcuts-modal  shortcuts-table  split-apply  split-mode  split-veto  strip-previews  theme-seg  top-file  topbar

```

`#file-input` 是隐藏的 `<input type=file>` 选择器触发器，不占字段（§2 里没有 `data-field`）。

`#top-file` 是**窗口标题文本**（HD2，2026-11-03）：无文档 = `AutoStamp <版本>`，打开后追加
` 文件名`；其 `title` 属性 = 完整路径 · 体积。`#app-main` 不再带版式属性（固定 two-col，HD3）。

`#preview-stage` 的页框与 `#page-pager` 的分页 chip 全部由 JS 生成（不占契约 id，靠
`class` + `data-page`）；`#asset-hooks` 与 `pathGrantId` 的 chip 只显示句柄值本身，
本地化文案放 `title` / `aria-label`（这两处文本是动态的，带 `data-i18n` 会和 `applyLang()`
「元素自身文本 = en 值」的规则打架，见 §4）。

## 7. mock 驱动接口（verify 用）

`window.__autoStampMock`：`STATES`、`setState(name)`、`verifyState(name)`、
`setParams({api.x: v,…})`、`probe(name)`、`applyLang(lang)`、`applyTheme(t)`、
`i18n()`（DOM 快照）、`fields()`、`ids()`、`q()/qa()`、`setModal()/clearToast()`。
`probe` 关键字：`state` `overflow` `images` `instances` `split` `strip` `pixel-blend` `estimate`。

深链：`mockup.html#crosspage`（`hashchange` 会重走状态机）。

### 7.1 真实壳的驱动接口（`web/static/app-shell.js`，`tools/verify/shell-smoke.mjs` 用）

`window.__autoStampShell`：`STATES`、`setState(name)`、`verifyState(name)`、
`setParams({api.x: v,…})`（写控件并派发 `input`/`change`，因此走真实 persist 路径）、
`fields()`（全部 `data-field` 控件快照；display-only `span` 不计）、`ids()`、
`i18nPairs()`（每个 `data-i18n` 的 en+cn 原值，另有 kind `title`：`[data-i18n-title]` 的图标按钮
tooltip）、`probe(name)`、
`applyLang(lang)`、`applyTheme(t)`、`setModal(id)`、`clearToast()`、
`addInstance(name, params)`、`selectInstance(id)`、`deleteSelected()`、`duplicateSelected()`、
`APPLY_FIELDS`、`defaultParams()`、`instanceById(id)`、`selectedInstance()`、
`setParam(field, value)`（改**选中实例**的参数并派发 input/change，等价于滑杆改值）、
`setSealForSelected(sealId)`、`notify(name, detail)`、
`adopt(info, pw)`（文档接管的唯一漏斗：状态翻转 + `assets.*` 记账 + `preview.open`；
`pixel-matrix` 真链路驱动的就是它，而不是直接调预览模块）、
`q()/qa()`、`t(key)`。
`probe` 关键字：`state` `overflow` `instances` `instanceCount` `selected`
`modal` `toast` `lang` `theme` `version`（纯版本串）`docTitle`（窗口/标签页标题，HD2）`labels`
`estimate`（导出体积预估，见 §7 E1）
`load`（粘贴/拖拽装载读数：`{kind: pdf|seals|reject, reason, names, count}`，见 §8 PD1/PD2）。

`window.__autoStampPreview`（`app-preview.js`）：`open(info)`、`setPassword(pw)`、`reload(pw)`、
`close()`、`goTo(n)`、`next()`、`prev()`、`zoomBy(step)`、`zoomTo(v)`、`fit()`、`pageCount()`、
`pageMeta(n)`、`sample(x,y,w,h)`（`x,y,w,h` 为 PDF 点，返回 RGBA + 换算后的像素矩形）、
`probe(name)`：`page` `pageCount` `asset` `zoom` `fitZoom` `dpr` `canvas` `textLayer` `reduced`
`splitPreview`（P3 切分预览：`on` `marks` `boxes` `parts`，`marks` 按 `split.mode` 画在页框上）。
`window.__autoStampTextLayer`（`app-textlayer.js`）：`attach({pdfjs,pageObj,viewport,frame,dpr})`、
`count(pageObj)`。`window.__autoStampPager`（`app-pager.js`）：`build()`、`refresh()`。

`window.__autoStampSeal`（`app-seal.js`，P2 印章图通道）：`upload(file)`（→
`POST /api/pdf/seal/prepare`，选项取面板 `seal.prepare.*`）、`prepare(file, override)`、
`revert()`（用内存里的原始上传重跑 `despill:false`，即「撤销去背」）、`bitmapOf(sealId)`、
`renderMeta(sealId)`、`lastSource()`、`probe(name)`：`seals` `count` `meta`。

`window.__autoStampOverlay`（`app-overlay.js`，P2 叠加层）：`paint(ctx, info)`（由
`app-preview.js` 在每次页渲染后调用：先把干净页存进 `state.snapshot`，再把印章合成进
同一 canvas —— FACTS §1.3 的预览==落盘等值性只在这条路径成立）、`repaint()`（拖拽用的
廉价重合成，不重跑 pdf.js）、`syncAffordance()`、`selectAt(ev)`、`hitTest(pt)`、
`consumeWheel(ev)`（V3：光标在选中实例上时滚轮 = `apply.scale`）、`parsePages(spec)`、
`rectFor(inst)`、`beginDrag/moveDrag/endDrag`、
`probe(name)`：`rects` `strips` `view` `affordance`（选中实例的包围盒 + 句柄数）、`drag`
（`moveDown/centerDown/rotDown` 命中诊断）、`instancePixels`（该实例四角的本机
alpha/预乘 RGB，见 §11 P2 反算规则）、`selected`、`filter`（`ctx.filter` 读数，
FACTS §1.4）、`snapshot`、`canvasRect`。另有 `imageDataOf(canvas)` 与
`pixelsForRect(info, rect)` 两个纯函数供 verify 脚本算像素。

跨模块事件（`app-shell.js` 派发，`app-pager.js` / `app-preview.js` / `app-overlay.js` 监听）：
`autostamp:lang`（语言切换后重绘动态读数）、`autostamp:open`（新文档打开，重建分页条）、
`autostamp:page`（翻页，更新分页条 pressed 态与计数）、
`autostamp:param`（面板参数改动 → 实例参数 + 叠加层重绘）、`autostamp:seal`（实例换印章）、
`autostamp:instance`（实例列表变化）。
深链：`http://127.0.0.1:<port>/#crosspage`（`hashchange` 重走状态机；清空 hash 回文档态）。
校验命令：`node tools/verify/shell-smoke.mjs`（真二进制 + headless Chromium，
沙箱化 `%APPDATA%`/`%LOCALAPPDATA%`）、`node tools/verify/preview-smoke.mjs`
（P1 查看链路：现场生成样本 + 真 UI 打开 + 像素/文本层/翻页断言，FACTS §1.7）、
`node tools/verify/overlay-smoke.mjs`（P2 叠加层：上传→16 模式×3 透明度→几何/拖拽/旋转
→骑缝条带→filter 污染，见 §7.1 与 FACTS §1.3）、
`node tools/verify/webview-launch.mjs`（WebView2 真窗口）、
`go run ./tools/verify/comprobe`（COM 实测，FACTS §1.6）。

## 8. 决策表（用户确认记录）

|编号|问题|选项（推荐默认标注）|用户选择|日期|来源|
|---|---|---|---|---|---|
|D1|保存默认导出方式|vector（保留文字/可搜索）/ raster（整页位图）|已确认：vector（mock `export.mode=vector`，用户可切 raster）|2026-10-29|ask 第 2 轮 d1-mode|
|D2|骑缝章装订边（三档）|right 单面右缘 / alternate 双面奇右偶左（左右属同一条分割）/ none 无骑缝章|已确认：三档可选（right / alternate / none）。原文「可选，1、单面仅右侧。2、双面奇偶分别左右，左右的是两个章分割。3、无骑缝章」；`left` 未列入，已移除|2026-10-29|ask 第 1 轮 d2-binding|
|D3|自动切分触发|auto 判定 + 逐页 veto / 手动切点 / 一键否决|已确认：自动判定 + 逐页否决（`split.auto` 开，`#split-veto` 逐页勾选否决）|2026-10-29|ask 第 1 轮 d3-split|
|D4|印章去白底|前端即时去背（可撤销）/ 仅预设时 / 不做|已确认：预览即时去背 + 可撤销（`seal.prepare.despill` 默认开，`revert` 按钮 + toast）|2026-10-29|ask 第 1 轮 d4-despill|
|L1|布局密度|two-col / single-col / collapsed|已确认：two-col 默认（顶栏仍可切 single-col / collapsed）。**2026-11-03 作废（HD3）**：版式固定 two-col，切档控件与 `ui.density` 契约字段整条删除|2026-10-29|ask 第 1 轮 l1-density|
|CP1|骑缝章预览形态|主画布 + 侧栏逐页条带 / 仅主画布 / 仅条带|已确认：逐页条带缩略图 + 主画布叠加（`#strip-previews` 与主画布同随 `apply.startOffset`）|2026-10-29|ask 第 1 轮 crosspreview|
|I1|多印章实例形态|实例列表 + 新增/复制/重命名（推荐）/ 单实例覆盖式|已确认：列表 + 重命名（`#seal-instances` 行内改名 + normal/cross-page 徽章；新增/复制/删除按钮）|2026-10-29|ask 第 2 轮 i1-instances|
|S1|保存/替换原文件确认|保存弹窗 + 二次确认（推荐）/ 无弹窗直接写 / 只替换时弹窗|已确认：保存弹窗（`#save-modal`：目标路径 + pathGrantId）+ 替换原文件时二次确认（`#confirm-modal`）|2026-10-29|ask 第 2 轮 s1-save|
|E1|导出体积预估展示|导出段内联 + 换算说明（推荐）/ 悬停 tooltip / 不显示|已确认：导出段内联（`#estimate-total` / `#estimate-per-page` + `export.estimate.note` 换算说明，随 dpi/quality/mode 实时改）|2026-10-29|ask 第 2 轮 e1-estimate|
|B1|批处理并发|3（§9 默认，不阻塞）|未评审默认|2026-10-28|§9|
|D5|非 Windows 原生窗口|回退浏览器（不阻塞 P0.5）|未评审默认|2026-10-28|§9|
|V1|P1 预览区显示形态|单页视图 + 分页条（推荐）/ 连续多页滚动（mock 里两页并排）|已确认：单页视图（一次渲染一页；翻页走分页条、`1..9`、`PgUp/PgDn`）|2026-10-29|ask 第 3 轮 view|
|V2|P1 分页条形态|仅 chip 分页条（P0.5 冻结形态）/ chip + chip 内缩略图（无新增 id）/ 独立缩略图侧栏（需新增契约 id）|已确认：chip + chip 内缩略图，都在 `#page-pager` 内（`button.chip[data-page]` 里的 `canvas.pg-thumb`，`IntersectionObserver` 懒渲染）|2026-10-29|ask 第 3 轮 pager|
|V3|Ctrl+滚轮归属|P1 = 预览视图缩放，P2 起交给 `apply.scale`（推荐）/ 只留给印章 / 另立按键|已确认：P1 滚轮缩放视图；P2 起「光标在选中实例上」时滚轮 = `apply.scale`，页背景仍为视图缩放|2026-10-29|ask 第 3 轮 wheel|
|C1|页内坐标原点（`pos`/`offset` 的 y 方向）|display 空间、原点左上、y 向下（推荐：与 `#preview-ruler` 一致，拖拽手柄也按它画）/ PDF 原生 y 向上（用户要换算心里有记）|未评审默认（P2 实测：手柄、标尺、条带都按左上原点；P4 落盘换算有单测钉死）|2026-10-29|待 ask 下一轮确认；不确认即按默认|
|W1|印章何时真正写进 PDF（落盘时机）|「盖到 PDF」按钮 + 保存时自动补盖章（推荐）/ 只有按钮 / 保存时自动无按钮|已确认：按钮（`#apply-write`）+ 保存弹窗点「保存」时若有未落盘实例先自动 apply|2026-10-30|ask 第 4 轮 apply-trigger|
|W2|盖章后实例叠加层的处理|切到已盖章 asset、清空已落盘实例（推荐）/ 保留可继续微调 / 保留但禁用编辑|已确认：切到已盖章 asset 并清空已落盘实例（预览显示 PDF 里已有的章，不会二次叠加）|2026-10-30|ask 第 4 轮 after-apply|
|W3|撤销盖章入口|顶栏「撤销盖章」按钮（推荐）/ 实例行撤销 / 无撤销按钮|已确认：`#apply-undo`（另配 `#split-undo` 撤销切分；逐级回到上一个 asset）|2026-10-30|ask 第 4 轮 undo-entry|
|W4|实例 pages 的落盘语义|按实例 pages 词表逐页写（推荐）/ 只写当前可见页|已确认：按实例 `pages` 词表逐页落章（与 P2 预览按 pages 绘制一致）|2026-10-30|ask 第 4 轮 pages-semantics|
|W5|光栅导出（raster）何时真正触发|保存弹窗「保存」时按导出段参数自动光栅化（推荐，不加新控件）/ 导出段新增「光栅化并导出」按钮（新契约 id）/ 顶栏「导出」+ 独立弹窗|已确认：保存时自动光栅化 —— `mode=raster` 则先渲染页位图 → `POST /api/pdf/export` → adopt 新 asset → 写盘；`mode=vector` 不发该请求（源资产直接写）。实现决定（2026-11-02，不新增控件、不改词表）：同一份 raster 参数第二次保存**不再**光栅化，复用已光栅化的 asset；只有 `dpi/质量/pages` 变了才重光栅化一次|2026-11-02|ask P5 轮 raster-trigger|
|W6|单页位图超过 90 MB 上限（PLAN P5）时的行为|提交前拦截 + 提示降 DPI（推荐）/ 服务端只告警不拒绝 / 前端自动降到 300 dpi|已确认：提交前拦截 —— 前端按体积预估（§E1，FACTS §4 换算）在发请求前挡住并提示降 DPI（i18n `warn.export.tooBig`）；服务端仍留硬限，超 90 MB/页回 400 `page_too_large`|2026-11-02|ask P5 轮 raster-limit|
|PR1|印章预设存什么|图片 + `api.apply.*` 全套参数（推荐）/ 只存参数组（图片另选）/ 图片 + 参数 + 导出参数（工作预设）|已确认：图片 + 印章/骑缝参数（含 `seal.prepare.*` 去背选项），导出参数不进预设|2026-11-02|ask 第 6 轮 preset-scope|
|PR2|预设库界面与导入导出|印章段内联：下拉 + 保存/另存/删除（推荐）/ 内联 + 两个 zip 按钮 / 独立缩略图面板|已确认：印章段内联 `#seal-preset-select` + `#seal-preset-load` + `#seal-preset-save` + `#seal-preset-delete`；不做 zip（`%APPDATA%\AutoStamp\seals\` 目录即数据）|2026-11-02|ask 第 6 轮 preset-ui|
|RF1|最近文件入口形态|启动页列表 + 顶栏下拉（推荐）/ 只在启动页空态列表 / 右侧栏常驻面板|已确认：启动页列表 + 顶栏下拉，两处同一个数据源（`config.recentFiles`，最多 24 条，P0 已实现）。**2026-11-03 作废（HD1）**：两个 UI 入口都删，`config.recentFiles` 后端继续记录但不再展示|2026-11-02|ask 第 7 轮 recent-ui|
|BC1|批处理进度通道|面板内队列 + SSE 流（推荐）/ 队列 + 轮询 status / 无队列 UI 一次性任务|已确认：队列 `#batch-queue` + 每文件状态 排队/进行中/成功/失败。（原 `GET /api/batch/events` SSE 被 BM1 作废：批处理由前端逐文件跑链，进度就是前端队列状态，不再有 SSE 路由）|2026-11-02|ask 第 6 轮 batch-progress + 第 8 轮 batch-mode|
|BC2|批处理输入与输出命名|多文件 + 目录，输出同级 `<名>_seal.pdf`（推荐）/ 输出写进 `out/` / 可选覆盖原文件|已确认：输入 = `fs/pick` 多选 + 目录；输出 = 与源同目录、同名加 `_seal`（派生产物，重跑可覆盖）；**绝不覆盖源文件**；失败项跳过并记错误码|2026-11-02|ask 第 6 轮 batch-io|
|BC3|批处理是否带切分/骑缝|可选开关 `autoSplit` + `crossPage`（推荐）/ 只盖普通印章 / 强制 auto 切分|已确认：两个开关随任务走；`autoSplit` 带 `splitMode/rows/cols`（切分词表 = §2.2），`crossPage` 带 `binding/startOffset`|2026-11-02|ask 第 7 轮 batch-split|
|BC4|批处理的导出形态|只矢量落盘（推荐）/ 让用户也选光栅参数|第 8 轮（2026-11-02）确认：**走前端逐文件完整链**，光栅的 dpi/质量 真生效（`api.batch.dpi/customDpi/quality`），见 BM1；原先「只矢量落盘」的实现决定作废|2026-11-02|ask 第 8 轮 batch-mode|
|BM1|批处理怎么跑|前端逐文件跑完整链（真 dpi/质量）/ 后端作业只做矢量 / 两者都做|已确认：前端逐文件跑完整链 —— `fs/pick`(filePath) → `open` →（`split`）→ `apply` →（`export` 光栅，页位图由前端渲染回传）→ `save(mkdirs)`；并发 = 前端队列数（`api.batch.concurrency`，默认 2，1..8）。BC1 的 SSE 通道随之作废：队列与进度都在前端|2026-11-02|ask 第 8 轮 batch-mode|
|BM2|批处理输出放哪里|每文件建 `原名_batch` 子目录 / 单个 `_batch` 目录 + 文件名加前缀|已确认：原目录下只加一个 `_batch`，内部 N 个 PDF，文件名 `原名.dpi<数字>.q<数字>.pdf`（例 `a-01.dpi150.q75.pdf`；取代 BC2 的「同名加 `_seal`」）；**绝不改源文件**；**单扩展名**是硬要求（`fsx.ValidateTargetPath`/`CheckWriteTarget` 只认 `.pdf`，多后缀会被 `path_denied`）|2026-11-02|ask 第 8 轮 batch-output|
|BM3|批处理的印章与参数从哪来|选一个已存印章预设 / 用当前面板参数 + 当前上传印章|已确认：选一个已存预设（印章图 + 盖章/骑缝参数都从预设，PR1）；`api.batch.presetName` 是必填项，没选预设不开工|2026-11-02|ask 第 8 轮 batch-params|
|BM4|加密 PDF 在批处理里怎么处理|跳过 + 报表列出（不弹密码）/ 整批用一个密码框|已确认：跳过并记 `password_required` 到报表，不弹密码框；要处理加密件回单文件走链（§2 `api.open.pw`）|2026-11-02|ask 第 8 轮 batch-password|
|BM5|预设里的 `pages` 在批处理里怎么作用|原样照抄（可能 400）/ 逐文档求交集|实现决定（2026-11-02，`app-batch.js` 的 `pagesForDoc`）：预设的 pages 词表**对每一份文档**解析 —— 越界页丢弃（1 页文档配 `1-2,5` 预设是正常情况，不是错误），交集为空则回退 `all`。否则「一个预设跑不同页数」的核心场景直接失败。单文档面板不受影响（W4 语义不变）|2026-11-02|实现决定|
|PC1|交付打包形态|zip：单 exe + README（推荐）/ zip + 带图标 exe / 不做安装包|已确认：`build.ps1 -Task package` 产 `dist\autostamp-<ver>-win64.zip`（webview-stripped exe + README）；不做安装器、不做图标资源（要 .syso 就得引外部工具）|2026-11-02|ask 第 6 轮 packaging|
|OP1|P6 可选项（页眉页脚 / 多印章）|不做，登记为未采纳（推荐）/ 做页眉页脚|已确认：不做。多印章已由 P2 的多实例覆盖；页眉页脚不在产品需求 1–5 内|2026-11-02|ask 第 7 轮 optional-scope|
|PD1|剪贴板装载（Ctrl+V）语义|只接受「单个 PDF」或「一张/多张图片」，其余不装载并告警（推荐）/ 任意文件都装 / 只有 PDF 可装|已确认（2026-11-03 用户任务明确请求 + 实现决定）：只接受两类 —— 单个 PDF → multipart 打开（adopt）；一张或多张图片 → 逐个 `seal/prepare`：单张设给选中实例（与「上传印章」同语义），多张时第一张设给选中实例、其余各**新增一个实例**按文件名命名装载；无文档（空态）只 prepare+元数据读数，不指派。焦点在输入框且剪贴板含 text/plain 时放行文本粘贴（路径框语义不受粘贴装载影响）。多个 PDF / PDF+图片混拼 / 其它文件 → toast 告警不装载|2026-11-03|用户任务要求 + 实现决定|
|PD2|鼠标拖拽装载|窗口级 dragover/drop 与 PD1 同一 gate；`#preview[data-drag]` + `#drop-hint` 可见反馈（推荐）/ 只拖预览区 / 不加反馈|已确认（2026-11-03 用户任务明确请求）：窗口级装载同一 gate；dataTransfer 不含 Files 时不 preventDefault（纯文本拖拽不被劫持）；反馈 = 预览区高亮 + `#drop-hint`（§6 新契约 id）；装载图片走同一 seals 通道，装载 PDF 走 handleFiles（adopt 替换当前文档，与「上传」按钮同语义）|2026-11-03|用户任务要求|
|HD1|顶栏有什么|保留全部按钮（品牌 / 最近 / 上传 / 导出设置 / 密度 / 版本 chip）/ 精简为一组图标控件|已确认（用户 2026-11-03 对话指令）：删品牌文字、最近文件入口、顶栏「上传」、「导出设置」入口、密度切档、版本 chip；余下控件全部图标化（内嵌 SVG 图标 + `data-i18n-title` tooltip，cn 孪生 `data-i18n-title-cn`），打开左对齐、保存 + 快捷键 + 语言 + 主题右对齐|2026-11-03|用户 2026-11-03 对话指令|
|HD2|版本号和文件名显示在哪|顶栏文本承载 / 新增版本 chip / 只写窗口标题栏（标签页同源）|已确认（用户 2026-11-03 对话指令）：`#top-file` 就是窗口标题文本 —— 无文档 = `AutoStamp <版本>`，打开后追加 ` 文件名`；版本串同时写进原生窗口标题栏（Go `windowTitle`）与浏览器标签页（`document.title`）；**不新增任何控件**|2026-11-03|用户 2026-11-03 对话指令|
|HD3|版式还可切换吗|固定 two-col / 保留 single-col 与 collapsed 切档|已确认（用户 2026-11-03 对话指令）：固定 two-col（CSS 基础规则就是两栏）；`ui.density` 字段、`[data-density=…]` 规则、`setDensity` 驱动接口全部删除，settings 的 patch 不再接受 `ui.density`|2026-11-03|用户 2026-11-03 对话指令|
|HD4|未打标签的构建显示什么版本号|沿用 Go 伪版本（`v0.0.0-<日期>-<hash>+dirty`）/ 固定 dev 横幅|已确认（用户 2026-11-04 对话指令）：版本 = **`0.1-dev`**，`internal/app.pickVersion` 只认真实标签——伪版本、`devel`、`+dirty` 一律回落到 `devVersion`，标题栏不带 commit 串；真标签（`v1.2.3`、`v1.2.3-rc.1`）照旧直接显示|2026-11-04|用户 2026-11-04 对话指令|


D2–D4、L1、CP1 已在 P0.5 第 1 轮确认（2026-10-29）；D1、I1、S1、E1 在第 2 轮确认（同日）。
HD1/HD2/HD3/HD4 不是 ask 轮次，而是 2026-11-03/11-04 用户在对话里直接下的指令（顶栏收尾 +
版本号取值），因此来源列写「用户 … 对话指令」；HD1/HD2/HD3 作废了 L1（切档控件）与
RF1（最近文件 UI 入口）的可见形态，后端数据与字段不变。

W5、W6 是 P5（光栅导出）开工前的落盘/保存语义，用第 5 轮确认（2026-11-02）。
P6 的 PR1/PR2/RF1/BC1–BC3/PC1/OP1 是开工前的预设/批处理/打包语义,用第 6 轮（5 条）与
第 7 轮（3 条）确认（2026-11-02）。BC4 是实现决定,不是新语义:光栅的页位图只能来自
前端预览（pdfcpu 无 rasterize,FACTS §2.4）,批处理没有预览,所以批处理只走矢量落盘。
V1–V3 是 P1 开工前的形态问题，用第 3 轮确认（同日），因为它们改的是预览区/分页条的可见形态而非字段词表。
B1/D5 属 `IMPLEMENTATION_PLAN` §9 的「不阻塞 P0.5」，按 §9 默认实现并在此登记。
C1 是 P2 叠加层落地的坐标语义，本轮未评审：先按默认实现，落盘一致性（预览==落盘）靠 P4 的
单测钉死；若用户选 y 向上，只改 `apply.go` 的换算与前端 `pos/offset` 的读法。

## 9. 与 AGENTS §6 的字段映射

`AGENTS.md` §6 请求词表：`fs.pick{pathGrantId, owner, TTL, multi, filter, filePath}`、
`pdf.split{assetId, splitMode(auto|rows-cols|custom|unsplit), rows, cols, customCuts[], splitVeto, vetoPages[], splitPages}`、
`pdf.apply{assetId, instances[]: sealId blend opacity scale pos anchor offset rotation pages crossPage binding startOffset}`（实例是数组；`brightness/saturate` 不发送）、
`pdf.export{assetId, dpi, customDpi, quality, mode, pages}`、`pdf.save{assetId, targetPath, pathGrantId, replaceOriginal}`、
`seal/preset{presetName}`。`offset` 与 `startOffset` 独立；`brightness/saturate` 仅预览不落盘。

## 10. 变更纪律

- mock 的 DOM 骨架即 P0/P1 外壳：容器/画布/面板 id 就是契约（§6/§7）。
- 每个可调参数在 mock 里挂 `data-field`，接线只换渲染与请求代码。
- 校验命令：`node tools/verify/ui-smoke.mjs`（headless：0 console error、无 404、
  1280x720/1440x900 无横向溢出、i18n 覆盖）与 `node tools/verify/ui-contract.mjs`（三方一致）。
- 任何 UI 语义/字段改动：先改本文 + AGENTS §6，再改 mock，最后改代码（§8 必须有确认记录）。
