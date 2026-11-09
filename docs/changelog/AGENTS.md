# AGENTS.md

> `AGENTS.md` 的变更叙述历史（最新在上）。正文只留当前态事实。

## 2026-11-09 — §5 新增 45（UI4 轮 N1–N4）+ §5.43/§5.7/§5.41/§5.42 挂 N3/N4 注记 + §6 括注 + §11 Z5 行换义

- §5.45（新，UI4 轮四项一批）：**N1** 初始透明度 0.6（Go/前端 default 早已 0.6 → 零代码改动，只
  复位被测试拖成 1 的会话 settings 值）；**N2** 说明文字 → tooltip（每条静态 `hintline` 删除，
  说明改挂所在容器 `data-i18n-title` + `-cn`，动态读数保持可见，CSS `.hintline` 保留，
  i18n 键名/键数不变）；**N3** `SliceMode` **字段整条删除**（Go 三件套 + `#crosspage-slicemode`
  + `.cp-rand` 显隐类 → cp 组控件恒随骑缝实例、随机恒生效，旧 `sliceMode` 键静默忽略、无迁移）；
  **N4** `api.apply.startOffset` = **0..100 百分比**（`Box.Y = (1 − pct/100) × (pageH − h)`、
  预览 == 落盘、纵拖 `Δpct = −dy/(pageH − h) × 100`、放置点击换算同公式）。
- §5.43（Z5）行尾挂注记：「平均|随机」切档作废、「切回平均」通道不复存在、仅随机恒生效，
  请求缺 `slices` 时后端等宽切只是兜底。
- §5.7 / §5.41 / §5.42 骑缝语义处 `startOffset` 括注新语义（0..100 百分比 + 条带盒 `Y` 公式）。
- §6 `POST /api/pdf/apply` 行：`startOffset` 括注「自 N4 起 = 0..100 百分比，不再是 0..200 pt」。
- §11「改骑缝不匀切片模拟（Z5）」行换义：先读列补 N3/N4，涉及文件列出删除面（`SliceMode` 三件套、
  `#crosspage-slicemode`、`sliceMode.*` 四键、i18n 141 → 137、ui-ids 58 → 57、`data-field` −1）与
  N4 的 Go/前端/verify 面（`stamp.go`/`sanitize`/`apply` 校验、滑杆 `min 0 max 100`、
  `rectFor`/`moveDrag`/`addCrossInstanceAt`、startOffset 取样按百分比）。
- 本轮无新字段/新路由；计数口径与 `docs/UI_SPEC.md` 同一提交（137 / 57）。


## 2026-11-09 — §5 新增 44（IP1/IP2 印章参数面板停靠右缘 + 超高滚动）+ §5.30/§5.34 挂作废注记 + §11 一行新增

- §5.44（IP1/IP2）：`#instance-panel` 从 HD12 悬浮锚点（贴选中实例框 + 翻转 + clamp + 跟随）
  改停靠 `#preview` 右缘（`right/top/bottom:10px`，宽 236、z 8 不变）全高 +
  `overflow-y:auto`（`overscroll-behavior:contain`）；`#instance-fab` 同角（右上）停靠；
  `posInstancePanel` 锚点链删除、只留 show/hide（§7 名字不变）；面板出现条件 = 选中实例 +
  文档（旧「实例框未绘制就不显示」box 语义作废）。
- §5.30（HD12）挂 IP1 作废注记（悬浮锚点半边）；§5.34（HD18）挂锚位注记（fab/面板同角停靠）。
- §11：新增「改实例参数面板停靠/滚动（IP1/IP2）」行。

## 2026-11-09 — §5 新增 43（Z5 骑缝不匀切片模拟）+ §6 apply 词表 `slices` + §11 一行新增

- §5.43（Z5）：cp 组「平均|随机」切档 + 覆盖率滑杆 + 重新随机按钮；随机取值写实例参数
  `api.apply.slices`（首页 25~50%、末页 20~30%、中间页 = round(覆盖率 × 中间页数)、
  沿页序一条平滑趋势、Σ=1、0 = 该页盖不到）；预览 `stripContext` 与落盘
  `pdfcore.StripsFractions` 同一份分布按累计列切条。修订 §5.16/§5.42 的切片语义半边。
- §6 `POST /api/pdf/apply`：实例字段表加 `slices`（只随骑缝实例发送；Σ≤1；0 槽 = 盖不到）。
- settings 新字段对 `apply.sliceMode`（even|random，默认 even）/ `apply.cover`
  （0..100，默认 75）—— Go `config` 三件套（types/defaults/patch/sanitize）+
  `internal/api/apply.go` 词表校验（长度 = 作用页数、合计 ≤1、全 0 拒、非骑缝拒）。
- §11：新增「改骑缝不匀切片模拟（Z5）」行。

## 2026-11-09 — §5 新增 39–42（Z1–Z4：盖章默认 multiply / 42 mm 自动缩放 / 骑缝单击可选 / 骑缝先旋转后切）+ §11 两行新增

- §5.39（Z1）：默认混合模式 = multiply 全链对齐 —— `#apply-blend` 与 mockup 预置
  `selected`；`app-overlay.drawSeal` 的 `BLEND_GCO` 查不到回退由 normal 改 multiply。
- §5.40（Z2）：新放置/复位实例 scale = 42 mm 章宽 ÷ 页显示宽（kernel `autoScale()`；
  竖版宽 = 短边、横版按 42 mm 目标除以长边；A4 短边 595.28 回退；clamp 0.05..5）；
  settings `apply.scale` 默认仍 0.202、`probe('defaults')` 镜像不变。
- §5.41（Z3）：`style.css` 删 `[data-mode="crosspage"] .sel-box`/`.handle` 隐藏规则；
  骑缝实例单击即选中（绿框 + 四角 + 旋转手柄），按下即拖（纵拖 = startOffset，SP4 不变）；
  `hitTest` 骑缝跳过旋转反变换帧。
