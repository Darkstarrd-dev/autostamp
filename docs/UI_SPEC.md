# AutoStamp — UI_SPEC（P0.5 UI 契约）

> 最后核对：2026-11-10（**T1–T2 = UI6 轮：苹果系商务极简配色 + styled tooltip + CN 排版** —— T1 token 名不变、值全换：亮 = `#1d1d1f`/`#f5f5f7`/`#e9e9ee`/`#d5d8dd` + Apple 蓝 `#0071e3`；暗 = `#1c1c1e`/`#2c2c2e`/`#3a3a3c`/`#48484a` + 暗蓝 `#0a84ff`（accent 填充上文字近黑 `#08131f`）；**两主题正文对比 ≥4.5:1**；字体栈 SF Pro/Segoe UI Variable + PingFang SC/Microsoft YaHei；macOS segmented 选中药丸（不再 accent 实心）；按钮 hover = surface-2、active = surface-3；modal 10px/16px、toast 8px；thin 滚动条、`::selection`、`.14s` 过渡 + `prefers-reduced-motion` 守卫；新增 presentation token `--tooltip-bg`/`--tooltip-fg`。**tooltip 引擎** = `app-shell-chrome.bindTooltips`：`[data-i18n-title]` hover/focus → `.app-tooltip` 反色浮层（bg=`--fg`、fg=`--surface`、8px、12.5px/1.45、320px、140ms；wheel/Esc 即散），**title 仅在 hover/focus 期间摘除、按 stash 原文回挂，`aria-label` 恒不动**（N2 断言仍成立）；T2 = `html:lang(zh-CN)` line-height 1.6 + letter-spacing .01em（en 不加）。契约面：§4 i18n **139 不变**、§6 ui-ids **57 不变**、字段词表 52 不变，无新路由/新字段；§8 新增 T1/T2 决策行。前轮 B1–B2（UI5）/ N1–N4（UI4）见 `docs/changelog/UI_SPEC.md`。）

## 1. 组件层级与状态机

层级：`asset（PDF 会话资产）→ 页选择 → 印章实例（instance）→ 骑缝章（crossPage）→ 导出/保存`。
实例是叠加单位：一个实例可作用于多页（`apply.pages`）；骑缝章把实例切成逐页条带（`crossPage=true`）。

状态（`<html data-state>`，与 mock `__autoStampMock.STATES` 一致）：

```ui-states
empty            无文件空态（拖拽 / 选择 / 粘贴）
open-error       打开失败（非 PDF 或文件损坏）
opened           已打开 PDF，未选中实例交互
stamp-selected   实例被选中（选择框 + 手柄可见）
stamp-dragging   画布拖拽移动中（pos 实时更新）
stamp-resizing   句柄缩放中（scale 实时更新）
split-preview    切分预览（2 拼结果页 + 切点）
crosspage        骑缝章模式（逐页条带 + 起始位置 + 装订边）
export           导出设置段（SP5：此段现于 `#save-modal` 内；dpi/quality/mode + 体积预估）
save-confirm     保存对话框（targetPath / replaceOriginal + SP5 起的导出设置段）
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
field=api.fs.pick.filePath api=fs.pick.filePath type=text range=abs path default= nullable=yes ctl=no i18nkey=- decision=HD19
field=api.fs.pick.filter api=fs.pick.filter type=select range=pdf|image|all default=pdf nullable=no ctl=no i18nkey=- decision=HD19
field=api.fs.pick.multi api=fs.pick.multi type=toggle range=bool default=true nullable=no ctl=no i18nkey=- decision=HD19
field=api.fs.pick.pathGrantId api=fs.pick.pathGrantId type=text range=grant id default=(auto after pick) nullable=yes ctl=no i18nkey=- decision=-
field=api.fs.pick.startDir api=fs.pick.startDir type=text range=abs dir default=%APPDATA%\AutoStamp nullable=yes ctl=no i18nkey=api.fs.pick.startDir.hint decision=-
field=api.open.assetId api=open.assetId type=text range=assetId default=- nullable=yes ctl=no i18nkey=- decision=-
field=ui.lang api=- type=segmented range=en|cn default=en nullable=no ctl=yes i18nkey=lang.en decision=SP5
field=ui.theme api=- type=segmented range=light|dark default=light nullable=no ctl=yes i18nkey=theme.light decision=SP5
field=ui.consoleVisible api=- type=boolean range=true|false default=false nullable=no ctl=no i18nkey=app.console.btn decision=HD16
field=api.split.assetId api=split.assetId type=text range=assetId default=- nullable=yes ctl=no i18nkey=- decision=SP1
field=api.apply.assetId api=apply.assetId type=text range=assetId default=- nullable=yes ctl=no i18nkey=- decision=SP1
field=api.export.assetId api=export.assetId type=text range=assetId default=- nullable=yes ctl=no i18nkey=- decision=SP1
field=api.save.assetId api=save.assetId type=text range=assetId default=- nullable=yes ctl=no i18nkey=- decision=SP1
field=api.seal.prepare.despill api=seal.prepare.despill type=boolean range=bool default=true nullable=no ctl=no i18nkey=- decision=D4
field=api.seal.prepare.alphaTrim api=seal.prepare.alphaTrim type=boolean range=bool default=true nullable=no ctl=no i18nkey=- decision=SP1
field=api.seal.prepare.resampleDpi api=seal.prepare.resampleDpi type=number range=72..600 default=300 nullable=no ctl=no i18nkey=- decision=SP1
field=api.seal.preset.presetName api=seal.preset.presetName type=text range=string default=- nullable=no ctl=no i18nkey=- decision=SP1
field=api.apply.blend api=apply.blend type=select-grouped range=16blend词表 default=multiply nullable=no ctl=yes i18nkey=api.apply.blend.ctl decision=Z1
field=api.apply.opacity api=apply.opacity type=slider+number range=0..1 default=0.6 nullable=no ctl=yes i18nkey=api.apply.opacity.ctl decision=-
field=api.apply.brightness api=apply.brightness type=slider+number range=0..2 default=1 nullable=no ctl=yes i18nkey=api.apply.brightness.ctl decision=B2
field=api.apply.saturate api=apply.saturate type=slider+number range=0..5 default=1 nullable=no ctl=yes i18nkey=api.apply.saturate.ctl decision=B2
field=api.apply.ink api=apply.ink type=slider+number range=1..10 default=1 nullable=no ctl=yes i18nkey=api.apply.ink.ctl decision=B2 unit=曲线指数 g
field=api.apply.scale api=apply.scale type=slider+number range=0.05..5.0 default=0.202 nullable=no ctl=yes i18nkey=api.apply.scale.ctl decision=HD12,Z2 unit=相对页宽分数
field=api.apply.pos api=apply.pos type=text range=x,y default=- nullable=no ctl=no i18nkey=- decision=HD12 unit=pt
field=api.apply.anchor api=apply.anchor type=segmented range=tl|tr|center|bl|br default=center nullable=no ctl=no i18nkey=- decision=HD12
field=api.apply.offset api=apply.offset type=text range=dx,dy default=0,0 nullable=no ctl=no i18nkey=- decision=HD12 unit=pt
field=api.apply.rotation api=apply.rotation type=slider+number range=-180..180 default=0 nullable=no ctl=yes i18nkey=api.apply.rotation.ctl decision=HD12 unit=deg
field=api.apply.pages api=apply.pages type=text range=pages词表 default=all nullable=no ctl=no i18nkey=- decision=HD11
field=ui.seal.addMode api=- type=toggle range=bool default=false nullable=no ctl=yes i18nkey=app.sealAddMode.btn decision=HD10
field=ui.seal.crosspageAddMode api=- type=toggle range=bool default=false nullable=no ctl=yes i18nkey=app.sealCrossAddMode.btn decision=SP4
field=decision.seal.recentSeals api=- type=select range=最近打开印章 default=- nullable=yes ctl=yes i18nkey=seal.recent.select decision=HD8
field=api.split.auto api=split.auto type=boolean range=bool default=true nullable=no ctl=no i18nkey=- decision=SP1
field=ui.split.mode api=- type=internal range=off|v2|h2|grid default=auto nullable=no ctl=no i18nkey=- decision=SP1
field=api.split.rows api=split.rows type=number range=1..6 default=1 nullable=no ctl=no i18nkey=- decision=SP1
field=api.split.cols api=split.cols type=number range=1..6 default=2 nullable=no ctl=no i18nkey=- decision=SP1
field=api.split.cutFractions api=split.cutFractions type=text range=0..1逗号列表 default=0.5 nullable=no ctl=no i18nkey=- decision=SP1
field=api.split.pages api=split.pages type=text range=pages词表 default=all nullable=no ctl=no i18nkey=- decision=SP1
field=api.export.mode api=export.mode type=segmented range=vector|raster default=vector nullable=no ctl=yes i18nkey=api.export.mode.ctl decision=D1
field=api.export.dpi api=export.dpi type=segmented range=72|150|300|custom default=150 nullable=no ctl=yes i18nkey=api.export.dpi.ctl decision=D1 unit=dpi
field=api.export.customDpi api=export.customDpi type=number range=96..600 default=150 nullable=no ctl=yes i18nkey=api.export.customDpi.ctl decision=- unit=dpi
field=api.export.quality api=export.quality type=slider+number range=40..95 default=75 nullable=no ctl=yes i18nkey=api.export.quality.ctl decision=-
field=api.export.pages api=export.pages type=text range=pages词表 default=all nullable=no ctl=yes i18nkey=api.export.pages.ctl decision=-
field=api.apply.crossPage api=apply.crossPage type=boolean range=bool default=false nullable=no ctl=no i18nkey=- decision=SP4
field=ui.crosspage.binding api=- type=segmented range=right|alternate|none default=right nullable=no ctl=yes i18nkey=ui.crosspage.binding.ctl decision=D2
field=api.apply.startOffset api=apply.startOffset type=slider+number range=0..100（%） default=0 nullable=no ctl=yes i18nkey=api.apply.startOffset.ctl decision=D2,N4 unit=%
field=ui.crosspage.cover api=- type=slider+number range=0..100 default=75 nullable=no ctl=yes i18nkey=ui.crosspage.cover.ctl decision=Z5 unit=%
field=api.apply.slices api=apply.slices type=array range=0..1每槽占比（Σ≤1） default=- nullable=yes ctl=no i18nkey=- decision=Z5
field=api.save.targetPath api=save.targetPath type=text range=绝对路径 default=- nullable=yes ctl=yes i18nkey=api.save.targetPath.ctl decision=-
field=api.save.replaceOriginal api=save.replaceOriginal type=toggle range=bool default=false nullable=no ctl=yes i18nkey=api.save.replaceOriginal.ctl decision=S1
field=api.open.pw api=open.pw type=password range=string default=- nullable=yes ctl=yes i18nkey=api.open.pw.ctl decision=-
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
- `api.apply.brightness/saturate/ink` **烘焙进印章位图**（UI5-B2，§8 B2）：落盘前
  `pdfcore.AdjustPNG` 逐像素，预览走 `app-overlay.adjustedBitmap`（同公式缓存记忆化）——
  公式 = 通道依次 **pow（ink：v′=255·(v/255)^g）→ ×brightness → CSS saturate 矩阵**
  （常数 0.213/0.715/0.072），每步 clamp 0..255、四舍五入，alpha 不变；顺序固定不可换。
  旧「只在预览、落盘不写」语义作废；`ctx.filter='none'` 显式复位仍保留（FACTS §1.4）。
- `api.apply.scale` 是相对页宽分数：滑杆范围 **10%..200%**（0.1..2.0），最左 10%、最右 200%，
  默认（settings 字段）0.202 = 20.2%；**新放置与 `#instance-reset` 复位的实例取 Z2 自动值 =
  42 mm 印章宽 ÷ 页显示宽**（`autoScale()`：竖版页的宽就是短边，A4 竖版 = 0.2008 = 42/210，即
  用户口述的「短边」公式；横版页按 42 mm 目标除以长边，保证章仍是 42 mm）。拖动边角可超出 200%（落盘词表上限 0.05..5.0），滑杆把超出值回显在
  右端（HD12）。`api.apply.pos` / `api.apply.anchor` / `api.apply.offset` 不再有控件（HD12：
  位置直接走画布拖拽）：实例几何恒走 **anchor+offset** 通道（`anchor=center` + 拖拽增量
  `offset`），`pos` 只作派生读数不落请求。**页内坐标约定（P2 实测；见 §8「页内坐标原点」行）**：
  display 空间、原点左上、y 向下（与 `#preview-ruler` 一致）。落盘侧换算到 pdfcpu 的 y 向上
  MediaBox（含 `/Rotate` 补偿），换算在 P4 apply 内做并有单测钉死；预览与落盘共用同一套换算：
  `app-overlay.rectFor` == `pdfcore.StampGeom.Box`。方向键步进（1pt/Shift=10pt）改 `offset`。