- §5.42（Z4）：crossPage 实例 `rotation` ≠ 0 时先 `pdfcore.RotatePNG`（新文件）烘旋转
  （屏幕顺时针、画布 = 旋转 bbox、最近邻、deg 0 恒等），再 `Strips` 按旋转位图切 N 条
  竖列进页槽；`StampGeom.Aspect` 取旋转后比；预览 `rotatedBitmapCanvas`（`rotCache`
  sealId×deg）+ `effectiveBitmap` 同源，实例不再 `ctx.rotate`。修订 §5.7/§5.17 的
  条带语义半边。
- §11：新增「改盖章默认值（Z1/Z2）」与「改骑缝条带旋转 / 可选中性（Z3/Z4）」两行。
- §8 验收 10/12 语义扩展：`overlay-smoke` strip 加 Z3 单击/手柄 + Z4 旋转渐变三取样；
  `apply-smoke` strip 加同 seal 旋转 90 竖条（每页上沿 = 印章左半色、下沿 = 右半色、
  条带高 = 旋转 bbox）；`shell-smoke` 加 Z2 缩放断言与 Z3 手柄/单击断言；
  `internal/pdfcore/rotate_test.go` 常驻（Go 测试新增 5 个）。

## 2026-11-06 — §5.38 新增（HD19 空态只剩一枚大按钮）+ §5.23/§5.25 挂作废注记 + §11 两行换义 + §8 验收 7/9 换通道

- §5.38：`#empty-state` 只剩**一枚居中的大方圆角按钮** `#empty-pick`（156×156、
  `border-radius: 16px`）+ 一行 `.hint`；删路径框 `#empty-path`、「多文件」切档
  `#empty-pick-multi`、「过滤」切档 `#empty-pick-filter`、pathGrantId chip 与 CSS
  `.msg`/`.btnrow`/`.pathrow`；`pickAndOpen()` 固定 `api.pick({filter:"pdf", multi:true})`；
  **`openByPath(path)` 退化为 §7 驱动通道**（同 SP1 切分词表语义）；ui-ids 59 → 56、
  §4 144 → 132；`app-shell-chrome.js` 的 `#empty-path` keydown 接线删除。
- §5.25（HD6）末尾追加「2026-11-06 起 HD19 再修订」括注（入口 ② 的路径框已删）；
  §5.23 的「焦点在输入框（路径框语义）」改写为口令框 / 保存目标路径框并标注旧路径框已删。
- §8 验收 7：`shell-smoke` 增 HD19 空态形态守卫（`#empty-state` = 一枚 `#empty-pick` +
  一行 hint，三件删掉的控件不在 DOM）；验收 9：`preview-smoke` 打开通道 =
  `S.openByPath(path)`（§7 驱动）。
- §11：「改粘贴/拖拽装载」行装载入口 = `#empty-pick` 一枚大按钮（无路径框）；
  「改 UI 契约 / 参数词表 / 顶栏形态」行启动页入口 = `#empty-pick`、`openByPath(path)` =
  §7 驱动通道、决策表范围 = HD1–HD19 + SP1–SP5。

## 2026-11-06 — §5.37 新增（SP5 右侧边栏退场）+ §5.36 挂 SP5 标记 + §11 导出/UI 契约两行换宿主

- §5.37：右侧边栏**整块删除**（`<aside id="right-sidebar">`、`form#panel`、`#panel-actions`
  含 `#save-open`）；导出设置段（`#panel-export` + 五个 `.field` + `#estimate`）迁入
  `#save-modal`（`#save-source` 之后、`#save-pick` 之前），id/`data-field` 不变；`#app-main`
  grid 改单列 full-bleed；`setState("export")` 不再开 `details`（12 态不变）；保存对话框唯一
  入口 = `#btn-save` + Ctrl+S；ui-ids 63 → 59、§4 151 → 144、§2 `ui.lang`/`ui.theme` 的
  `i18nkey` 改挂 `lang.en`/`theme.light`。
- §5.36 末尾追加「2026-11-06 起 SP5 再修订」括注（段落正文不重写）。
- §5.24（HD3）的「版式固定 two-col」标为当时形态 → SP5 单列；§5.33 的「侧栏『新增实例』按钮」
  标为已随 SP1/SP5 退场（通道 = 加章模式 + 骑缝放置）。
- §11：「改导出 DPI/质量」行的宿主列 = `index.html` 的 `#save-modal` 导出设置段 +
  `app-shell-export/chrome` + `tools/verify/export-smoke.mjs`；「改 UI 契约」行写明导出段在
  保存 modal 内、版式单列 full-bleed、决策表范围 HD1–HD18 + SP1–SP5。

## 2026-11-05 — §5.36 新增（SP1–SP4 侧栏收尾）+ §8 验收 15 换「预设后端 Go 测试」+ §11 三行换义

- §5.36：右侧边栏只剩导出段 + 动作段；`#panel-seal/instances/split/batch/crosspage` 与
  `#asset-hooks` 删除、`app-batch.js` + preset 帮助器整块删除（后端路由/Go 测试保留）、
  切分与去背与预设词表退回 §7 驱动、落盘链键盘化（Ctrl+Enter/Ctrl+Z）、SP2 分页条、
  SP3 z 序、SP4 顶栏骑缝章放置 + 面板 cp 组（binding `none` = 逐实例降级）。
- §8 验收 15：`batch-smoke.mjs` 随批处理 UI 删除；预设四路由由
  `presetstore/store_test.go` + `api/seal_preset_test.go` 常驻钉住。
- §11：「改预设库」改后端-only、「改批处理」拆成「改切分/落盘/批处理后端词表」+
  新增「改骑缝章放置/面板组（SP4）」行。

## 2026-11-05 — §5.14 修订（V7 取代 V3）+ §5.30 缩放通道 + §8.10 断言句 + §11 新「改滚轮/视口手势」行

- §5.14：Ctrl+滚轮**恒为**整页视图缩放（seal/page 比例不变），V3 实例通道删除；
  实例缩放 = 四角手柄 + `+/−` + 滑杆。§5.30 的「滚轮可超出 200%」半边移除。
- §8.10：`overlay-smoke` 滚轮断言改为「视图 zoom 变、`apply.scale` 不变」。
- §11：新增「改滚轮/视口手势」行（chrome `zoomBy` / preview `bindPan` / overlay 无通道）；
  「改叠加层/印章通道」行去掉滚轮字样。

## 2026-11-05 — 新增 §5.35（壳模块拆分）+ §3 目录行 + §11 六行改写到 `app-shell-*` 模块

- §3：`web/static/` 列表拆出 `app-shell-{kernel,instances,seals,export,docops,chrome,verify}.js` 行。
- §5.19/§5.23：光栅幂等与装载 gate 的文件归属改到 `app-shell-export.js` / `app-shell-docops.js`
  + `app-shell-chrome.js`。
- §5.35：拆分规则（加载顺序、`window.__autoStampShell` 唯一跨模块通道、`S.` 前缀、门面成员
  零变化、生成器留档不重跑）；非 UI 语义 → 不占 `UI_SPEC §8` 决策表。
- §11：改切分/叠加层/HD8–HD12/落盘/预估/导出/装载/HD13–HD16/HD17–HD18/UI 契约/i18n 各行文件
  归属全部落到具体模块；新增「改壳模块」行。

## 2026-11-05 — 新增 §5.33/§5.34（HD17 装载不放置 + 实例全删；HD18 面板收起齿轮按钮）+ §5.23 修订 + §8.7 断言扩 + §11 新行

- §5.33：装载通道（上传/下拉/粘贴/拖拽）只设当前印章；实例创建唯一通道 = 加章模式点击 /
  「新增实例」（创建时快照 `currentSeal`）；删除保护废除（`instances.err.last` 键删）、实例可删到
  零、boot 无预置「Seal 1」；`setSealForSelected` 降级为 verify 脚本驱动 API。
- §5.34：`#instance-collapse` ↔ `#instance-fab`（36px 齿轮）双向切档，`panelCollapsed` 默认
  收起（不持久化）；probe `instancePanel` 返回 `{visible, collapsed, fabVisible,...}`。
- §5.23 图片分支措辞修订（作废「设给选中实例 / 其余新增实例」半边，指向 §5.33）；§8.7 壳契约
  描述扩到 HD8–HD18（装载不动实例、全删到零、齿轮收起/展开往返）；§11 增「装载只设当前印章 /
  实例全删 / 面板收起（HD17/HD18）」行。

## 2026-11-05 — 新增 §5.31/§5.32（HD13–HD16 细节调整）+ §6 `GET /api/logs` 行 + §8.7 断言扩 + §11 两行

- §5.31：`#seal-preview` 改 `#preview` 内绝对定位 overlay（左下距底 10px，分页条可见时
  77px），不再占布局；下拉当前选项同步 = 当前印章路径，无路径印章 = `__current__` 标记项
  （选中 = no-op）。
- §5.32：顶栏控件同高 34px；`#btn-console` 切 `#log-console`（左列底部 overlay 180px），
  内容 = `console.LogRing` 400 条尾窗（`WithRing` 扇出），仅可见时 1.5s 轮询；可见性持久化
  `config.UI.ConsoleVisible`（默认 false = 隐藏）。
- §6 路由表加 `GET /api/logs`（`{lines,next}` + `?since=` 增量）；§8.7 壳契约描述扩到
  HD8–HD16（预览卡 overlay 几何、当前选项、同高、开关 + 日志非空 + 持久化）；§11 增
  「预览卡 overlay / 下拉当前选项 / 顶栏高度 / 后端终端」行，「改 UI 契约」行 `ui.*` 词表
  补 `consoleVisible`。


## 2026-11-04 — 新增 §5.28/§5.29/§5.30（HD8–HD12：印章顶栏通道、加章模式 + 逐页落盘、浮动参数面板）+ §6 三行契约 + §8.7/§8.12 断言 + §11 新行

- **来源**：用户 2026-11-04 对话指令（功能调整 1–6），决策登记 = `UI_SPEC §8` HD8–HD12。
- **§5.28**：印章装载三来源（顶栏 `fs/pick{filter:image}` + `seal/prepare` JSON `{pathGrantId}` 形态
  记录 `settings.recentSeals`；下拉去后缀名 replay；粘贴/拖拽 multipart 无路径）+ 兜底 = `path_denied`
  移除选项 + `PATCH settings` 整组替换。记录仍落既有 `%APPDATA%\AutoStamp\settings.json`，不在 exe 目录新建。
- **§5.29**：`#btn-seal-add` 加章模式（`state.addMode`，不持久化；点击页面空白 = `addInstanceAt`，
  点击点 → `anchor(center)+offset`）；实例 `pages` 默认 = 放置页（HD11，取代「所有页」语义，
  `crossPage` 实例仍 `all`）。
- **§5.30**：`#instance-panel` 浮动面板（贴选中实例右侧、放不下翻转）；六控件 = 混合模式/透明度/
  明度/饱和度/缩放/旋转；缩放滑杆 0.1..2.0（落盘词表放宽 0.05..5.0）、旋转 −180..180；
  复位/删除。**本轮后续修正**：复位与默认参数同源 = `DEFAULT_PARAMS` 快照（boot + `applySettings` +
  `apply` 组 `persist` 刷新）——面板控件镜像选中实例，直接读控件会把现值回显，复位必须回快照。