- `api.apply.pages` 的交互默认 = **实例所在页**（HD11，W4 修订）：在哪一页放置/加章，
  就只在该页显示；骑缝实例（`crossPage=true`）仍按 `all` 逐页放条带（D2/CP1 不变）。
- `decision.seal.recentSeals`（HD8）= 后端 `config.recentSeals`（24 条去重截断，与
  `recentFiles` 同一套 `SetRecent` 语义）：`POST /api/pdf/seal/prepare` 走 pathGrantId 形态
  成功后记录路径；顶栏下拉显示 **去后缀** 的名称，value = 完整路径。兜底：下拉选择时
  `fs/pick{filePath}` 报 `path_denied`（文件不存在）→ 前端移除该选项并 `PATCH settings`
  的 `recentSeals` 数组（整组替换）删除该记录。
- `api.apply.startOffset` 是骑缝条带沿装订边位置的**百分比**（N4，2026-11-09）：取值 0..100，
  0% = 条带**下缘**贴页面下边、100% = 条带**上缘**贴页面上边；几何 `travel = pageH − 条带盒高
  h`（= `scale × pageW × aspect` 整章盒高）、`Y = (1 − startOffset/100) × travel`（`travel`
  可为负 = 盒比页高，钳位照旧），预览 `app-overlay.rectFor` 与落盘 `pdfcore.StampGeom.Box`
  同一公式。与 `api.apply.offset` 独立。SP4（2026-11-05）：选中骑缝实例后**纵向拖拽条带**即改
  这个值（水平位置属于装订边，不拖，`Δpct = −dy / travel × 100`）；骑缝章模式的放置点击把点击
  点 y 换算成同一个百分比写入（见 §8 SP4/N4 行）。
- Z5（2026-11-09）`ui.crosspage.cover`：随机分布模拟真实装订盖章。前端 `S.drawCrossSlices`
  （实例级）按约束取值：首页 25~50%、末页 20~30%，中间页按**覆盖率**（= 首页末页外页面的占比，
  四舍五入；例 10 页中间页 60% = 6 页有章、4 页盖不到）决定哪些页拿到条带，拿到的占比沿页序走
  **一条平滑趋势**（单段缓变，绝不逐页抖动）。取值结果写入实例参数 `api.apply.slices`（每槽占
  整章宽的比例，Σ≤1），落盘请求逐实例原样发送（预览/落盘同一份分布，不重掷 RNG）。重试按钮
  `#crosspage-retry` = 重新取值一次。**N3（2026-11-09）起 Z5 的「平均」档作废**：
  `ui.crosspage.sliceMode` 字段与切档控件整条删除，随机取值**恒生效**（新骑缝实例与
  `#instance-reset` 复位都立即随机取值，不再有平均分支）；请求里缺 `slices` 时后端等宽切仍是
  兜底（`api/apply.go` 的 `slices` 词表不变，只是 UI 不再暴露平均）。
- `api.export.dpi/customDpi/quality` 仅 `mode=raster` 生效（页位图由前端回传，FACTS §2.4 无 rasterize）。
- `api.batch.*`（BM1/BM2 的前端跑链词表）：**SP1（2026-11-05）起整段作废** —— 批处理面板随
  右侧边栏移除，前端跑链（`fs/pick(dir) → open → split → apply → export → save(mkdirs)`）与
  报表/CSV 一并删除；后端路由（`fs/pick{dir:true}`、multipart `export`、`save{mkdirs}`）保留，
  `fs.pick.dir` / `api.save.mkdirs` 两个请求字段仍是 §6 契约的一部分。
- `api.open.pw`：UserPW/OwnerPW 都试；AES-256 链路 `UNVERIFIED`（FACTS §6）。
- `ui.*` 字段不进请求（`api=-`）；`ui.split.vetoedPages` 是 `split` 的派生参数，切分时随请求带上。

## 3. 控件 ↔ 字段绑定表

| 面板/控件 | 字段 | 控件形态 | 落点 |
|---|---|---|---|
| 顶栏 · 上传印章（`#btn-seal-upload`） | `sealId`（响应侧） | 图标 button（SVG 印章）→ `fs/pick{filter:image}` | `POST /api/pdf/seal/prepare`（pathGrantId 形态）|
| 顶栏 · 最近印章下拉（`#seal-recent-select`） | `decision.seal.recentSeals` | `<select>`（名称去后缀，value=路径） | `fs/pick{filePath}` → `seal/prepare(pathGrantId)`；文件没了 → 移除选项 + `PATCH settings` |
| 顶栏 · 加章模式开关（`#btn-seal-add`） | `ui.seal.addMode` | toggle button（`aria-pressed`，SVG） | 无请求；开启后左键点击页面空白处 = 在该点新增实例 |
| 顶栏 · 骑缝章放置开关（`#btn-crosspage-add`） | `ui.seal.crosspageAddMode` | toggle button（`aria-pressed`，SVG 骑缝） | 无请求；开启后左键点击页面空白处 = 骑缝条带实例（点击 y → `startOffset`，装订边锚定，SP4）|
| 主画布 · 选中实例（`#stamp-layer`） | 普通实例：`apply.offset`（拖框）/ `apply.scale`（四角手柄、`+/−` 快捷键，滑杆回显；Ctrl+滚轮 = 全局整页缩放，V7 取代 V3）/ `apply.rotation`（顶部手柄）。骑缝实例（SP4）：纵拖 = `apply.startOffset`（水平不拖），四角/旋转手柄同普通；**选择框 = 整章轮廓（UI5-B1：宽 fullW、贴装订边、高同普通章；页面内仍只画该页条带，条带落在轮廓内）** | 虚线框 + 手柄 | 无请求（叠加层内部状态） |
| 实例参数面板（右缘停靠） · 混合模式（`#instance-panel`） | `api.apply.blend` | 分组 `<select>` | `/api/pdf/apply` |
| 实例参数面板（右缘停靠） · 透明度/明度/饱和度/密度/缩放/旋转 | `api.apply.opacity/brightness/saturate/ink/scale/rotation` | 滑杆 + 数值（双向绑定；scale 10%..200%，可被拖角超出；ink 1..10 曲线指数；rotation −180..180） | 同上（bright/sat/ink 烘焙进印章像素并随 apply 发送，UI5-B2） |
| 实例参数面板（右缘停靠） · 装订边 + 起始位置（SP4，仅骑缝实例显示；`startOffset` = 百分比 0..100，N4） | `ui.crosspage.binding` / `api.apply.startOffset` | segmented（纵向堆叠）+ 滑杆/数值 | 同上（几何见 §8 D2/SP4/N4） |
| 实例参数面板（右缘停靠） · 覆盖率滑杆（Z5，仅骑缝实例显示，N3 起恒随 cp 组） | `ui.crosspage.cover` | 滑杆 + 数值（0..100%） | settings（`apply.cover`）；改动即时重掷分布 |
| 实例参数面板（右缘停靠） · 重新随机（Z5，`#crosspage-retry`） | 重试 = 对选中骑缝实例重新取值一次 | button | 无请求（新分布随下一次 `apply` 落盘） |
| 实例参数面板（右缘停靠） · 复位 / 删除 | 复位当前实例参数到默认 / 删除当前实例 | 底部两个 button | 无请求 |
| 左列 · 印章预览（`#seal-preview`） | 当前选/刚打开的印章（响应侧） | 静态 `<canvas>`（透明底棋盘） | 无请求（字节来自 `GET /api/pdf/seal/raw`） |
| 保存对话框 · **导出设置段**（SP5：`#panel-export` 现于 `#save-modal` 内）· 导出方式（`#export-mode`） | `api.export.mode` | segmented | `/api/pdf/export` |
| 导出设置段 · DPI（`#export-dpi` + `customDpi`） | `api.export.dpi` + `customDpi` | segmented + number | 同上（同一 modal 内） |
| 导出设置段 · JPEG 质量 | `api.export.quality` | 滑杆 + 数值 | 同上 |
| 导出设置段 · 导出页 | `api.export.pages` | text + All | 同上 |
| 导出设置段 · 体积预估 | （只读派生） | `#estimate`（`#estimate-total` / `#estimate-per-page`） | 由 FACTS §4 表算，不请求 |
| 保存弹窗 · 目标路径 | `api.save.targetPath` | text | `/api/pdf/save` |
| 保存弹窗 · 系统选择器 | `api.fs.pick.filePath` + `pathGrantId` | button + display chip | `/api/fs/pick` |
| 保存弹窗 · 替换原文件 | `api.save.replaceOriginal` | toggle + 二次确认 | 同上 |
| 口令弹窗 · PDF 口令 | `api.open.pw` | password | `/api/pdf/open` |
| 顶栏 · 语言 / 主题（**SP5 起仍在顶栏**；只有四条 hintline 文案键删除，切档控件与 `ui.lang`/`ui.theme` 字段不变） | `ui.lang` / `ui.theme` | segmented | 无（前端） |
| 空态 · 「打开文件」大按钮（`#empty-pick`：156 px 大方圆角 button，居中；下方一行 `.hint` = 粘贴/拖拽装载提示） | （无控件字段：`api.fs.pick.filePath`/`filter`/`multi` 三行 HD19 起 `ctl=no`，选择器参数由 `pickAndOpen()` 固定为 `{filter:"pdf", multi:true}`） | button + 上传图标 → 原生选择器 | `/api/fs/pick` → `pdf/open`（`pickAndOpen()`）；提示行本身走 `submitFiles`（PD1/PD2），无请求 |
| 预览区 · 页框 / 画布 / 文本层 | （无字段：渲染态，页尺寸来自 `pdf.open` 响应） | `#preview-stage` 内 JS 生成 `.page-frame` → `canvas.page-canvas` + `.textLayer` | `GET /api/pdf/raw?id=`（pdf.js 逐页取字节） |
| 分页条 · 计数 + 每页缩略图（SP2：无编号、无 pill 背景、间距 2px、缩略图按栏高自适应 y 轴缩放、无 All chip） | （无字段；形态见 §8 SP2/V2） | `#page-pager` 内 JS 生成 `span.chip[data-role=pager-count]` + `button.chip[data-page]`（内含 `canvas.pg-thumb`） | 无（前端） |
| 标尺 / 像素读数 | （只读派生） | `#preview-ruler`、`#pixel-readout` | 由 `pdf.open` 的页 pt 尺寸 + 当前视图 scale 计算，不请求 |

滑杆 + 数值必须**双向绑定**（同一 `data-field` 复用两次，mock 已实现 `bindPair`）；
没有任何隐藏 `type=file` input（HD8：`#seal-file-input` 随侧栏「上传印章 PNG」一起删除；
印章装载 = 顶栏 `fs/pick` 或粘贴/拖拽的 File 对象直接喂 `seal/prepare` multipart）。
空态（HD19）只有这一枚大按钮 + 一行提示：路径框 `#empty-path`、「多文件」切档
`#empty-pick-multi`、「过滤」切档 `#empty-pick-filter` 与 pathGrantId chip 已删
（§6 ui-ids −3、§4 −12 键），`openByPath(path)` 只剩 §7 驱动 API。

## 4. i18n 清单（key | en | cn；共 139 键，SP1 净删 116 → 151、SP5 再删 7 → 144、HD19 再删 12 → 132、Z5 再加 9 → 141、N3 再删 4 → 137、B2 再加 2 → 139，由 `node tools/verify/gen-i18n.mjs` 生成；生成器打印同数）