- **§6**：`fs/pick` filter 词表（`image` = 印章图）、`seal/prepare` 两形态协商（JSON multipart）、
  `settings.recentSeals` 字段（24 条去重截断，`PATCH` 整组替换）。
- **§8.7/§8.12**：shell 契约描述补 HD8–HD12 全链；`apply-smoke` 分段令牌增 `perpage`。

## 2026-11-04 — 新增 §5.27（预览视口 V4–V6 + ghost 修复）+ §8.9/§8.10 断言扩充 + §11 视口行

- **新增 §5.27（预览视口契约，用户 2026-11-04 人工验收修正指令）**：fit = 整页适配
  （`fitZoom = min(stageWidth/pageW, stageHeight/pageH)`，保比例，打开默认 fit）；
  `#preview-stage` `overflow: hidden` = 无滚动条；缩放超容器时平移走程序化偏移
  （Space+方向键 / Space+左键拖动 / 无 Ctrl 滚轮；原生 clamp = 「四边不超出容器四边」）；
  Ctrl+鼠标中键 = `fit()`；实例画布不挂 DOM（只作 `probe('instancePixels')` 背板），
  旧版 DOM 双绘制 = 「完整印章 + 左上角副本」ghost 的根因，已根除。
  `brightness/saturate` 复核结论：滑杆链路本就分离，视觉不可辨是 ghost 覆盖所致。
- **§8.9**：preview-smoke 断言补 fit = 整页、V5 平移（Space 组合 + clamp 边界 +
  不劫持印章步进）、V6 Ctrl+中键回 fit。
- **§8.10**：overlay-smoke 断言补 filter 语义（brightness/saturate 独立生效 +
  无挂 DOM 实例画布）。
- **§11**：「改预览渲染」行扩成「改预览渲染/视口」（`fitZoom/stageHeight`、`bindPan`、
  `probe('pan')`、`panStage`）；「改叠加层/印章通道」行写明实例画布 probe 背板语义。

## 2026-11-04 — §5.24 改写 + 新增 §5.25/§5.26（HD5/HD6/HD7 当前态）+ §4/§5.23/§8/§11 同步

- **§5.24 改写为当前态**：顶栏**没有任何文本**（HD5：`#top-file` 已删，作废 HD2 的顶栏承载半边）；
  左簇 = 「打开」+「保存」相邻贴着左边缘，右簇 = 语言 → 主题 → 快捷键，**快捷键最右**；版本 +
  打开后的文件名只写在窗口标题（前端 `setDocTitle()` 写 `document.title`，与 Go `windowTitle`
  同一个串），`#top-file` 的 `title` 属性（完整路径 · 体积）随元素一起消失。图标按钮、
  固定 two-col、`probe('docTitle')` 等既有事实沿用。
- **新增 §5.25（启动页装载入口，HD6）**：入口只有三个 —— `#empty-pick`「打开文件」（与顶栏「打开」
  同一个 `pickAndOpen()`，`empty.pick.btn` = Open file / 打开文件）、`#empty-path` 路径框（**回车**
  = `keydown` Enter + `e.preventDefault()` → `openByPath()`）、窗口级拖放/粘贴（`submitFiles` →
  `handleFiles` multipart）。「上传文件」按钮 `#empty-upload`、「打开」按钮 `#empty-open`、隐藏
  `<input id="file-input">` 与其 change 监听全部删除：`UI_SPEC §6` 的契约 id 93 → 89、§4 删
  `empty.open.btn` + `empty.upload.btn`（270 → 268，`top.file.hint` 保留）。无新路由/新字段。
- **新增 §5.26（左列预览出血，HD7）**：`#empty-state` 去 `margin: 24px` + `border-radius: 8px`、
  `#preview-stage` 内边距 `18px` → `0`、`.page-frame` 圆角 → `0`；拖放反馈仍是
  `#preview[data-drag]` + `#drop-hint`。
- **§5.23**：装载漏斗的「与『上传』按钮同语义」措辞改掉（该按钮已不存在）—— 单个 PDF 改成
  「与窗口级拖放同一条 multipart 链」，并指向 §5.25 说明「打开文件」走的是 `fs/pick` grant。
- **§4 版本条目**：「四处同源」→「三处同源」（原生窗口标题栏 / 浏览器标签页 / `/api/health`），
  并写明 `#top-file` 已删（§5.24）。
- **§8 验证清单第 9 项**：P1 的真 UI 通道 = 「`#empty-path` 回车」，不再是「`#empty-path` +
  `#empty-open`」。
- **§11**：「改粘贴/拖拽装载」行补启动页入口（`#empty-pick` + `#empty-path` 回车，无隐藏
  `file-input`）并指向 §5.25；「改 UI 契约 / 参数词表 / 顶栏形态」行的决策表指向 HD1–HD7，
  文件面补 `setDocTitle()` + `probe('docTitle')`、路径框 Enter → `openByPath`、左列出血的三条 CSS。

## 2026-11-04 — §4 版本条目补 `pickVersion` 规则（显示版本 = `0.1-dev`）

- §4 的「版本用 Go 自动 VCS 注入」条目补一段：`internal/app.pickVersion` 只认真实标签，未打标签时
  Go 的伪版本（`v0.0.0-<日期>-<hash>+dirty`）不进 UI，显示的就是 `devVersion`（当前 `0.1-dev`）；
  窗口标题栏 / 标签页 / 顶栏标题 / `/api/health` 四处同源（`UI_SPEC §8` HD2 + HD4）。
  仍然没有 `-X main.xxx` 形式 ldflags，出货要换版本只需 `-X autostamp/internal/app.devVersion=`。

## 2026-11-03 — §5.22 改写 + 新增 §5.24（顶栏契约 HD1/HD2/HD3）+ §7/§8/§11 同步

- **§5.22 重写**：最近文件只剩后端 —— `config.RecentFiles`（24 条）+ `SetRecent` 继续记录，
  `settings.json` 的 `recentFiles` 有值；RF1 的两个 UI 入口（启动页列表 + 顶栏下拉）在 2026-11-03
  顶栏收尾时删除，前端不再读回展示。
- **新增 §5.24**：顶栏 = 「打开」（左）+「保存」「快捷键」+ 语言/主题分段（右），全是图标按钮
  （内嵌 SVG + `data-i18n-title`，cn 孪生 `data-i18n-title-cn`，`applyLang` 写 `title` + `aria-label`）；
  品牌文字 / 最近入口 / 顶栏上传 / 导出设置入口 / 密度切档 / 版本 chip 都已删（启动页 `#empty-upload`
  当时还保留，2026-11-04 随 HD6 删除）；`#top-file` = 窗口标题文本（`AutoStamp <版本>` + 打开后的文件名），版本串同时写进原生窗口
  标题栏（Go `windowTitle`）与标签页（`document.title`）；`#top-file` 本身已在 2026-11-04 随 HD5 删除；版式固定 two-col，`ui.density` 契约字段与
  `[data-density=…]` 规则删除，`setDensity()` / `probe('density')` 由 `probe('docTitle')` 取代。
- **§7 + §8 第 7 项**：验证清单去掉「密度切换」，改成断言窗口标题（`probe('docTitle')`）与图标按钮
  `data-i18n-title` tooltip 的 i18n 覆盖。
- **§11**：删「改最近文件」行（UI 入口已不存在）；「改 UI 契约 / 参数词表」行加「顶栏形态」，涉及文件
  补 `web/static/app-i18n.js`、`style.css`、`internal/config/{types,sanitize,patch}.go`、`main.go`。

## 2026-11-03 — §4 新增 `build1.ps1`/`buildm.ps1` 单 exe 出口 + §11 发布物行扩充

- §4 命令块追加两行 + 一段细则：两个脚本都把产物写进 `dist\autostamp.exe`（已存在覆盖；同名进程在跑先
  报错退出）。build1 = stripped 同构建换输出名；buildm = 构建后 UPX `--ultra-brute`（`-Fast` 退
  `--best --lzma`），upx 缺失自动从 GitHub 取 v5.0.2 装 `tools\upx\`（git 不入库、不进 embed），
  打包后 `upx -t` + 真启动 `/api/health` 门槛。登记两坑：与 `build.ps1 -Task console` 互盖同名产物；
  打包后 `go version -m` 读不出 commit + AV 打包器误报风险。



## 2026-11-03 — §0 文档清单：IMPLEMENTATION_PLAN 行标注收官 + 指向 §10.1 工作模式

- 该文档行改为「P0–P7 已于 2026-11-03 收官；§0 = 恢复协议；§10.1 = 当前工作模式（人工端到端验收 +
  细节调整 + 功能细化）」。与 `docs/IMPLEMENTATION_PLAN.md` 同轮改动一致（§0 第 9 条 / §10.1）。


## 2026-11-03 — §5.23 粘贴/拖拽装载 gate（PD1/PD2）+ §11 速查行

- §5 新增决策 23：窗口级 Ctrl+V 与拖入共用同一装载 gate（`app-shell.js` 的 `submitFiles`/`classifyLoad`）：
  只接受「单个 PDF」（multipart `pdf/open` adopt，同「上传」按钮语义）或「单张/复数图片」（`seal/prepare`：
  单张设给选中实例；多张时第一张设给选中实例、其余各新增实例按文件名命名）；无文档时只 prepare 不指派；
  多 PDF / 混拼 / 其它文件 toast 告警不装载；焦点输入框且含 `text/plain` 的粘贴放行（路径框语义）；
  `dataTransfer` 不含 Files 的纯文本拖拽不被劫持（不 preventDefault）。
- §11 速查表新增「改粘贴/拖拽装载」行；§6 路由表未变（无新路由/无新字段，只动前端）。
- 验证：`shell-smoke.mjs` 新增装载链断言（真 File/真 /api 往返：拒绝词表读数、单 PDF drop 打开、
  图片装载与 I1 实例语义、输入框放行、`#drop-hint` 存在）。


## 2026-11-03 — P7：§6 Origin 默认开 + `nosniff` 契约化

- §6 的 `Host` 那条改成：Origin 校验**随 P7 默认开启**（`security.strictOrigin: true`，
  仍可 `PATCH` 关；非 GET/HEAD 且 Origin 非本机 → 403 `bad_origin`；不带 Origin 的
  curl / Go 测试不受影响；读动词不查 Origin）。
- 新增一条：每个响应带 `X-Content-Type-Options: nosniff`（中间件一处，含错误信封）；
  CSP 归 `web/embed.go` + FACTS §1.5，并登记「原计划的内联 hash 策略不需要，因为前端
  没有内联脚本可放行」。
- 代码同步：`internal/app/middleware.go` 加 `securityHeaders`；`internal/config/defaults.go`
  的 `StrictOrigin` 默认翻成 `true`；测试 `TestMiddlewareSetsNosniffEverywhere`。
- 实测：`build.ps1 -Task vet,test,verify` 失败 0 / 跳过 0（十脚本，真窗口冷启动 531 ms）。

## 2026-11-03 — P6 收尾：BM5、§8.15 实测重写、§11 真实文件、§4 package、§6 `splitPages` 补登记

- **BM5 新增**（§5.21）：预设的 `pages:"all"` 对批处理无效 —— `pagesForDoc()` 逐文档求交集
  （不实现会静默盖错页，样本实测会盖到没指定的页）。决策计数改成 BM1–BM5。
- **§6 修正**：§5.20 的「四条预设路由」是笔误，实际五条（list / save 的 `POST`+`DELETE` / raw）；
  `POST /api/pdf/split` 行补回漏登记的 `splitPages`（前端已在发、契约已实现）。