规则（AGENTS §7）：每个可见控件/文案必须有 `data-i18n` key，en/cn 两值非空；
`data-i18n-cn`（及 `-placeholder`、`-title`）提供中文值，en 取元素自身文本或 `class="tag"` 的字段名。
控制 key 约定 `<field 去掉 api. 前缀>.ctl` / `.hint`；JS 动态写入的 key（`dataset.i18n = …`、toast 文案）
同样在下表登记。`ui-contract.mjs` 校验 mock 的每个 key 都在表中、表中每行的 en/cn 非空。
SP5 起 `ui.lang` / `ui.theme` 的 §2 行改挂切档**自身文案键**（`lang.en` / `theme.light`），
因为它们原来的 `ui.lang.ctl`/`ui.theme.ctl` + 两条 `.hint` 四条键是死键、已随侧栏退场删除
（顶栏切档控件与 `ui.lang`/`ui.theme` 字段本身不变）。

|key|en|cn|
|---|---|---|
|api.apply.blend.ctl|apply.blend|混合模式|
|api.apply.blend.hint|16 blend modes (PDF Table 136) grouped; backend writes ExtGState /BM.|16 种 PDF 混合模式（PDF 表 136），分组选择器；落盘写 ExtGState /BM。|
|api.apply.brightness.ctl|apply.brightness 0..2|明度|
|api.apply.brightness.hint|0..2; channel coefficient baked into the seal pixels before stamping; disk == preview.|0..2；通道 ×系数后烘焙进印章位图，落盘像素与预览一致（UI5-B2）。|
|api.apply.crossPage.ctl|apply.crossPage|骑缝章|
|api.apply.ink.ctl|apply.ink 1..10|密度|
|api.apply.ink.hint|Levels curve v′=255·(v/255)^g (g=1..10): pale red to deep red to black; baked first, before brightness/saturate; disk == preview.|色阶曲线 v′=255·(v/255)^g（g=1..10）：浅红→深红→全黑；先于明度/饱和度烘焙进印章位图（UI5-B2）。|
|api.apply.opacity.ctl|apply.opacity 0..1|透明度|
|api.apply.opacity.hint|0..1 writes ExtGState /CA and /ca.|0..1，落盘 ExtGState /ca /CA（pdfcpu opacity 同义）。|
|api.apply.rotation.ctl|apply.rotation|旋转（度）|
|api.apply.rotation.hint|Degrees around the seal centre.|-180 到 180；印章绕自身中心旋转。|
|api.apply.saturate.ctl|apply.saturate 0..5|饱和度|
|api.apply.saturate.hint|0..5 (0 = gray); CSS saturation matrix baked into the seal pixels; disk == preview.|0..5（0=灰度）；CSS 饱和矩阵烘焙进印章位图，落盘像素与预览一致（UI5-B2）。|
|api.apply.scale.ctl|apply.scale|印章宽度（相对页宽）|
|api.apply.scale.hint|Seal width as a fraction of page width; slider 10%..200%, corner-drag can exceed and echoes back on the slider. Fresh stamps use the Z2 auto scale = 42 mm over the page's display width.|印章宽度为相对页宽分数；滑杆最左 10%、最右 200%，拖动边角可超出范围并回显在滑杆上（A4 = 595.3pt）。新放置/复位的印章按 Z2 自动缩放 = 42 mm 章宽 ÷ 页显示宽（A4 竖版即 0.2008）。|
|api.apply.startOffset.ctl|apply.startOffset|起始位置（%）|
|api.apply.startOffset.hint|Percent along the page: 0% pins the strip bottom to the page bottom, 100% pins its top to the page top; vertical drag on a selected strip edits this value.|百分比沿页滑动：0% = 条带下缘贴页面下边，100% = 条带上缘贴页面上边；选中骑缝章后纵向拖动即改此值。|
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
|api.fs.pick.pathGrantId.ctl|pathGrantId: grant-x9z|授权句柄（只读显示）：选择器返回的 pathGrantId|
|api.open.pw.hint|UserPW and OwnerPW are both tried; AES-256 read is UNVERIFIED (FACTS 6).|UserPW/OwnerPW 都试；AES-256 读取链路目前 UNVERIFIED（FACTS §6）。|
|api.save.replaceOriginal.ctl|save.replaceOriginal|替换原文件|
|api.save.targetPath.ctl|save.targetPath|目标路径|
|api.save.targetPath.hint|Blank means same name + .stamp.pdf; atomic temp+rename.|留空则用同名 + .stamp.pdf；写盘走 temp+rename（原子写）。|
|api.seal.prepare.despill.hint|White-background keying applied live; reversible before save.|对白底扫描件即时去背；预览可撤销，预设保存时保留 alpha。|
|app.open.btn|Open PDF|打开 PDF|
|app.save.btn|Save|保存|
|app.shortcuts.btn|Shortcuts|快捷键|
|app.sealAddMode.btn|Add-seal mode|添加印章模式|
|app.sealCrossAddMode.btn|Add cross-page seal mode|添加骑缝章模式|
|app.console.btn|Backend log|后端终端|
|apply.undo.btn|Undo stamping|撤销盖章|
|apply.write.btn|Stamp into PDF|盖到 PDF|
|binding.alternate|Duplex: odd right / even left|双面：奇右偶左|
|binding.none|No cross-page seal|无骑缝章|
|binding.right|Single-sided: right edge|单面：右缘连续|
|blend.group.compare|Compare|比较|
|blend.group.component|Component|分量|
|blend.group.contrast|Contrast|对比|
|blend.group.darken|Darken|增暗|
|blend.group.lighten|Lighten|增亮|
|blend.group.normal|Normal|正常|
|pages.all.btn|All|全部|
|confirm.cancel|Save as new file|改存新文件|
|confirm.hint|The original will be overwritten (atomic temp+rename). This cannot be undone.|将覆盖原文件（原子写：先写临时文件再改名）。此操作不可撤销。|
|confirm.ok|Replace|确认替换|
|confirm.title|Replace original file?|替换原文件？|
|crosspage.binding.fixed|the binding control acts on the selected cross-page instance: select a stamp first|装订边只作用于选中的骑缝实例：先选中一个印章|
|crosspage.retry.btn|Re-roll|重新随机|
|crosspage.retry.hint|Re-rolls the random draw for the selected cross-page instance.|重新进行一次随机取值（替换当前骑缝实例的切片分布）。|
|crosspage.retry.noRandom|the retry button acts on the selected cross-page instance in random mode; select one first|重新随机只作用于处于「随机」模式的骑缝实例：先选中一个|
|empty.hint|You can also drop a PDF here or paste it (Ctrl+V) to open it; dropped/pasted images load them as seals.|也可以把 PDF 直接拖进来或粘贴（Ctrl+V）打开；图片拖入/粘贴装载为印章。|
|empty.pick.btn|Open file|打开文件|
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
|instances.delete.btn|Delete|删除|
|instance.panel.title|Seal options|印章参数|
|instance.collapse.btn|Minimize|最小化|
|instance.reset.btn|Reset|复位|
|instances.duplicate.btn|Duplicate|复制|
|load.drop.hint|Drop a PDF to open it, or images to load as seals|拖入 PDF 即打开文档；拖入图片装载为印章|
|load.paste.hint|paste or drop: one PDF opens, images load as seals|粘贴或拖入：单个 PDF 直接打开，图片装载为印章|
|load.reject.mix.hint|a drop or paste must be one PDF or images only, never mixed|PDF 与图片不能混在一起：要么单个 PDF，要么图片|
|load.reject.multi.hint|open one PDF at a time|一次只打开一个 PDF|
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
|page.hint|jump to page|跳到某页|
|pager.count|page 1/5|页 1/5|
|panel.export.title|Export|导出设置|
|pw.open.btn|Password|输入口令|
|pw.retry|Retry|重试打开|
|pw.title|Password required|需要口令|
|ruler.hint|page size in pt; origin at top-left|页面尺寸（pt）；标尺原点在左上|
|save.confirm|Save|保存|
|save.hint|save dialog|保存对话框|
|save.pick.btn|System file picker|系统文件选择器|
|save.replace.hint|Replacing the original needs a second confirmation.|替换原文件需要再确认一次，且会丢弃原 PDF 的可选内容层。|
|save.replace.on|on|开|
|save.retryNew.btn|Save to a new file|改存新文件|
|save.title|Save PDF|保存 PDF|
|scale.hint|scale +-0.01|缩放 +-0.01|
|seal.ok|sealId ready (alpha ring, SMask generated on save)|印章已就绪（带 alpha 环，落盘自动生成 SMask）|
|seal.despill.revert|revert white-keying and re-run from the source image|撤销去背：用原图重跑一次|
|seal.addMode.noseal|upload or pick a seal first|先上传或选择印章|
|seal.preview.title|Seal preview|印章预览|
|seal.upload.btn|Upload seal|上传印章|
|seal.recent.select|recent seals|最近打开的印章|
|seal.recent.stale|that seal file no longer exists: removed from the list|该印章文件已不存在：已从下拉列表移除|
|seal.err.type|Stamp image must be PNG or JPEG with an alpha channel|印章图片必须是带透明通道的 PNG 或 JPEG|
|seal.err.nosource|Upload a seal image first, then revert|先上传印章图片，再点撤销|
|stamp.box.aria|Selected stamp instance position|选中印章实例的位置|
|shortcuts.hint|shortcut list|快捷键列表|
|shortcuts.title|Shortcuts|快捷键|
|split.ok|split preview ready|切分预览就绪（剔除原页后替换页面列表）|
|theme.dark|Dark|深色|
|theme.light|Light|浅色|
|top.file.hint|no file open|未打开文件|
|ui.crosspage.binding.ctl|Binding edge (D2)|装订边（D2）|
|ui.crosspage.binding.hint|D2 vocabulary, per selected instance: right / alternate make it span, none demotes it to a page stamp.|D2 词表，作用于**选中的骑缝实例**：right / alternate 逐页跨页，none 把该实例降回普通单页印章。|
|ui.crosspage.cover.ctl|Cover|覆盖率（%）|
|ui.crosspage.cover.hint|Share of middle pages that get a strip (rounded); e.g. 10 middle pages at 60% = 6 stamped, 4 missed.|首页末页外的页面有多少比例拿到骑缝章（四舍五入）；如 10 页中间页配 60% = 6 页有章、4 页盖不到。|
|view.fit.hint|restore fit (Ctrl+middle click)|恢复整页适配（Ctrl+鼠标中键）|
|view.pan.hint|pan the view (Space + arrows / Space + left-drag / wheel)|平移视图（Space+方向键 / Space+左键拖动 / 滚轮）|
|view.zoom.hint|zoom the whole page (seal scales with it)|缩放整页（印章随页面一起缩放）|
|warn.noText.hint|No extractable text layer: this file has only scanned images|无可抽取文字层：该文件只有扫描图像|
|warn.render.hint|Page 3 has 33 MP: rendered at reduced scale|第 3 页 33 MP：已按缩略尺寸渲染|
|warn.export.tooBig|page bitmap exceeds the 90 MB cap: lower DPI to 300 or fewer pages|单页位图超过 90 MB 上限：请把 DPI 降到 300 或少选几页|

## 5. 快捷键（mock 已注册，P1/P2 起在真实 UI 里同样注册）

|键|动作|字段|
|---|---|---|
|Ctrl+O / Ctrl+S|打开 / 保存弹窗（SP5：保存弹窗的按钮入口 = 顶栏「保存」，侧栏「保存到文件」按钮已删）|open.* / save.*（导出设置段与 `#estimate` 都在此 modal 内）|
|Ctrl+V / 拖入窗口|装载：单个 PDF 打开文档；图片（单/多张）装载为印章（PD1/PD2）|load.*|
|Ctrl+D / Del|复制 / 删除当前实例|instance|
|左键拖拽 / 拖句柄|移动 / 缩放（骑缝实例纵拖 = 起始位置，SP4）|offset / startOffset / scale|
|旋转句柄拖拽|按中心旋转|rotation|
|Ctrl+Enter / Ctrl+Z|盖到 PDF / 撤销上一次盖章（SP1：按钮入口随侧栏移除，键盘成为入口）|apply|
|←↑↓→（Shift=10pt）|1pt 步进|offset|
|+ / −|scale ±0.01|scale|
|1..9 / PgUp/PgDn|跳页|current|
|Ctrl+滚轮|**总是**整页视图缩放（V7，取代 V3）：印章按页空间矩形随之缩放，seal/page 相对比例不变；`apply.scale` 不受滚轮影响（四角手柄 / `+/−` / 滑杆），见 §8 V7|视图|
|Space + 方向键 / Space + 左键拖动 / 滚轮（无 Ctrl）|平移视图；页四边不会越过容器四边（V4/V5）|视图|
|Ctrl + 鼠标中键|回到 fit（整页适配，V6）|视图|
|加章模式开关 + 左键点击页面空白处|在当前页点击处放置当前印章（HD10）|新增实例|
|骑缝章模式开关 + 左键点击页面空白处|以点击高度为起始位置放置骑缝条带实例（SP4）|新增实例|
|Esc / ?|关闭弹窗、清除 toast / 快捷键表|—|

## 6. 契约 DOM id

P0/P1 的 `index.html` 必须使用下表 id（`ui-ids` 块 = `ui-contract.mjs` 校验表）；
新增 id 要先登记，mock 缺该 id 即报错。

```ui-ids
app-main  app-root  apply-blend  btn-console  btn-crosspage-add  btn-open  btn-save  btn-seal-add  btn-seal-upload  btn-shortcuts  confirm-cancel  confirm-modal  confirm-ok  crosspage-binding  crosspage-retry  drop-hint  empty-pick  empty-state  estimate  estimate-per-page  estimate-total  export-dpi  export-mode  instance-collapse  instance-fab  instance-panel  instance-remove  instance-reset  lang-seg  log-console  log-console-body  modal-layer  page-pager  panel-export  password-modal  pixel-readout  preview  preview-ruler  preview-stage  pw-cancel  pw-retry  save-cancel  save-confirm  save-modal  error-toast  save-pick  save-source  seal-preview  seal-preview-canvas  seal-preview-name  seal-recent-select  stamp-layer  shortcuts-close  shortcuts-modal  shortcuts-table  theme-seg  topbar

```

顶栏**没有任何文本**（HD5，2026-11-04）：只有图标控件 —— 左簇 = 打开 → 上传印章 → 最近印章
下拉 → 加章模式开关 → **骑缝章放置开关（SP4）** → 保存（HD8/HD10；**SP5 起这是打开保存对话框的唯一按钮入口**，另一个 = Ctrl+S），右簇 = 语言 / 主题 / 后端终端（`#btn-console`，HD16）/
快捷键（最右），全部图标 + `data-i18n-title` tooltip；控件同高 34px（HD15，2026-11-05）。
版本与打开后的文件名只写在**窗口标题**里 —— 原生标题栏（Go `windowTitle`）与浏览器标签页
（`document.title`）同一个串 `AutoStamp <版本> [文件名]`（HD2 修订）。
`#app-main` **单列 full-bleed**（SP5，2026-11-06：`grid-template-columns: minmax(0, 1fr)` +
`grid-template-areas: "topbar" "preview"`；HD3 的固定 two-col 就此作废，右侧再无边栏）；
`#preview` 无内边距、无圆角（HD7）；
`#empty-state` **只有大按钮 + 一行提示**（HD19，2026-11-06）：flex 列居中（`gap: 18px`、
文本居中，`html[data-state="empty"]` 下 `display: flex`），成员只有 `#empty-pick`（156×156
大方圆角 `border-radius: 16px`，上传图标 44 px + 「打开文件」）与一行 `.hint`（最大宽 560 px）——
路径框 `#empty-path`、「多文件」切档 `#empty-pick-multi`、「过滤」切档 `#empty-pick-filter`
与 pathGrantId chip 都已从这里删除（§6 id 表 −3、§4 −12 键）。
`#seal-preview`（HD13）与 `#log-console`（HD16，默认隐藏）都是 `#preview` 左下角的绝对定位
overlay，不占布局。印章参数面板**默认收起** = `#instance-fab` 方形圆角齿轮按钮；展开后
`#instance-panel` 停靠 `#preview` 右缘（IP1，2026-11-09：`right/top/bottom:10px`，
全高 + `overflow-y:auto` = IP2），`#instance-collapse` 收起（HD18）。**z 序（SP3）**：
`#seal-preview` < 后端终端 < 参数面板/齿轮 —— 预览卡永远盖不住面板内容。
`#panel-export` 现在是**保存对话框内的导出设置段**（SP5：modal 内滚动 = `#save-modal`
`top: 8vh` + `max-height: 84vh` + `overflow-y: auto`；段内五个 `.field` + `#estimate`，
id 与 `data-field` 词表不变）。SP1 时代的「侧栏只剩导出设置 + 动作段」形态已被 SP5 取代；
`split-preview`/`crosspage` 两个状态名保留，见 §1。

`#preview-stage` **无滚动条**（`overflow: hidden`，V5）：缩放超过容器时平移走程序化
滚动偏移（`app-preview.js` 的 `bindPan`：Space+方向键 / Space+左键拖动 / 滚轮；
浏览器对 `scrollTop/scrollLeft` 的原生 clamp 就是「页四边不超出容器四边」的规则）；
fit 为整页适配（V4），`#page-frame` 永远完整可见。

`#preview-stage` 的页框与 `#page-pager` 的分页 chip 全部由 JS 生成（不占契约 id，靠
`class` + `data-page`）；assetId 句柄在 SP1 后**不再上 UI**（`state.assets` 只是内部记账，
`probe('chain')` 读它），`pathGrantId` 的 chip 只显示句柄值本身，
本地化文案放 `title` / `aria-label`（这两处文本是动态的，带 `data-i18n` 会和 `applyLang()`
「元素自身文本 = en 值」的规则打架，见 §4）。

## 7. mock 驱动接口（verify 用）

`window.__autoStampMock`：`STATES`、`setState(name)`、`verifyState(name)`、
`setParams({api.x: v,…})`、`probe(name)`、`applyLang(lang)`、`applyTheme(t)`、
`i18n()`（DOM 快照）、`fields()`、`ids()`、`q()/qa()`、`setModal()/clearToast()`。
`probe` 关键字：`state` `overflow` `images` `instances` `split` `strip` `pixel-blend` `estimate`
`addMode`（加章模式开关读数）`recentSeals`（下拉 + 记录读数值，见 §8 HD8）`sealPreview`（预览 canvas 尺寸）`instancePanel`（面板/齿轮按钮可见性 + 位置 + 收起态，HD18）`console`（后端终端面板开关读数，HD16）。

深链：`mockup.html#crosspage`（`hashchange` 会重走状态机）。

### 7.1 真实壳的驱动接口（`web/static/app-shell-*.js` 模块组，`tools/verify/shell-smoke.mjs` 用）