- **§8.15 重写**成实测形态：22 份样本（20 可盖 + AES-256 加密 + 故意坏）、计数 `[22,20,1,1]`、
  `_batch\原名.dpi150.q75.pdf`、**源文件字节不动**、CSV 22 行 + JSON 22 条真下载、
  两个预期 400 之外 0 失败请求与 0 console error。
- **§11 两行改成真实文件**：批处理行不再指 `internal/batch/*` + SSE（作废的 BC1 设计），
  改成 `app-batch.js` + `app-api.js` + `pdf.go(dir)` + `save.go(mkdirs)` + `fsx/list.go`；
  新增「改打包/发布物」行。
- **§4 加 `package`**：`-Task stripped,package` → `autostamp-<rev>-win64.zip`（25 MB 体积门）。
- i18n 事实纠正：批处理 UI 实为 44 个键，`app-i18n.js` 共 276 键（生成器输出，非手改）。

## 2026-11-02 — P6 契约：§5 加决策 20-22、§6 预设/批处理行改写、§8 加第 15 项、§11 加两行

- **决策 BC1-BC4 作废、被 BM1-BM4 取代**（用户 2026-11-02 改口径）：批处理从「服务端串行作业 +
  SSE + 只矢量」改成**前端逐文件跑既有链** —— `fs/pick` → `pdf/open` →（可选 `pdf/split`）→
  `pdf/apply` → `pdf/export`(raster，页位图由前端 pdf.js 渲染回传) → `pdf/save{mkdirs:true}`；
  因此 `api.batch.dpi/customDpi/quality` 在批处理里**真正生效**（这是改口径的动机）。
  输出 = `源目录\_batch\<原名>.dpi<N>.q<Q>.pdf`（BM2 取代 BC2 的 `<名>_seal.pdf`；
  单扩展名是因为 `fsx.ValidateTargetPath`/`CheckWriteTarget` 只认 `.pdf`）；
  加密件不弹密码、跳过并记 `password_required`（BM4 取代 BC3）；
  **没有** `/api/batch/*` 路由、没有 SSE（BM1 作废 BC1），报表与 CSV/JSON 由前端生成（需求 9）。
- 顺带修正既有文档的「已实现」假象（此前正文写的是事实不存在的状态）：`internal/batch`、
  `internal/api/batch.go`、`tools/verify/batch-smoke.mjs`、§6 三条 `POST /api/batch/*`、
  §5.21「服务端串行」、§8.15 的 SSE 断言、§5.20 预设库、§8.15 最近文件入口 ——
  本轮全部按仓库里的真实实现重写；§6 的预设行由 `POST /api/seal/preset/load`
  （原登记）改成 `GET /api/seal/preset/raw?id=`（载入 = 前端把 raw 字节重新喂 `seal/prepare`）。

## 2026-11-02 — P5 契约：§5 决策 19、§6 export 行改写、§8 加第 13 项、§11 导出行

- §5 决策 19：光栅导出 = 前端渲染回传、服务端只写字节（JPEG 直传不重编码、
  页 pt = `px*72/dpi`、无旋转量、90 MiB 硬限 + 前端提交前拦截）。
- §6 的 `POST /api/pdf/export` 行由占位符改成实现契约：按 `Content-Type` 协商两形态
  （json = vector 只裁页 / multipart = raster 送 `spec` + `page-<n`）；错误码表加
  `page_too_large`。
- §8 加第 13 项（`export-smoke.mjs` 的断言清单），`build.ps1 -Task verify` 变九项。
- 补记:§8 的第 13 项在本轮后半才真正落到正文(此前只有 §11 行提到脚本),内容 = export-smoke
  的断言清单;原第 13 项(build.ps1 串命令)改号为 14。
- §5 决策 19 追加**保存幂等**(已光栅化 + 参数未变 ⇒ 第二次保存不再光栅化),§11 导出行同步。
- §11「改导出 DPI/质量」行补上 `app-shell` 的保存内 raster 通道与 verify 脚本。
- 顺带 cutover：`app-api.js` 的 `uploadMultipart` 是全仓唯一 multipart 出口，
  `uploadPDF`/`uploadPOST` 退化为它的「单 `file` 形状」包装 —— 前端不再各自复制
  fetch 语义与信封错误处理。

## 2026-11-02 — P4 落盘契约：§5 加决策 17/18，§6 加两行路由，§11 加两行速查

- §5 新增决策 17（落盘坐标 = 显示空间 + 一次 y 翻转；条带框纵横比取整枚印章）与
  决策 18（**快照按画布元素拥有**：`app-overlay` 的 `state.surface = info.canvas`，
  不按 page/scale/尺寸判断归属，否则换文档后快照永不重抓）。
- §6 表内 `POST /api/pdf/apply`（实例数组、按外观分 pass、注册前 `Validate`）与
  `POST /api/pdf/save`（`targetPath`/`pathGrantId`/`replaceOriginal` 三选一）两行改「已实现」。
- §11 速查加「改落盘/撤销/保存」行；「改叠加层/印章通道」行加 §1.9 与快照引用。
- §8 的 P4 验收：`node tools/verify/apply-smoke.mjs`（48 组回读矩阵 + 骑缝落盘 +
  保存链 + 撤销）；`build.ps1 -Task verify` 的脚本清单随之加 `apply-smoke.mjs`（八项）。
- 本轮修掉两处 P4 前端回归：`adopt` 的派生旗标把 `from:"open"` 误判成派生
  （换文档不清 undo 链、不记 open 资产），以及被吞掉的 `autostamp:open` 事件
  （分页 rail 因此 0 chip，`preview-smoke` 16 项失败）；`shell-smoke` 的 save 断言改成
  「客户端守卫（`err.apply.noDoc`，不发请求）+ Node 侧 envelope（`bad_session`/`bad_body`）」。