`window.__autoStampShell`：`STATES`、`setState(name)`、`verifyState(name)`、
`setParams({api.x: v,…})`（写控件并派发 `input`/`change`，因此走真实 persist 路径）、
`fields()`（全部 `data-field` 控件快照；display-only `span` 不计）、`ids()`、
`i18nPairs()`（每个 `data-i18n` 的 en+cn 原值，另有 kind `title`：`[data-i18n-title]` 的图标按钮
tooltip）、`probe(name)`、
`applyLang(lang)`、`applyTheme(t)`、`setModal(id)`、`clearToast()`、
`addInstance(name, params)`、`selectInstance(id)`、`deleteSelected()`、`duplicateSelected()`、
`APPLY_FIELDS`、`defaultParams()`、`instanceById(id)`、`selectedInstance()`、
`setSealForSelected(sealId)`、`notify(name, detail)`、
`adopt(info, pw)`（文档接管的唯一漏斗：状态翻转 + `assets.*` 记账 + `preview.open`；
`pixel-matrix` 真链路驱动的就是它，而不是直接调预览模块）、
`setAddMode(on)` (add-seal mode toggle, HD10), `setCrosspageAdd(on)` (cross-page placement
mode toggle, SP4 — mutually exclusive with addMode, stage hook shared), `addCrossInstanceAt(pt)`
(the placement: click height → the `startOffset` **percentage** (N4: `pct = clamp(round1((1 −
pt.y / (pageH − h)) × 100), 0, 100)`), binding-edge anchored strip instance, SP4),
`autoScale()` (Z2: the placement scale = 42 mm seal width over the current page's display width;
drives `addInstanceAt`/`addCrossInstanceAt` and `#instance-reset`),
`drawCrossSlices(inst)` / `retryCrossSlices()` / `randomCrossFractions(count, cover, rng)`
(Z5: the 随机 draw rolls/collections per-instance
`api.apply.slices` — first page 25..50%, last 20..30%, middle pages honour the cover slider
(rounded) and drift as one smooth trend; retry re-rolls the selected instance; the 平均 mode is
gone since N3, so the random draw is always in effect and there is no equal-split branch;
`randomCrossFractions` is the pure function behind it, injected with a caller's rng for
deterministic verify),
`openRecentSeal(path)` (the topbar dropdown/fallback chain:
`fs/pick{filePath}` → `seal/prepare(pathGrantId)`, on failure the shell removes the record itself, HD8),
`dropRecentSeal(path)` (fallback deletes the settings record), `currentSeal()` (the current seal's sealId or null),
`pickAndOpen()` / `openByPath(path)` / `handleFiles(file)` (the open channels:
`pickAndOpen()` calls `api.pick({filter:"pdf", multi:true})` and adopts whatever the native
picker returns; the empty state has no path box any more (HD19), so `openByPath(path)` is a
§7 drive API only — it now takes the path argument itself, empty/whitespace argument →
error toast with no dialog, and it reads no DOM field),
`runSplit(opts)` / `undoSplit()` / `stampIntoPDF(opts)` / `undoStamping()` (the write-back chain:
the sidebar buttons were removed in SP1 and the whole sidebar is gone in SP5, so the §7 API and the keyboard are the entry points;
`runSplit(opts)` carries the vocabulary per call, e.g. `{splitMode:"rows-cols", rows:1, cols:2}`),
`q()/qa()`、`t(key)`。
`probe` 关键字：`state` `overflow` `instances` `instanceCount` `selected`
`modal` `toast` `lang` `theme` `version`（纯版本串）`docTitle`（窗口/标签页标题，HD2）`labels`
`estimate`（导出体积预估，见 §7 E1）
`load`（粘贴/拖拽装载读数：`{kind: pdf|seals|reject, reason, names, count}`，见 §8 PD1/PD2）
`addMode` (add-seal mode boolean) `crosspageAdd` (SP4: `{on, cpFields, binding, startOffset}` —
the placement-mode state plus the floating panel's cross-page group visibility/vocabulary readings)
`defaults` (reset snapshot = current defaults group, HD12)
`recentSeals` (`{paths, names, optionNames, optionValues, selected}` dropdown and record
readings, HD8; `selected` = the drop-down's current value, a path or the `__current__`
marker for path-less seals, HD14)
`sealPreview` (`{visible, w, h, name, drawn}` the bottom-left overlay card, HD9→HD13)
`instancePanel` (`{visible, collapsed, fabVisible, left, top, w, h}` floating panel / gear-fab
geometry, HD12; `collapsed` = panelCollapsed state, `fabVisible` = the square gear button is
up, HD18; left/top/w/h report whichever surface is up)
`console` (`{visible, pressed, lines, seq}` the backend-terminal readings, HD16)
`page` (current page number), `currentSeal` (the current seal's sealId or null).

`window.__autoStampPreview`（`app-preview.js`）：`open(info)`、`setPassword(pw)`、`reload(pw)`、
`close()`、`goTo(n)`、`next()`、`prev()`、`zoomBy(step)`、`zoomTo(v)`、`fit()`、`panStage(dx,dy)`
（V5 的程序化平移，越界值由浏览器 clamp）、`pageCount()`、`pageMeta(n)`、
`sample(x,y,w,h)`（`x,y,w,h` 为 PDF 点，返回 RGBA + 换算后的像素矩形）、
`probe(name)`：`page` `pageCount` `asset` `zoom` `fitZoom` `dpr` `canvas` `textLayer` `reduced`
`pan`（V5：滚动偏移 + clamp 边界 `maxX/maxY` + `space`/`overflowing` 读数）
`splitPreview`（P3 切分预览：`on` `marks` `boxes` `parts`，`marks` 按 `split.mode` 画在页框上）。
`window.__autoStampTextLayer`（`app-textlayer.js`）：`attach({pdfjs,pageObj,viewport,frame,dpr})`、
`count(pageObj)`。`window.__autoStampPager`（`app-pager.js`）：`build()`、`refresh()`。

`window.__autoStampSeal`（`app-seal.js`，P2 印章图通道）：`upload(file)`（→
`POST /api/pdf/seal/prepare` multipart，选项取面板 `seal.prepare.*`；粘贴/拖拽/图片装载走这条）、
`prepareFromGrant(pathGrantId, options)`（pathGrantId 形态 → `seal/prepare` JSON，HD8）、
`prepare(file, override)`、
`revert()`（用内存里的原始上传重跑 `despill:false`，即「撤销去背」）、`bitmapOf(sealId)`、
`renderMeta(sealId)`、`renderPreview()`（左列底部预览重绘，HD9）、`lastSource()`、
`probe(name)`：`seals` `count` `meta`。

`window.__autoStampOverlay`（`app-overlay.js`，P2 叠加层）：`paint(ctx, info)`（由
`app-preview.js` 在每次页渲染后调用：先把干净页存进 `state.snapshot`，再把印章合成进
同一 canvas —— FACTS §1.3 的预览==落盘等值性只在这条路径成立）、`repaint()`（拖拽用的
廉价重合成，不重跑 pdf.js）、`syncAffordance()`、`selectAt(ev)`、`hitTest(pt)`、
`parsePages(spec)`、
`rectFor(inst)`、`beginDrag/moveDrag/endDrag`、
`probe(name)`：`rects` `strips`（Z5 起每条目带 `frac`/`cum` 读数：该页槽占整章宽的比例与其
累计起点；`frac = 0` = 该页盖不到）、`view` `affordance`（选中实例的包围盒 + 句柄数）、`drag`
（`moveDown/centerDown/rotDown` 命中诊断）、`instancePixels`（该实例四角的本机
alpha/预乘 RGB，见 §11 P2 反算规则；实例画布是**不挂 DOM 的 probe 背板**——
页面 canvas 是唯一被用户看到的合成面，ghost 双绘制已于 2026-11-04 修复）、`selected`、`filter`（`ctx.filter` 读数，
FACTS §1.4）、`snapshot`、`canvasRect`。另有 `imageDataOf(canvas)` 与
`pixelsForRect(info, rect)` 两个纯函数供 verify 脚本算像素。

跨模块事件（`app-shell-*` 模块经 `notify()` 派发，`app-pager.js` / `app-preview.js` / `app-overlay.js` 监听）：
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
|V3|Ctrl+滚轮归属|P1 = 预览视图缩放，P2 起交给 `apply.scale`（推荐）/ 只留给印章 / 另立按键|已确认：P1 滚轮缩放视图；P2 起「光标在选中实例上」时滚轮 = `apply.scale`，页背景仍为视图缩放。**2026-11-05 被 V7 取代**（实例缩放通道删除，`consumeWheel` 退役）|2026-10-29|ask 第 3 轮 wheel + 修订 2026-11-05|
|C1|页内坐标原点（`pos`/`offset` 的 y 方向）|display 空间、原点左上、y 向下（推荐：与 `#preview-ruler` 一致，拖拽手柄也按它画）/ PDF 原生 y 向上（用户要换算心里有记）|未评审默认（P2 实测：手柄、标尺、条带都按左上原点；P4 落盘换算有单测钉死）|2026-10-29|待 ask 下一轮确认；不确认即按默认|
|W1|印章何时真正写进 PDF（落盘时机）|「盖到 PDF」按钮 + 保存时自动补盖章（推荐）/ 只有按钮 / 保存时自动无按钮|已确认：按钮（`#apply-write`）+ 保存弹窗点「保存」时若有未落盘实例先自动 apply|2026-10-30|ask 第 4 轮 apply-trigger|
|W2|盖章后实例叠加层的处理|切到已盖章 asset、清空已落盘实例（推荐）/ 保留可继续微调 / 保留但禁用编辑|已确认：切到已盖章 asset 并清空已落盘实例（预览显示 PDF 里已有的章，不会二次叠加）|2026-10-30|ask 第 4 轮 after-apply|
|W3|撤销盖章入口|顶栏「撤销盖章」按钮（推荐）/ 实例行撤销 / 无撤销按钮|已确认：`#apply-undo`（另配 `#split-undo` 撤销切分；逐级回到上一个 asset）|2026-10-30|ask 第 4 轮 undo-entry|
|W4|实例 pages 的落盘语义|按实例 pages 词表逐页写（推荐）/ 只写当前可见页|已确认：按实例 `pages` 词表逐页落章（与 P2 预览按 pages 绘制一致）。**2026-11-04 交互默认被 HD11 修订**：新实例的 `pages` = 所在页，不再是全开|2026-10-30|ask 第 4 轮 pages-semantics + 修订 2026-11-04|
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
|HD3|版式还可切换吗|固定 two-col / 保留 single-col 与 collapsed 切档|已确认（用户 2026-11-03 对话指令）：固定 two-col（CSS 基础规则就是两栏）；`ui.density` 字段、`[data-density=…]` 规则、`setDensity` 驱动接口全部删除，settings 的 patch 不再接受 `ui.density`。**2026-11-06 被 SP5 取代：`#app-main` 单列 full-bleed（`minmax(0, 1fr)` + `"topbar" "preview"`），右侧边栏删除**（切档控件仍不存在）|2026-11-03|用户 2026-11-03 对话指令（版式面 2026-11-06 SP5 再修订）|
|HD4|未打标签的构建显示什么版本号|沿用 Go 伪版本（`v0.0.0-<日期>-<hash>+dirty`）/ 固定 dev 横幅|已确认（用户 2026-11-04 对话指令）：版本 = **`0.1-dev`**，`internal/app.pickVersion` 只认真实标签——伪版本、`devel`、`+dirty` 一律回落到 `devVersion`，标题栏不带 commit 串；真标签（`v1.2.3`、`v1.2.3-rc.1`）照旧直接显示|2026-11-04|用户 2026-11-04 对话指令|
|HD5|顶栏要不要文本、按钮怎么排|保留 `#top-file` 标题文本 / 顶栏只剩图标按钮|已确认（用户 2026-11-04 对话指令）：**顶栏没有任何文本**，`#top-file` 删除（作废 HD2 的顶栏承载：版本 + 打开后的文件名只写在原生标题栏与浏览器标签页）；顺序 = 左簇「打开 + 保存」相邻贴着左边缘，右簇「语言 → 主题 → 快捷键」，**快捷键最右**（在明暗切档右侧）|2026-11-04|用户 2026-11-04 对话指令|
|HD6|启动页装载入口形态|上传 + 选择 + 路径 + 打开 四个控件 / 只留「打开文件」+ 路径框|已确认（用户 2026-11-04 对话指令）：删「上传文件」按钮（`#empty-upload`）与路径框右侧的「打开」按钮（`#empty-open`）；「选择文件」改名 **「打开文件」**（`empty.pick.btn` = Open file / 打开文件）；路径框回车仍走 `openByPath`；隐藏 `#file-input` 及其 change 监听随上传入口一起去掉（已无触发者），拖放/粘贴装载继续喂 `submitFiles`。**（路径框半边已于 2026-11-06 被 HD19 作废：`#empty-path` 删除，`openByPath(path)` 只剩 §7 驱动 API；见 HD19 行）**|2026-11-04|用户 2026-11-04 对话指令|
|HD7|左列预览保留圆角与外边距吗|出血占满左容器 / 保留卡片式内缩|已确认（用户 2026-11-04 对话指令）：`#empty-state` 去 `margin: 24px` + `border-radius: 8px`（占满左列），`#preview-stage` 内边距 `18px` → `0`，`.page-frame` 圆角 `2px` → `0`；虚线框仍作拖放反馈（`#preview[data-drag]` + `#drop-hint` 不变）|2026-11-04|用户 2026-11-04 对话指令|
|V4|fit 到底适配什么|整页适配（宽+高取小，保比例，推荐）/ 仅适配宽（P1 原状）|已确认（用户 2026-11-04 对话指令，人工验收修正 2）：fit = `min(stageWidth/pageW, stageHeight/pageH)`，加载/打开默认 fit，页在两个方向都不超出容器；ResizeObserver 的 re-fit 同时盯宽高（`stageHeight()` 新增）|2026-11-04|用户 2026-11-04 对话指令|
|V5|左主区滚动条 + 平移语义|无滚动条 + Space 组合平移（推荐）/ 保留原生滚动条 / 只做键盘不加拖拽|已确认（用户 2026-11-04 对话指令，修正 1+3）：`#preview-stage` `overflow: hidden`（无滚动条）；缩放超出容器时平移 = 程序化滚动偏移 —— **Space+方向键**、**Space+左键拖动**（capture+stopPropagation，不劫持印章选择/拖动）、无 Ctrl 滚轮；`scrollTop/scrollLeft` 的原生 clamp 保证「图片上下左右边不会超出容器上下左右边」；Space 按住时吞掉其原生（滚动/按钮激活），输入框内不启用|2026-11-04|用户 2026-11-04 对话指令|
|V6|非 fit 时怎么一键回 fit|Ctrl+鼠标中键（推荐）/ 双击 / 全局快捷键|已确认（用户 2026-11-04 对话指令，修正 4）：**Ctrl+鼠标中键** → `fit()`（`state.zoom = 0`）；`pointerdown` capture 同时 `preventDefault` 吃掉浏览器的 autoscroll|2026-11-04|用户 2026-11-04 对话指令|
|V7|Ctrl+滚轮还是缩放印章实例（V3），改成什么|滚轮**恒为**整页视图缩放，印章随页面一起缩放、seal/page 相对比例不变（推荐）/ 保留 V3（选中实例上滚 = `apply.scale`）|已确认（用户 2026-11-05 对话指令）：**Ctrl+滚轮 = 全局整页缩放**，光标在选中实例上时也不例外（V3 的实例缩放通道删除：`overlay.consumeWheel` 退役，滚轮不再 `apply.scale`）；实例缩放仍走四角手柄 / `+/−` 快捷键 / 浮层滑杆；**无 Ctrl 滚轮 = 平移（V5）不变**。`§4` 增 `view.zoom.hint`（266 → 267）、快捷键表 `Ctrl+滚轮` 行换义、`overlay-smoke --only=drag` 断言「滚轮过印章：视图 zoom 变、`apply.scale` 不变」|2026-11-05|用户 2026-11-05 对话指令|
|HD8|印章装载入口放哪里|侧栏按钮（原状）/ 顶栏按钮 + 最近印章下拉|已确认（用户 2026-11-04 对话指令）：侧栏「上传印章 PNG」按钮与隐藏 `#seal-file-input` 删除；顶栏「打开」右侧 = `#btn-seal-upload`（SVG 印章图标 → `fs/pick{filter:image}` → `seal/prepare` pathGrantId 形态），其右侧 = `#seal-recent-select`（最近打开过的印章，选项名 = **去后缀** 的文件名，value = 完整路径）。实现决定：记录存 **settings.json 的 `recentSeals`**（应用唯一设置文件，`%APPDATA%\AutoStamp`，与 `recentFiles` 同一套去重/24 条截断；不新增 settings.yaml，也不在 exe 目录新建文件——运行目录可能只读）。兜底：下拉选择时 `fs/pick{filePath}` 报 `path_denied`（文件已不存在）→ 移除该选项 + `PATCH settings` 删除该记录|2026-11-04|用户 2026-11-04 对话指令|
|HD9|主界面要不要常驻印章预览|左列底部小预览卡（推荐）/ 不显示|已确认（用户 2026-11-04 对话指令）：左列底部 `#seal-preview`（标题 + 透明棋盘 canvas + 名称），显示当前下拉选择的 / 刚打开（上传、粘贴、拖拽）的印章|2026-11-04|用户 2026-11-04 对话指令|
|HD10|加章怎么进页面|加章模式开关（推荐）/ 双击页面加章 / 常驻「新增实例」按钮|已确认（用户 2026-11-04 对话指令）：下拉右侧 `#btn-seal-add`（SVG 示意图标，`aria-pressed` 切档，不持久化）；开启后左键点击页面空白处 = 在点击位置用当前印章新增实例；点击已有实例仍是选择/拖动（不叠加点）；没有当前印章时 toast 告警|2026-11-04|用户 2026-11-04 对话指令|
|HD11|实例作用于哪些页|所有页（原状）/ 在哪页盖章就只在那页（推荐）|已确认（用户 2026-11-04 对话指令，**修订 W4 的交互默认**）：交互实例的 `pages` = 放置/加章所在页（不同页可盖不同章）；落盘语义仍按 W4 词表逐页写；骑缝实例（`crossPage=true`）仍为 `all` 逐页条带（D2/CP1 不变，开启骑缝时实例 `pages` 归 `all`）；批处理 `pagesForDoc`（BM5）不受影响|2026-11-04|用户 2026-11-04 对话指令|
|HD12|叠加参数/位置尺寸控件放哪里|浮动面板贴选中实例右侧（推荐）/ 留在侧栏 / 弹窗|已确认（用户 2026-11-04 对话指令）：侧栏「叠加参数」「位置与尺寸」两段删除；`#instance-panel` 贴当前选中实例右侧（放不下翻转），成员 = 分组混合模式 `<select>` + 透明度/明度/饱和度/缩放/旋转滑杆（+数值双向绑定）+ 底部「复位」「删除」；**缩放滑杆最左 10% 最右 200%**（默认居中 20.2%），拖边角可超出并在滑杆回显；**旋转滑杆 −180..180** 默认居中 0；复位 = 当前实例参数回 settings 默认组，删除 = 移除当前实例。位置改为画布直接拖放（`pos/anchor/offset/pages` 控件与 `apply-anchor/pos-center/scale-pt` 契约 id 一并删除，`geomMode` 双通道废除，实例几何恒走 anchor+offset）|2026-11-04|用户 2026-11-04 对话指令|
|HD13|印章预览卡要不要单独开底栏|独立底栏区（HD9 原状）/ 叠加在主页面左下角（推荐）|已确认（用户 2026-11-05 对话指令）：`#seal-preview` 改为 `#preview` 内的绝对定位 overlay（左下，距底 10px；分页条可见时上移至其上方 77px），不再占布局高度；DOM 结构不变、契约 id 不变|2026-11-05|用户 2026-11-05 对话指令|
|HD14|打开的印章要不要自动成为下拉当前选项|不做 / 当前选项 = 刚打开的印章（推荐）|已确认（用户 2026-11-05 对话指令）：任何路径通道打开印章后 `#seal-recent-select` 的 value 同步为该路径；粘贴/拖拽等无路径通道打开的印章以下拉末尾的标记项（value=`__current__`，label=文件名）作为当前选项，选中该项 = 无操作（不重开）|2026-11-05|用户 2026-11-05 对话指令|
|HD15|顶栏控件高度要不要统一|统一（推荐）/ 保持现状（按钮与下拉不等高）|已确认（用户 2026-11-05 对话指令）：顶栏全部控件同高 34px = 图标按钮（含上传/加章/后端终端/快捷键/保存/打开）、最近印章下拉、语言/主题切档|2026-11-05|用户 2026-11-05 对话指令|
|HD16|后端终端显示开关放哪里、默认状态、内容是什么|顶栏开关 + 底部 overlay 面板（推荐）/ 弹窗 / 不做|已确认（用户 2026-11-05 对话指令）：右簇快捷键左侧 `#btn-console`（SVG monitor 图标，`aria-pressed` 切档）；`#log-console` = 左列底部 overlay（`GET /api/logs`：`console.LogRing` 400 条尾窗，时间/级别/消息/属性），仅可见时 1.5s 轮询；**默认隐藏**，可见性持久化 `settings.ui.consoleVisible`（默认 false）|2026-11-05|用户 2026-11-05 对话指令|
|HD17|印章装载会不会自动把印章放到页面上、实例能不能删空|装载绝不放置/指派实例（推荐）/ 保持自动设给选中实例|已确认（用户 2026-11-05 对话指令，**作废 boot 默认实例与「装载自动指派」语义**）：上传按钮、最近下拉、粘贴/拖拽图片一律只设置**当前印章**（预览卡 + 下拉同步），不新增也不改写任何实例；盖章唯一通道 = 加章模式点击（HD10）或「新增实例」按钮（创建时快照当前印章、`pages` = 当前页）；实例**可删到零**（删除保护废除，`instances.err.last` 键删除），空实例列表 = 合法状态；启动不预置默认实例|2026-11-05|用户 2026-11-05 对话指令|
|HD18|参数面板要不要能收起|默认收起成齿轮按钮（推荐）/ 不可收起|已确认（用户 2026-11-05 对话指令，叠加在 HD12 上）：面板右上角 `#instance-collapse`（minus 图标）→ 收起为**方形圆角齿轮按钮** `#instance-fab`（SVG 齿轮，36px，锚点与面板同侧：选中实例框右侧）；点击齿轮按钮展开面板；**默认收起**，收起态不持久化|2026-11-05|用户 2026-11-05 对话指令|
|SP1|右侧边栏的四段面板（印章 / 印章实例 / 切分 / 批处理）与顶部会话 assetId 显示容器、侧栏骑缝章段要不要删|删除（用户直接指令）/ 保留|已确认（用户 2026-11-05 对话指令）：**删除** `#panel-seal`、`#panel-instances`（实例列表 + 新增/复制/删除按钮）、`#panel-split`、`#panel-batch`（批处理段含 PR2 的预设子控件）与侧栏 `#panel-crosspage`；`#asset-hooks`（assetId 只读容器）删除。实现决定（干净收尾）：`app-batch.js` 与 `app-api.js` 的 preset/rawBytes 帮助器整文件/整块删除（批处理前端跑链、报表、CSV 随面板一起消失；后端路由与 `presetstore` 保留）；切分/去背选项/预设控件失去 UI 入口，字段退回「后端默认 + §7 驱动 API」（`S.runSplit(opts)` / `S.stampIntoPDF` / `S.undoStamping` / `seal/prepare` 默认值）；「盖到 PDF / 撤销盖章」按钮入口删除，键盘 **Ctrl+Enter / Ctrl+Z** 成为入口；实例列表消失后实例的创建通道 = 加章模式点击（HD10）+ 骑缝章放置（SP4）；`split-preview` / `crosspage` 状态名保留（深链与 verify 仍可进入）|2026-11-05|用户 2026-11-05 对话指令|
|SP2|分页条形态：圆形背景容器 + 编号数字 + 最右 All 按钮去掉后怎么排|纯缩略图条（推荐）/ 保留编号|已确认（用户 2026-11-05 对话指令）：chip 去 pill 背景与 `.pg-no` 编号，**缩略图按分页条容器高度自适应**（y 轴为参照：栏高定死、宽度随页面纵横比；backing store 从布局实测高度换算 device pixel），**间距 2px**，最右 **All chip 删除**（`api.apply.pages`/`api.export.pages` 的词表入口仍在导出段 `api.export.pages` 的 All 按钮上；SP5 起这个导出段位于保存对话框内）。选中页 = 缩略图本体 outline 高亮（不再靠 pill 底色）|2026-11-05|用户 2026-11-05 对话指令|
|SP3|左下角印章预览卡的层级要不要盖过参数面板|高于文件低于面板（推荐）/ 保持现状盖一切|已确认（用户 2026-11-05 对话指令）：`#seal-preview` z 序 = **高于页面/画布（stamp-layer 4 < 预览卡 5），低于后端终端（7）与参数面板/齿轮（8）**；预览卡永不遮挡 `#instance-panel` 的内容|2026-11-05|用户 2026-11-05 对话指令|
|SP4|骑缝章怎么放（侧栏段删除后）|顶栏「添加骑缝章」模式按钮（推荐）/ 键盘入口 / 不做|已确认（用户 2026-11-05 对话指令）：`#btn-seal-add` 右侧 `#btn-crosspage-add`（SVG 骑缝图标：书页边框 + 虚线装订线 + 章圈）；开启后点击页面 = 以**点击点的高度**为起始位置（`startOffset`）放置当前印章的骑缝条带实例（装订边锚定，D2）。骑缝实例**可选中**：纵拖 = `startOffset`（水平不拖，装订边是它的槽位），四角手柄 = `apply.scale`、顶部手柄 = `apply.rotation`，**逐页条带同一实例参数同步重绘/同步落盘**；选项面板 = 浮动参数面板内新增的装订边/起始位置组（仅骑缝实例显示），面板同样可最小化（HD18）。与加章模式互斥（同一空页点击手势）|2026-11-05|用户 2026-11-05 对话指令|
|SP5|右侧边栏要不要整块删除（SP1 之后它只剩「导出设置 + 动作段」）|删除（用户直接指令）/ 保留|已确认（用户 2026-11-06 对话指令）：**删除整个右侧边栏** —— `#right-sidebar` 容器、`form#panel` 与动作段 `#panel-actions`（含「保存到文件」按钮 `#save-open`）全部去掉；「导出设置」段（`#panel-export` + `api.export.mode/dpi/customDpi/quality/pages` 五个 `.field` + `#estimate` 体积预估）**原样迁入保存对话框 `#save-modal`**（位置 = `#save-source` 之后、`#save-pick` 之前；id 与 `data-field` 词表不变，**不新增任何 id/键**）。实现决定：`#app-main` grid 改**单列 full-bleed**（HD3 的固定 two-col 就此作废，无 380 px 面板），`#save-modal` = `top: 8vh` + `max-height: 84vh` + `overflow-y: auto`（导出段在 modal 内滚动），`.modal .section`/`.modal .sec-title` 两条规则给迁入的段落做卡片外壳；`#save-open` 绑定删除后保存对话框的唯一入口 = 顶栏 `#btn-save` + Ctrl+S；`setState("export")` 不再开 `details`（12 态状态机不变，`export` 状态名保留）；语言/主题切档仍在顶栏，其 §2 行改挂切档自身文案键（`lang.en`/`theme.light`）。§4 删 7 个死键 = `save.open.btn` + `ui.lang.ctl`/`ui.lang.hint`/`ui.theme.ctl`/`ui.theme.hint` + `split.undo.btn`/`apply.write.hint`（后两条的唯一绑定面就是被删的侧栏 `#chain-hint`）。ui-ids 63 → 59、§4 151 → 144|2026-11-06|用户 2026-11-06 对话指令|
|HD19|空态怎么简化（HD6 之后启动页还剩路径框 + 多选/过滤切档 + 授权 chip）|只留一枚居中大按钮 + 一行提示（用户直接指令）/ 保留路径框与选项行|已确认（用户 2026-11-06 对话指令）：**空态只剩一枚居中的大方圆角按钮** `#empty-pick`（156 px，内嵌上传图标 + 文字 `empty.pick.btn` = Open file / 打开文件；点击 = `pickAndOpen()` → `fs/pick{filter:pdf,multi:true}` 原生选择器）**加一行提示**（`empty.hint` = 拖进来 / 粘贴（Ctrl+V）打开 PDF，图片装载为印章）。路径框 `#empty-path`、「多文件」切档 `#empty-pick-multi`、「过滤」切档 `#empty-pick-filter`、pathGrantId chip 与两条选项提示行**全部删除**（此轮**作废 HD6 的路径框半边**）：`openByPath(path)` 像 SP1 的切分词表一样退化为 §7 驱动 API，`app-shell-chrome.js` 的 `#empty-path` keydown 接线删除；`pick_unsupported` 只回错误 toast（没有路径框可聚焦）。实现决定：`#empty-state` = flex 列居中（`gap: 18px` + 居中，`display: block` → `flex`），`#empty-pick` 156×156 + `border-radius: 16px`（图标 44 px），`.hint` 最大宽 560 px；`.msg`/`.btnrow`/`.pathrow` 三条规则删除；§4 144 → **132**（12 个失去控件面的键删除，`api.fs.pick.pathGrantId.ctl` 因保存弹窗 chip 仍活着而保留）、§6 ui-ids 59 → **56**|2026-11-06|用户 2026-11-06 对话指令|
|Z1|盖章默认叠加模式设为「正片叠底」（词表 default 已是 multiply，界面/回退要对齐）|用户直接指令|已确认（用户 2026-11-09 对话指令）：默认混合模式 = **multiply** 在所有层面对齐 —— Go `config.Apply.Blend` 本就是 `multiply`；`index.html` 与 `docs/ui/mockup.html` 的 `#apply-blend` 给 multiply 选项预置 `selected`（未拉取 settings 前的初始可见值不再短暂闪 normal）；`app-overlay.js` 的 blend 回退（`BLEND_GCO` 查不到时）由 `normal` 改 **`multiply`**：blend 未设/写错名一律按正片叠底渲染，不再落 source-over。无新字段/新路由|2026-11-09|用户 2026-11-09 对话指令（4 项一批）|
|Z2|盖章默认尺寸：自动判断竖版/横版，默认纸张 A4，章默认 42 mm，按短边自动算 scale|用户直接指令|已确认（用户 2026-11-09 对话指令）：新放置（加章模式点击 / 骑缝放置）与 `#instance-reset` 复位时，实例 scale = **42 mm 章宽 ÷ 页显示宽**（kernel `autoScale()`，§7 驱动 API；显示宽按 `displayDims` 的 /Rotate 交换判断竖版/横版 —— 竖版页的宽就是短边，A4 竖版 = 0.2008 = 42/210，用户口述的「短边」公式；横版页按 42 mm 目标除以长边，章保持 42 mm）。未打开文档按 A4 短边（595.28 pt）回退；clamp 0.05..5。settings 字段 `apply.scale` 默认仍是 0.202（只作 settings 镜像，`probe('defaults')` 不变）|2026-11-09|用户 2026-11-09 对话指令（4 项一批）|
|Z3|骑缝章实例点不动：不像普通章那样显示可选项，必须长按左键才能拖动 —— 修正|用户直接指令（bug 修复）|已确认（用户 2026-11-09 对话指令）：骑缝实例**就是普通实例** —— 单击（不按住）即选中并显示绿色 sel-box + 四角 + 旋转手柄，按下即拖（无长按门槛）；纵拖 = `startOffset`（SP4 语义不变）。修复面 = 删除 `style.css` 里 `[data-mode="crosspage"] .sel-box { display:none }` 与 `.handle { display:none }` 两条隐藏规则（它们就是用户报的现象），改挂 `#stamp-layer .instance[data-mode="crosspage"] .sel-box { border-color: var(--success); cursor: ns-resize }` 的可见规则；叠加层 hitTest 对骑缝实例跳过旋转帧（旋转已烘进位图，条带框轴对齐）|2026-11-09|用户 2026-11-09 对话指令（4 项一批）|
|Z4|骑缝章旋转顺序错误：现在是先切、后旋转、把旋转结果放每页；正确 = 先旋转、再切、每页放的是竖条|用户直接指令（bug 修复）|已确认（用户 2026-11-09 对话指令）：落盘侧 `internal/pdfcore.Apply` 对 crossPage 实例先 `RotatePNG`（整枚印章按 deg 旋转、画布扩到旋转 bbox）再 `Strips` 按**旋转后的位图**切成 N 条竖列进页槽（每页拿到的就是竖条）；预览侧 `app-overlay.js` 用 `rotatedBitmapCanvas`（`rotCache` 按 sealId×deg 缓存）做同源合成，`rectFor` 的条带框纵横比 = 旋转 bbox（90° 时宽高互换），实例不再单独旋转。Go 断言 `TestRotatedStripsAreVerticalColumnsOfRotatedSeal` + `apply-smoke --only=strip`（同 seal 旋转 90：每页上沿=印章左半色、下沿=右半色、条带高 = 旋转 bbox 高）与 `overlay-smoke --only=strip`（旋转渐变三取样）钉死|2026-11-09|用户 2026-11-09 对话指令（4 项一批）|
|Z5|骑缝章面板新增「平均\|随机」可选项 + 百分比滑条 + 重试按钮：模拟真实装订下骑缝章各页位置水平不一致 / 部分页盖不到|用户直接指令（机制已在指令中写明）|已确认（用户 2026-11-09 对话指令；滑条语义经 ask 轮用户自定义输入补全：**覆盖率 = 除首页末页外页面拿到骑缝章的占比，例 60% × 10 中间页 = 6 页有章 4 页盖不到，四舍五入**）：cp 组新增 `ui.crosspage.sliceMode`（平均\|随机，默认平均）+ `ui.crosspage.cover`（0..100%，默认 75；仅随机可见）+ `#crosspage-retry` 重新随机（仅随机可见）。随机机制：首页必得 25~50%、末页必得 20~30%、中间页按覆盖率四舍五入决定哪些页有章（其余页 = 盖不到，切片 0），拿到的占比沿页序**一条平滑趋势**（单段缓变，不允许逐页剧烈波动），重试 = 重新取值一次。实现决定：取值写实例参数 `api.apply.slices`（Σ≤1），apply 请求逐实例原样发送（预览/落盘同一份分布，不重掷 RNG）；落盘 `pdfcore.StripsFractions` 按累计列切条、0 槽跳过盖章；新 §2 词表 3 行 + settings `apply.sliceMode`/`apply.cover` 两字段（`ui.*` 语义进 settings 不走请求）；§6 ui-ids +`crosspage-slicemode`/`crosspage-retry`（56 → 58）；§4 +9 键（132 → 141）（**N3 起平均模式作废**：本行的 `ui.crosspage.sliceMode` 切档 + settings `apply.sliceMode` + `#crosspage-slicemode` + i18n `sliceMode.*` 四键已由 UI4 轮整条删除，随机分布恒生效）|2026-11-09|用户 2026-11-09 对话指令（ask 轮自定义输入定滑条语义）|
|IP1|印章参数面板改为**固定到右侧边栏**（预览区右缘），不再显示在印章右侧悬浮|用户直接指令（HD12 悬浮锚点形态作废）|已确认（用户 2026-11-09 对话指令）：`#instance-panel` 绝对定位在 `#preview` 右缘（`right:10px; top:10px; bottom:10px; width:236px`，z 8 不变），齿轮 fab `#instance-fab` 同角停靠；`posInstancePanel` 的「贴选中实例框右侧 + 翻转 + 跟随」锚点链删除（函数只留 show/hide 语义，§7 名字保留），面板不再随实例位置移动；SP5 的「无侧栏形态」指旧 `#right-sidebar` 导出面板，本面板是预览区内的 overlay 停靠，不占用布局、SP5 作废的 id 不复活|2026-11-09|用户 2026-11-09 对话指令（两项一批）|
|IP2|印章参数面板内容超出容器高度时显示滚动条|用户直接指令|已确认（用户 2026-11-09 对话指令）：IP1 的全高停靠（`top/bottom:10px`）+ `overflow-y: auto`（`overscroll-behavior: contain`）—— 内容（含 Z5 cp 组）超出预览高度时滚动条出现，滚轮/拖动不会把滚动冒泡到预览；验收 = `shell-smoke` IP2 短视口（430 px）强制溢出：`scrollHeight > clientHeight`、`scrollTop` 滚到底为正值、`overflow-y == auto`|2026-11-09|用户 2026-11-09 对话指令（两项一批）|
|N1|初始透明度 = 0.6（用户报告会话里被拖成 1）|用户直接指令|已确认（用户 2026-11-09 对话指令）：代码 default **早已是 0.6**（Go `defaults.go`、`index.html` 控件初值、mock 初值三处一致），因此本轮**零代码/零文案/零键改动**；用户 `%APPDATA%\AutoStamp\settings.json` 的会话 `apply.opacity` 被自动化测试拖拽成 1，由 API/文件复位回 0.6。`api.apply.opacity` 词表行、范围、默认值全部不变|2026-11-09|用户 2026-11-09 对话指令（四项一批）|
|N2|每条选项说明还留在界面上吗|用户直接指令|已确认（用户 2026-11-09 对话指令）：**说明文字全量转 tooltip** —— 每条**静态** `hintline`（`X.hint`）从界面删除，说明文本改挂所在 `.field`/行容器：`data-i18n-title="X.hint"` + `data-i18n-title-cn="<cn 原文逐字>"`（`applyLang` 的 `[data-i18n-title]` → `title` + `aria-label` 通道已存在，无需改 JS）。**i18n 键名与键数不变**（141 中只有 4 个随 N3 删）。保持可见的动态读数不转 tooltip：`#save-source`、`#confirm-path`（`top.file.hint`）、`#estimate-total`/`#estimate-per-page` 读数行（`export.estimate.hint`）、空态 `.hint`（`empty.hint`）、`#log-console`、`#drop-hint`；`export.estimate.note` 改转 title 挂 `#estimate-total` 容器。CSS `.hintline` 规则保留（仍有可见读数使用）|2026-11-09|用户 2026-11-09 对话指令（四项一批）|
|N3|骑缝切片的「平均\|随机」切档还保留吗|用户直接指令|已确认（用户 2026-11-09 对话指令）：**整条作废** —— `ui.crosspage.sliceMode` 字段（settings 组 `apply.sliceMode`）、`#crosspage-slicemode` 控件与 Go config 三件套（`types.go` 的 `SliceMode`、`defaults.go` 的 `SliceMode: "even"`、`patch.go` 的指针字段 + `setStr`、`sanitize.go` 的 even\|random 校验）全部删除，**无迁移**：旧 settings.json 的 `sliceMode` 键由 Unmarshal 静默忽略（无 `DisallowUnknownFields`）。cp 组的覆盖率滑杆与 `#crosspage-retry` **恒随骑缝实例显示**（`.cp-rand` 类与 `syncCpGroup` 的 declared 读取删除）；新骑缝实例与 `#instance-reset` 复位都立即随机取值（现状即如此，只是不再有平均分支）。`api/apply.go` 的 `slices` 词表与「无 `slices` = 等宽切」的后端兜底**不动**，UI 不再暴露平均。i18n 删 4 键（`ui.crosspage.sliceMode.ctl`/`.hint`、`sliceMode.even`、`sliceMode.random`）→ **137**；§6 ui-ids 删 `crosspage-slicemode` → **57**；`crosspage.retry.noRandom` 键保留（非骑缝实例按重试仍告警）|2026-11-09|用户 2026-11-09 对话指令（四项一批）|
|N4|`api.apply.startOffset` 的取值域与语义|用户直接指令|已确认（用户 2026-11-09 对话指令）：**改成百分比 0..100** —— 字段名不变，**0% = 条带下缘贴页面下边、100% = 条带上缘贴页面上边**。几何 `travel = pageH_disp − 条带盒高 h`（= `scale × pageW × aspect` 的整章盒高）、`box.Y = (1 − startOffset/100) × travel`（`travel` 可为负 = 盒比页高，钳位照旧），预览 `app-overlay.rectFor` 与落盘 `pdfcore.StampGeom.Box` 同一公式（`Y: g.StartOffset` → 百分比公式）。滑杆/数框 `min 0 max 100 step 1`，ctl 文案 = 「起始位置（%）」，hint 换 §4 新文本。Go：`sanitize.go` 的 StartOffset 0..200 pt → 0..100（消息「0..100 %」）、`api/apply.go` 校验同步（`defaultApplyStartOffset` 仍 0）。纵拖 = `newPct = basePct − dy/(pageH − rect.h) × 100`（clamp 0..100、`toFixed(2)`，`travel ≈ 0` 时不写）；放置点击 = `pct = clamp(round1((1 − pt.y/(pageH − h)) × 100), 0, 100)`|2026-11-09|用户 2026-11-09 对话指令（四项一批）|
|B1|骑缝实例选择框形态（用户报「普通章与骑缝章 boundingbox 不一致 → 初始大小不一致」）|用户 ask 选择（2026-11-09）|已确认（用户 ask 选项 =「整章轮廓框」）：骑缝实例的**选择框/四角/旋转手柄/hitTest/拖拽基准 = 整章轮廓**（w = `scale × pageW`、贴装订边、高 = `fullW × aspect` 同普通章、y = N4 百分比公式），跨页每页都显示轮廓（Z5 gap 页也显示轮廓但无条带像素）；页面内仍只画该页条带，条带落在轮廓内；四角按整章宽调 scale（与普通章同语义）。落盘几何（条带切片/`Box`）不变——轮廓只是 affordance|2026-11-09|用户 2026-11-09 ask（两项一批）|
|B2|明度/饱和度调节范围不足（浅红→深红→全黑做不到；现参数只预览不落盘）|用户 ask 选择（2026-11-09）|已确认（用户 ask 选项 =「新增密度滑杆+全部烘焙落盘」）：新增 `api.apply.ink`（密度 = 色阶曲线指数 g，1..10 默认 1），`saturate` 范围 0..3 → **0..5**；三参数**全部烘焙进印章位图**（`pdfcore.AdjustPNG` 落盘链 `Adjust→Rotate→Strips`，前端 `app-overlay.adjustedBitmap` 同公式缓存替换 `ctx.filter` 色链），**预览 == 落盘**；公式 = pow（v′=255·(v/255)^g）→ ×brightness → CSS saturate 矩阵（0.213/0.715/0.072），每步 clamp、四舍五入，alpha 不变，顺序固定|2026-11-09|用户 2026-11-09 ask（两项一批）|
|T1|前端配色按「苹果、商务、极简」优化（亮/暗两套各自打磨）；tooltip 样式换可控的浮层|用户直接指令（2026-11-10 对话指令：安装 ui-ux-pro-max skill 并按其指引优化）|已确认（用户 2026-11-10 对话指令）：token **名字**不变、**值全换** —— 亮 = Apple 中性灰阶（`--fg #1d1d1f`、`--muted #5f646b`、`--surface #fff`/`#f5f5f7`/`#e9e9ee`、`--border #d5d8dd`、Apple 蓝 `--accent #0071e3`）；暗 = Apple elevated（`#1c1c1e`/`#2c2c2e`/`#3a3a3c`、`--border #48484a`、暗蓝 `#0a84ff`，accent 填充上文字 = 近黑 `#08131f` 对比 ≥4.5）；success/warning/error Apple 色相（亮 warning `#8f5d00`、暗 error `#ff6961`、`#ff9f0a`、`#30d158`）——**两主题正文对比 ≥4.5:1**（ui-ux-pro-max pro-rules 实测：亮 muted 5.5–6.0 / 暗 7.2）。字体栈 = SF Pro/Segoe UI Variable + PingFang SC/Microsoft YaHei/Noto Sans SC。macOS segmented 选中药丸（`surface` 浮起 + 软阴影，不再 accent 实心；语言/主题/导出切档同源）；按钮 hover = surface-2、active = surface-3；modal 10px/16px、toast 8px/10–14px；thin 滚动条、`::selection` accent 26%、`.14s` 过渡 + reduced-motion 守卫。**tooltip 换 styled 浮层**（`.app-tooltip` 引擎 = `app-shell-chrome.bindTooltips`）：`[data-i18n-title]` hover/focus 显示，文本 = 当前语言 pair（`pairFor(el,"title")`，与 N2 同源）；**title 属性仅在 hover/focus 期间摘除（原生 tooltip 抑制），离开时按 stash 原文回挂**——`aria-label` 恒定不动（可及名不丢，N2 的 title/aria-label 断言仍成立）；浮层 = 反色 token（bg=`--fg`、fg=`--surface`，两主题自动反色）、8px 圆角、12.5px/1.45、max-width 320px、140ms 淡入+位移；wheel/Esc 即散。新增 `--tooltip-bg`/`--tooltip-fg` 两个 presentation token|2026-11-10|用户 2026-11-10 对话指令（三项一批）|
|T2|中英文字间距/行高优化（tooltip 样式与文字间距按语言分别打磨）|用户直接指令（2026-11-10，与 T1 同一批）|已确认：`html:lang(zh-CN)`（真壳 `applyLang` 写 `html.lang="zh-CN"`，mock 同源写 lang → 两个 surface 同一条选择器命中）→ `body { line-height: 1.6; letter-spacing: .01em }`，`.app-tooltip` 同款；en 保持 SF Pro/Segoe 系统原生度量不加 tracking。i18n 键与键数（139）、ui-ids（57）**零变化**|2026-11-10|用户 2026-11-10 对话指令（三项一批）|

SP5 是 2026-11-06 用户在对话里直接下的指令：**右侧边栏整块删除** —— SP1 之后它只剩
「导出设置 + 动作段」，SP5 把这最后两段也拆掉：「导出设置」段（含 `#estimate` 体积预估）
原样迁入 `#save-modal`（`#save-source` 之后、`#save-pick` 之前），词表与 i18n key 不变。
四个 id 从此不再存在（`right-sidebar`/`panel`/`panel-actions`/`save-open`，63 → 59），
七个死键删除（`save.open.btn` + 语言/主题的四条 hintline + `split.undo.btn`/`apply.write.hint`，
后两条的绑定面就是 SP1 前后被删的侧栏提示行；151 → 144），`#app-main` grid
改单列 full-bleed（HD3 的 two-col 到此结束），保存对话框只由顶栏「保存」/ Ctrl+S 打开；
`setState("export")` 保留状态名但不再开 `details`（12 态不变）。

HD19 是 2026-11-06 用户在对话里直接下的指令（空态只剩一枚大按钮 + 一行提示），来源列写
「用户 … 对话指令」；它**作废 HD6 的「路径框 + 回车 → `openByPath`」半边**：`#empty-path`、
`#empty-pick-multi`、`#empty-pick-filter` 与 pathGrantId chip 从界面上整体删除，
`openByPath(path)` 与 SP1 的切分词表一样退回 §7 驱动 API（`preview-smoke.mjs` /
`overlay-smoke.mjs` / `shell-smoke.mjs` 的打开通道就是 `S.openByPath(path)`），
`api.fs.pick.filePath` / `filter` / `multi` 三行 §2 词表改 `ctl=no`（选择器参数由
`pickAndOpen()` 固定为 `{filter:"pdf", multi:true}`），`api.fs.pick.pathGrantId.ctl` 保留
（保存对话框的 chip 仍用它）。

D2–D4、L1、CP1 已在 P0.5 第 1 轮确认（2026-10-29）；D1、I1、S1、E1 在第 2 轮确认（同日）。
HD1–HD7 不是 ask 轮次，而是 2026-11-03/11-04 用户在对话里直接下的指令（顶栏收尾 +
版本号取值 + 启动页入口 + 左列出血），因此来源列写「用户 … 对话指令」；HD1/HD2/HD3 作废了
L1（切档控件）与 RF1（最近文件 UI 入口）的可见形态，后端数据与字段不变；HD5 作废 HD2 的
「顶栏文本承载」半边（`#top-file` 删除，窗口标题仍在）。

HD8–HD12 也是 2026-11-04 用户在对话里直接下的指令（印章通道上顶栏 + 左列预览 + 加章模式 +
实例只作用放置页 + 浮动参数面板取代侧栏两段），来源列同样写「用户 … 对话指令」；HD11 修订了
W4 的交互默认，HD12 废除了 U1 的 `pos/anchor` 双通道（`geomMode` 从壳中删除）；HD8 的
「`settings.json` 在应用运行目录」按实现决定落到既有唯一设置文件 `%APPDATA%\AutoStamp\settings.json`。

HD13–HD16 是 2026-11-05 用户在对话里直接下的指令（细节调整 4 项）：HD13 修订 HD9 的形态
（常驻底栏区 → `#preview` 左下角 overlay，DOM 与契约 id 不变），HD14 在 HD8 的下拉上叠加
「当前选项」同步语义，HD16 新增 `GET /api/logs` 路由（`AGENTS §6`）与设置字段
`ui.consoleVisible`、i18n 键 `app.console.btn`、ui-ids `btn-console`/`log-console`/
`log-console-body`（91 → 94）。

HD17/HD18 同样是 2026-11-05 对话指令：HD17 **作废 PD1 的「图片设给选中实例」半边与
HD8–HD10 的隐含「boot 默认实例 + 装载自动指派」**（装载只设当前印章；实例只在加章模式
点击 /「新增实例」时创建并快照当前印章；实例可全删；`instances.err.last` 键删除；
`setSealForSelected` 保留为 verify 脚本驱动 API，UI 侧不再自动调用），HD18 给 HD12 的
面板加收起形态（ui-ids +`instance-collapse`/`instance-fab`，94 → 96；i18n −1 +1 =
`instances.err.last` 删、`instance.collapse.btn` 增，仍 266 键；收起态不持久化，默认收起）。

SP1–SP4 是 2026-11-05 用户在对话里直接下的指令（侧栏收尾：删面板 + 分页条瘦身 + z 序 +
骑缝章模式按钮；**SP5 再修订**：2026-11-06 侧栏整块删除，见上方 SP5 行与下一段）。SP1
一次性删掉 `#panel-seal`/`#panel-instances`/`#panel-split`/
`#panel-batch`/`#panel-crosspage`/`#asset-hooks` 六个容器及其控件的 i18n 键（34 个 ui-ids
消失，96 → 63），对应字段行改成 `ctl=no`（`split`/`seal.prepare`/assetId 组）或整行删除
（`api.batch.*` 前端跑链词表、`decision.assetIds`）；`batch-smoke.mjs` 随批处理 UI 删除
（预设库后端与路由保留）。SP4 新增 ui-ids `btn-crosspage-add`（已计入 63）、i18n 键
`app.sealCrossAddMode.btn`；骑缝实例的参数（binding 切档 + startOffset 滑杆）从侧栏段
**迁入浮动参数面板**（词表不变，D2 行沿用）；`cp-group` 只在骑缝实例选中时可见。
CP1 的逐页条带放大面板（`#strip-previews`）随侧栏删除 —— 它的读数改由
`probe('strips')`（叠加层条带盒）承担。

V4–V6 同样是 2026-11-04 用户在人工端到端验收里直接下的修正指令（fit 整页、无滚动条 +
Space 平移、Ctrl+中键回 fit）；同一轮的「印章 ghost 双绘制」与「明度/饱和度滑杆」是
缺陷修复，不改语义，故不进本表（ghost = `instance-canvas` 不挂 DOM，明度/饱和度复核
结论见 `IMPLEMENTATION_PLAN` §10.1）。V4 作废了 P1 时代的「fit = 仅适配宽」语义。

W5、W6 是 P5（光栅导出）开工前的落盘/保存语义，用第 5 轮确认（2026-11-02）。
P6 的 PR1/PR2/RF1/BC1–BC3/PC1/OP1 是开工前的预设/批处理/打包语义,用第 6 轮（5 条）与
第 7 轮（3 条）确认（2026-11-02）。BC4 是实现决定,不是新语义:光栅的页位图只能来自
前端预览（pdfcpu 无 rasterize,FACTS §2.4）,批处理没有预览,所以批处理只走矢量落盘。
V1–V3 是 P1 开工前的形态问题，用第 3 轮确认（同日），因为它们改的是预览区/分页条的可见形态而非字段词表。
B1/D5 属 `IMPLEMENTATION_PLAN` §9 的「不阻塞 P0.5」，按 §9 默认实现并在此登记。
C1 是 P2 叠加层落地的坐标语义，本轮未评审：先按默认实现，落盘一致性（预览==落盘）靠 P4 的
单测钉死；若用户选 y 向上，只改 `apply.go` 的换算与前端 `pos/offset` 的读法。**2026-11-04 修订
（HD12）**：`pos` 输入框与锚点切档已删，交互几何只剩 `anchor`（默认 center）+ 拖拽增量 `offset`，
方向键也改 `offset`；落盘换算本身不变。

## 9. 与 AGENTS §6 的字段映射

`AGENTS.md` §6 请求词表：`fs.pick{pathGrantId, owner, TTL, multi, filter(pdf|image|all), filePath}`、
`pdf.split{assetId, splitMode(auto|rows-cols|custom|unsplit), rows, cols, customCuts[], splitVeto, vetoPages[], splitPages}`、
`pdf.apply{assetId, instances[]: sealId blend opacity scale pos anchor offset rotation pages crossPage binding startOffset}`（实例是数组；`brightness/saturate` 不发送）、
`pdf.export{assetId, dpi, customDpi, quality, mode, pages}`、`pdf.save{assetId, targetPath, pathGrantId, replaceOriginal}`、
`pdf.seal/prepare`（两形态 Content-Type 协商：multipart 上传 / `{pathGrantId, despill, alphaTrim, resampleDpi}` JSON，HD8；
pathGrantId 形态成功后 `config.recentSeals` 记录路径）、`seal/preset{presetName}`。
`settings` PATCH 新增 `recentSeals` 数组字段（整组替换，兜底删除记录用）。`offset` 与 `startOffset` 独立；`brightness/saturate` 仅预览不落盘。

## 10. 变更纪律

- mock 的 DOM 骨架即 P0/P1 外壳：容器/画布/面板 id 就是契约（§6/§7）。
- 每个可调参数在 mock 里挂 `data-field`，接线只换渲染与请求代码。
- 校验命令：`node tools/verify/ui-smoke.mjs`（headless：0 console error、无 404、
  1280x720/1440x900 无横向溢出、i18n 覆盖）与 `node tools/verify/ui-contract.mjs`（三方一致）。
- 任何 UI 语义/字段改动：先改本文 + AGENTS §6，再改 mock，最后改代码（§8 必须有确认记录）。