## 2026-10-30 — build.ps1 修 stderr 升级异常；P4 半截改动修绿（vet/test/全量）

- `build.ps1` 停在 `go vet` 行的根因：PS5.1 下脚本顶部的 `$ErrorActionPreference='Stop'` 会把
  `& go ... 2>&1` 合并进错误流的原生 stderr 升级为终止异常 `NativeCommandError`——脚本死在
  `Invoke-Native` 调用处，后续任务全部消失。修复：`Invoke-Native` 与 `go version -m` 探针内部
  临时把首选项放宽为 `Continue`（`finally` 还原），原生命令成败只由 `$LASTEXITCODE` 判定；
  UTF-8 BOM 保持不变。
- P4 半截改动（工作区未提交）的编译/vet 错误修绿：
  - `blend.go` `BlendApply` 还在调旧签名 `stampGraphicStates(content)`（已改为
    `(ctx,pageDict)→(map,error)`）→ `used, err := stampGraphicStates(ctx, pageDict)`；
  - `appendContent` 断言的 `types.IndirectObject` 在 pdfcpu v0.16.3 不存在
    （`types.go:554` 实名为 `IndirectRef`）→ `types.IndirectRef`；
  - `ParseBlend` 格式串写串成 `...%16 模式词表之一...%q`（vet 报 `%16` unknown verb、join 参数
    未绑）→ `16 种混合模式之一（%s）...%q` 并传入词表与原始输入；
  - `save.go:175` `return` 行尾多一个 `)`（syntax error: unexpected )）。
- 过时契约断言更新（AGENTS §7 要求，不 re-pin）：`/api/pdf/save` 已接线（P4），
  `register_test.TestUnimplementedRouteKeepsRouterReply` 仍钉在它上面（POST 得 400 不是 405）
  → 探针改钉未接线的 `/api/pdf/apply`（POST→405、GET→404）；`shell-smoke` 的 save 断言由
  「router 405 文本」改为断言信封错误码 `bad_body`（无 opened 文档时的真错误，仍不是假成功）。
- 实测：`go vet ./...` 无输出；`go test ./...` 全绿（api/app/config/console/fsx/pdfcore/tmpstore/web ok）；
  `node tools/verify/shell-smoke.mjs` OK；全量 `build.ps1` 退出码 0，整份日志 0 个 FAIL 行。

## 2026-10-30 — P2 叠加预览落地：§5 新增 12-15 / §6 seal 行改实测 / §8 新增第 10 项 / §3 §11 修正

- §3 目录：`web/static` 补 `app-seal.js`、`app-overlay.js`（此前只列 P1 那几个文件）。
- §5 新增 12（去背在**前端**：`min(R,G,B)>=60` 判彩色、白/灰丢弃、彩像素反算；
  「撤销去背」= 用内存原图以 `despill:false` 重跑 prepare，不靠 undo 栈）、
  13（画布必须**显式预乘 uint8**：`getImageData` 读回的是预乘值，不预乘会出暗环）、
  14（坐标一律左上原点 y 向下 = C1 未评审默认；滚轮缩放只在光标位于选中实例内时改
  `apply.scale`，事件必须 `stopPropagation` = FACTS §1.8 V3）、
  15（导出体积预估是前端派生、不发请求，按 FACTS §4 表 × 页面积缩放）。
- §6：`POST /api/pdf/seal/prepare` 行标「**已实现**」+ 词表 + 配套
  `GET /api/pdf/seal/raw?id=`（只回印章字节给合成）。
- §8 新增第 10 项：P2 校验 `overlay-smoke.mjs`（分段 `--only=`；矩阵/去背/条带/filter/
  预估断言清单）。同时记录实测踩坑：**改前端后必须去掉 `--reuse-build`** —— 它复用
  `dist/autostamp-overlay-smoke.exe` 的旧嵌入副本，新代码看不见（本轮就是这么踩的）。
- §11：切分/骑缝行改成实际文件（`app-preview.js:drawSplitMarks` +
  `app-overlay.js:stripGeometryFor/stripRectsFor` + `app-shell.js:#split-veto`，
  不是计划名 `app-crosspage.js`）；新增「改叠加层/印章通道」「改导出体积预估」两行。
## 2026-10-29 — P3 切分落地：§6 split 行改实测 / §11 补 i18n 行

- §6 `POST /api/pdf/split` 行标「已实现」并写死词表：`{assetId, splitMode, rows, cols,
  customCuts[], splitVeto}`（`splitVeto` 是指针，`false` 是真答案）→ 新 assetId（kind `split`）
  + 与 open 同形状的页元数据；写明「原资产不动 = UI 的撤销切分」。
- §11 补 i18n 行：`UI_SPEC §4` 是文案唯一来源，`app-i18n.js` 由
  `node tools/verify/gen-i18n.mjs` 生成（勿手改）。
- 加密文档走同一 `inspectAsset`：受保护 PDF 的切分回 `password_required`/`password_invalid`，
  切分请求本身没有 `pw` 字段（词表已冻结），口令只能从 open 那次带过来 → 记为 P7 加固项。
## 2026-10-29 — P1 之后：§3 目录树 / §6 fs.pick 形态 / §8 新增第 9 条

- §3 目录树按 P1 实际代码对齐：`web/static` 增 `app-preview.js`/`app-textlayer.js`/
  `app-pager.js`；vendor 补 `iccs/` 与 `web/pdf_viewer.css`（文本层 CSS，裁剪状态记在
  vendor `README.md`）；`fsx/pick*.go`、`webx/session.go`、`api/pdf.go`、`pdfcore/read.go`
  进树，`pdfcore` 其余文件仍标「P2-P5 才创建」。
- §6 `POST /api/fs/pick` 行改成实测形态：`{filter,multi,startDir}` 或 `{"filePath":…}`
  直开授权、取消回 `{cancelled:true, picks:[]}`、无选择器平台 501 `pick_unsupported`。
- §8 验证要求加第 9 条 `preview-smoke.mjs`（现场生成四类样本 + 真 UI 打开 + 画布像素 /
  `getTextContent` 条数 / `.textLayer` 宽度 == 画布 CSS 宽 / 分页 chip 数 / vendor 0 失败），
  「全部串进 `build.ps1`」重新编号为第 10 条。

## 2026-10-29 — P0 落地后更正契约与规范（与代码核对）

- §3 目录树按实际代码对齐：`internal/{webx,fsx}`、`internal/app/{net,version,middleware,browser,server}.go`、
  `web/static/app-{shell,api,i18n}.js`、`tools/verify/{cdp,gen-i18n,shell-smoke,webview-launch,comprobe}`；
  并显式标出 **`web/static/vendor/pdfjs/` 只有 P1 才进**、**`internal/pdfcore` 只有 P2-P5 才创建**。
- 新增 §6「契约细则」。初稿是凭设想写的，与代码核对后全部更正：信封是**扁平**
  `{ok,data,code,error}`（不是嵌套 `error{code,message,details}`）；已注册错误码只有
  `bad_body`(400)/`bad_host`(421)/`bad_origin`(403)/`internal_error`(500)；
  **不存在** `webx.NotImplemented` 占位（未接线路由不注册，保留 `ServeMux` 的
  405 纯文本 / 404，见 FACTS §1.5）；**不存在**「中间件把 405 包成 JSON」；
  「拒绝 `Sec-WebSocket-Protocol`」没有实现；`Origin` 校验在 `strict` 开关后面
  （P7 打开），`Host` 校验恒开。
- §7 测试条更正：原写「前端契约测试用 `web/*.test.js`（node，无框架）」与实际不符 —
  实际只有 Go 测试（`go test ./...`）+ `tools/verify/*.mjs` 运行时断言；
  引用过的 `web/static_test.go` 并不存在，已改为真实文件 `web/embed_test.go`。
- §8 增第 7-9 项：`shell-smoke`（真二进制 + CDP，沙箱化 `%APPDATA%`/`%LOCALAPPDATA%`）、
  `webview-launch` + `comprobe`（窗口通道实测，FACTS §1.6）、以及「全部由 `build.ps1`
  串成一条命令，任一失败退出码 1」。
- §6 路由表：`/api/settings` 行改为 `GET` + `POST`（body 是 `{"patch":{…}}`）——
  代码里没有 PATCH 路由。

## 2026-10-29 — 澄清「编译产物双击后闪退」+ 补 `-Run` 开关

- 用户实测：资源管理器双击 `dist\genfix.exe` → cmd 窗口一闪即退。根因不是崩溃：当前 `dist\` 里只有
  `genfix.exe`（CLI 素材生成器，打印 3 行即以退出码 0 结束），`autostamp*.exe` 尚未生成
  （P0 未开工）。§4 已把这条事实写明。
- `tools/genfix` 同时修掉一个隐患：无参数时它用 **cwd 相对路径**（双击时 cwd = `dist\`，
  结果把 PNG 写进 `dist\docs\ui\fixtures\`）。现改为从 exe 所在目录向上找仓库根
  （判定 `AGENTS.md` + `docs/`），写进 `<仓库根>\docs\ui\fixtures`；找不到仓库根则报错退出。
  `build.ps1 -Task fixtures` 显式把绝对目录作为参数传给它。
- `build.ps1`：新增 `-Run` 开关（此前用法示例里写了 `-Run`，但参数没定义 → 会报「未知参数」）；
  `-Task` 改成手工解析（逗号列表可用，未知任务名报错退出码 1）；`run` 任务在没有 app exe 时
  打印「genfix 是 CLI 产物，双击一闪即退属正常」的提示。
- 实测：`-Task genfix,fixtures` 写入 `C:\AutoStamp\docs\ui\fixtures`（字节与提交版一致）；
  cwd=`dist` 时 `genfix.exe` 仍写到仓库 `docs\ui\fixtures`（不再产生 `dist\docs`）；
  `-Task bogus` 退出码 1；`-Task verify` 退出码 0；全量 `build.ps1` 失败 0 / 跳过 5。

## 2026-10-29 — §3/§4/§11 加入自动编译脚本 `build.ps1`

- §3 目录结构：新增根目录 `build.ps1` 条目（注明「UTF-8 BOM 必需」）。
- §4 构建与运行：手敲 `go build` 命令保留为参考，新增「一键脚本」小节：
  全量 / `-Task verify` / `-Task genfix,fixtures` / `-Task webview -Run` / `-Watch` 五种用法，
  并写明失败退出码 1、根目录无 `go.mod`/`*.go` 时 Go 任务只 `[skip]`（不假绿）、
  版本靠 Go 自动 VCS 注入（禁止手写 `-X` ldflags）。
- §11 速查表：新增「改编译/测试流程 → `build.ps1`」行。

实测（本轮跑过）：`build.ps1`（全量，失败 0 / 跳过 5）、`build.ps1 -Task help`、
`build.ps1 -Watch -Once`、`build.ps1 -Watch` + touch `docs/ui/mockup.html` → 自动重跑一轮
（`--- 10:45:18 触发: docs\ui\mockup.html`，`ui-contract`/`ui-smoke` 均 OK）。

## 2026-10-28 — P0.5 阶段登记

- §0 文档清单加入 `docs/UI_SPEC.md`、`docs/changelog/`；§6 表头注明「字段在 P0.5 与用户确认后才冻结」；
  §8 增加 UI 契约三方校验（`ui-smoke` + `ui-contract`）与「UI 语义门槛」条款；
  §3 目录结构加入 `docs/ui/mockup.html`、`docs/ui/fixtures/`、`tools/genfix`；
  §11 新增「改 UI 契约 / 参数词表」行。
