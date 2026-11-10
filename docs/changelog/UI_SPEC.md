# docs/changelog/UI_SPEC.md

> `docs/UI_SPEC.md` 的变更叙述历史（最新在上）。正文只留当前态事实。

## 2026-11-10 — §8 新增 CS2/SV1（UI8 轮：调色链序 + 覆盖提升；保存对话框退场为原生另存为）；§1 转移、§2（save 行 ctl=no + pick save/defaultName 行）、§3 保存弹窗两行、§4 i18n **140 → 137**、§6 ui-ids 57 → 57（`save-pick` → `save-dest`）、§7 新增保存驱动

CS2 = 链序 ×bright → pow(ink)+alpha lift → sat（UI5-B2 旧序作废），tooltip 文案同步（hint 三键值重写，键数不变）。SV1 = 保存弹窗删 `#save-pick`/chip/targetPath 框/替换切档，新增 `#save-dest` chip（`save.dest.*` 三键）；`api.save.targetPath`/`replaceOriginal` 退 ctl=no；§7 新增 `saveViaDialog`/`saveToPath(path)`/`submitReplace`（headless 不可点按钮的替代通道）。

## 2026-11-10 — §8 新增 SM1/SM2/CS1：UI7 轮（放置模式快捷键 + 右键/Esc 取消 + 调色滑杆配对缺陷）；§4 i18n **139 → 140**、§6 ui-ids 57 不变

`docs/UI_SPEC.md`：§8 决策表新增 SM1（F1/F2 键盘切档）、SM2（右键/Esc 取消开启态；顺带 right-button `pointerdown` 误放置/起拖的缺陷修正）、CS1（用户「三滑块有问题」审核：像素链实测绿，真实缺陷 = `bindPlumbing` capture 读配对首个元素 → number 孪生框落后一步，修复读 `e.target`）三行；§4 新增键 `mode.cancel.hint`（SHORTCUTS 表取消行），`gen-i18n.mjs` 重跑打印 140；§4 计数行同步「SM 加 1 → 140」。§2/§3/§6/§7 零变化。头「最后核对」换成 UI7 摘要，前轮（T1–T2/B1–B2/N1–N4）压成一行注记。

## 2026-11-10 — §8 新增 T1/T2：UI6 轮（苹果系商务极简配色 + styled tooltip + CN 排版）；§4/§6 计数不变（139 / 57）

`docs/UI_SPEC.md`：§8 决策表新增 T1/T2 两行（来源 = 用户 2026-11-10 对话指令：安装 ui-ux-pro-max skill + 「苹果、商务、极简」优化 + tooltip 样式/文字间距）；头「最后核对」换成 UI6 摘要。
§4 i18n **139 不变**（tooltip 文本走 N2 同源通道，不新增键）、§6 ui-ids **57 不变**（`.app-tooltip` 由 JS 生成、不新增 id）、§2 词表零变化、§7 驱动面零变化。本轮是纯视觉/排版 + tooltip 引擎：token 名不变值全换、新增 `--tooltip-bg`/`--tooltip-fg` 两个 presentation token（不进 ui-ids/词表）。

## 2026-11-10 — §8 新增 B1/B2：UI5 轮（骑缝选择框 = 整章轮廓 / 调色烘焙落盘 + 密度滑杆）

- 头「最后核对」= B1/B2 摘要；UI4 轮降为「同日前一轮」（历轮摘要压成一行注记，禁止堆叠）；
  计数链 i18n … → 137 → **139**、ui-ids **57 不变**。
- §2：新增 `api.apply.ink` 词表行（`type=slider+number`、`range=1..10`、`default=1`、
  `decision=B2`、`unit=曲线指数 g`）；`api.apply.brightness` 行 `range` 保持 0..2 但语义换
  「烘焙落盘」；`api.apply.saturate` 行 `range=0..3` → **`range=0..5`**。
- §2 语义要点：新增「`api.apply.brightness/saturate/ink` 烘焙进印章位图」条目（公式
  pow → ×brightness → CSS saturate 矩阵，链序调色→旋转→切条，预览 == 落盘）；骑缝要点挂
  B1 括注（选择框 = 整章轮廓）。
- §3 绑定表：实例参数面板行控件列表 + `ink`（「透明度/明度/饱和度/密度/缩放/旋转」六控件，
  `ink 1..10 曲线指数`）；骑缝实例行挂 B1 注记（选择框宽 fullW、贴装订边、页面内仍只画条带）；
  骑缝要点行同挂 B1/B2 注记。
- §4：**137 → 139**（新增 `api.apply.ink.ctl`/`api.apply.ink.hint` 两键；`api.apply.brightness.hint`
  /`api.apply.saturate.hint` 换烘焙语义双语文本）；清单头「共 139 键」+ 计数链补 B2。
- §7.1 驱动清单：`probe('strips')` 每条目新增 `ox/oy/ow/oh`（轮廓读数）。
- §8：新增 **B1/B2** 两行决策（来源 = 用户 2026-11-09 ask 选择，两项一批；B1 =「整章轮廓框」、
  B2 =「新增密度滑杆+全部烘焙落盘」；C3/B4 旧「preview-only」条目挂 B2 修订注记）。
- 本轮契约汇总：i18n **139**、ui-ids **57 不变**、`data-field` +1（`api.apply.ink`）、
  字段词表 +1、路由/状态/id 不变；门槛 = `build.ps1` 全量 失败 0 / 跳过 0。


## 2026-11-09 — §8 新增 N1–N4：UI4 轮（透明度 0.6 / 说明转 tooltip / 仅随机 / startOffset 百分比）

- 头「最后核对」= N1–N4 摘要；IP1/IP2 降为「同日前一轮」、Z5 降为「更早一轮」，历轮摘要压成一行
  注记（禁止堆叠）；计数链 i18n … → 141 → **137**、ui-ids … → 58 → **57**。
- §2：删 `ui.crosspage.sliceMode` 词表行（N3）；`api.apply.startOffset` 行改 `range=0..100（%）` +
  `unit=%` + `decision=D2,N4`；语义要点两处重写（`startOffset` = 百分比 +
  `travel = pageH − 条带盒高`、`Y = (1 − startOffset/100) × travel`；Z5 的随机分布段落改为
  「恒生效」分支，删「`sliceMode=even` 时 slices 为空 = 经典均分」句）。
- §3：删「骑缝切片（切档）」行；「装订边 + 起始位置」行括注 `startOffset` = 百分比 0..100；
  覆盖率滑杆行去「仅随机」→「仅骑缝实例显示，N3 起恒随 cp 组」。
- §4：**141 → 137**（删 `ui.crosspage.sliceMode.ctl`/`.hint`、`sliceMode.even`、
  `sliceMode.random` 四行）；`api.apply.startOffset.ctl` 的 cn 改「起始位置（%）」、
  `api.apply.startOffset.hint` 换百分比语义双语双值；计数头补「N3 再删 4 → 137」。
- §6：ui-ids **58 → 57**（永久删 `crosspage-slicemode`；`crosspage-binding`/`crosspage-retry` 存活）。
- §7.1：`addCrossInstanceAt(pt)` 的落点改写成「点击高度 → `startOffset` 百分比（clamp 公式）」；
  Z5 驱动清单删「even mode deletes the list」→「平均 mode 已由 N3 消失，随机取值恒生效」。
- §8：新增 **N1–N4** 四行决策（来源 = 用户 2026-11-09 对话指令，四项一批）；Z5 行尾挂
  「N3 起平均模式作废」注记。
- 本轮契约汇总：i18n **137**、ui-ids **57**、`data-field` −1（`ui.crosspage.sliceMode`）、
  字段/状态/路由不变；N1（会话值复位）与 N2（界面承载改 tooltip）都**不动词表**。


## 2026-11-09 — §8 新增 IP1/IP2：印章参数面板停靠右缘 + 超高滚动条

- 头「最后核对」= IP1/IP2 摘要；Z5 降为「同日前一轮」。
- §8：新增 **IP1/IP2** 两行决策（来源 = 用户 2026-11-09 对话指令，两项一批）：IP1 面板
  停靠 `#preview` 右缘（`right/top/bottom:10px`，宽 236、z 8 不变，`#instance-fab` 同角），
  HD12 悬浮锚点链作废；IP2 全高 + `overflow-y:auto`，内容超高出滚动条。
- §2：六个「浮动参数面板」行换义为「实例参数面板（右缘停靠）」（字段/控件/请求列不变）。
- §6 布局注记：`#instance-panel` 描述改为停靠右缘全高（含 z 序说明不变）。
- 契约面零变化：无新 id、无新键（§6 = 58、§4 = 141 不变），`probe('instancePanel')`
  读数面不变（left/top 现由停靠 CSS 决定）。

## 2026-11-09 — §8 新增 Z5：骑缝切片模拟（平均|随机 + 覆盖率滑杆 + 重新随机）

- 头「最后核对」= Z5 摘要；Z1–Z4 降为「同日前一轮」。
- §2：新增 3 行词表 —— `ui.crosspage.sliceMode`（切档 平均|随机，settings 组字段对
  `apply.sliceMode`，默认平均）、`ui.crosspage.cover`（滑杆+数值，settings `apply.cover`，
  0..100 默认 75，仅随机档可见）、`api.apply.slices`（请求字段，ctl=no，由随机取值写入实例
  参数并随 apply 原样发送）。决策列 = Z5。
- §3 绑定表：cp 组两行（切档/滑杆对），retry 按钮 = 动作行。
- §4：132 → 141（新增 `ui.crosspage.sliceMode.ctl/hint`、`ui.crosspage.cover.ctl/hint`、
  `sliceMode.even`、`sliceMode.random`、`crosspage.retry.btn/hint/noRandom` 共 9 键），
  `gen-i18n.mjs` 重跑 = 141。
- §6：ui-ids 56 → 58（`crosspage-slicemode`、`crosspage-retry`；滑杆对不新增 id）。
- §7：驱动接口新增 `drawCrossSlices`/`retryCrossSlices`/`randomCrossFractions(count, cover,
  rng)`（纯函数 + 注入 rng 供确定性校验）；probe 词表行补 `strips` 的 `frac/cum` 读数。
- §8：新增 Z5 决策行（来源 = 用户 2026-11-09 对话指令；滑条语义经 ask 轮用户自定义输入补全：
  覆盖率 = 首页末页外页面拿到骑缝章的占比，四舍五入）。
- `docs/ui/mockup.html` 同步 cp 组形态（切档/滑杆/重试按钮 + cp-rand 显隐）。

## 2026-11-09 — §8 新增 Z1–Z4：盖章默认值（multiply + 42 mm 自动缩放）与骑缝旋转/可选性修复

- 头「最后核对」= 2026-11-09 的 Z1–Z4 摘要；HD19 降级为「上一轮」，SP5 为「再上一轮」。
- §2：`api.apply.blend` 行 `decision=Z1`（default 已是 multiply，本轮把界面/回退对齐）；
  `api.apply.scale` 行 `decision=HD12,Z2`；scale 语义要点补 Z2 公式（新放置/复位实例 =
  42 mm 章宽 ÷ 页显示宽；竖版宽=短边 A4 竖版 0.2008，横版按 42 mm 目标除以长边；settings
  字段默认仍 0.202）。
- §4：`api.apply.scale.hint` 换文本（en/cn 补 42 mm Z2 自动缩放语义），**132 键不变**
  （`gen-i18n.mjs` 重跑）。
- §7：真实壳驱动清单补 `autoScale()`（Z2 放置缩放；`addInstanceAt`/`addCrossInstanceAt` /
  `#instance-reset` 都取它）。
- §8：新增 **Z1–Z4** 四行决策（来源 = 用户 2026-11-09 对话指令，4 项一批）：
  Z1 默认混合模式 multiply 对齐（`selected` 预置 + 前端回退 multiply）；Z2 默认章 42 mm
  自动缩放（自动判竖版/横版、默认纸张 A4）；Z3 骑缝实例单击可选/按下即拖（删除
  `[data-mode="crosspage"]` 的 sel-box/handle 隐藏 CSS —— 用户报的「必须长按」现象根因）；
  Z4 骑缝旋转先整枚后切竖条（`RotatePNG` bake + `Strips` 切旋转位图 + 预览
  `rotatedBitmapCanvas`/`effectiveBitmap` 同源；`RectFor` 纵横比 = 旋转 bbox）。
- 本轮无新 ui-ids / 新路由 / 新字段 / 新键；ui-ids 仍 56。

## 2026-11-06 — §8 新增 HD19：空态只剩「打开文件」大按钮（作废 HD6 的路径框半边）

- 头「最后核对」= 2026-11-06 的 HD19 摘要；SP5 降级为「上一轮」、SP1–SP4 降级为「更早一轮」，
  历史计数链改为 266 → 267 → 151 → 144 → **132**。
- §1 状态表：`empty` 描述去掉「路径输入」→「拖拽 / 选择 / 粘贴」。
- §3：删「空态 · 路径输入」行；新增「空态 · 「打开文件」大按钮」行（`#empty-pick` 156 px
  大方圆角 button → `fs/pick{filter:pdf,multi:true}`；下方 `.hint` = 粘贴/拖拽提示走
  `submitFiles`）；表后段落补一句「空态只有大按钮 + 一行 hint，`#empty-path` /
  `#empty-pick-multi` / `#empty-pick-filter` 已删」。
- §6 布局段补 `#empty-state` 形状：flex 列居中（`gap: 18px`、`html[data-state="empty"]` 下
  `display: flex`）、`#empty-pick` 156×156 + `border-radius: 16px`（`.ic` 44 px）、
  `.hint` `max-width: 560px`。
- §7.1 真实壳驱动清单：补 `pickAndOpen()` / `openByPath(path)` / `handleFiles(file)` 三条，
  注明 HD19 起 `openByPath(path)` 只是 §7 驱动 API（参数给路径、空/空白 → 错误 toast、不读 DOM）。
- §8：新增 **HD19** 决策行（来源 = 用户 2026-11-06 对话指令）+ 表后 HD19 说明段；HD6 行挂
  「（路径框半边已于 2026-11-06 被 HD19 作废…）」注记，行本身保留。
- §4：144 → **132** 键（删 12 个失去控件面的键 = `empty.msg`、`empty.path.placeholder`、
  `api.fs.pick.filePath.ctl`/`.hint`、`api.fs.pick.multi.ctl`/`.hint`、
  `api.fs.pick.filter.ctl`/`.hint`、`fs.pick.multi.on`、`fs.pick.filter.pdf`、
  `fs.pick.filter.all`、`api.fs.pick.pathGrantId.hint`；`api.fs.pick.pathGrantId.ctl` 保留
  = 保存弹窗 chip 的 `t()` 标题）；`empty.hint` 换文本（拖进来/粘贴打开 PDF、图片装载为印章）；
  §2 fence 的 `filePath`/`filter`/`multi` 三行改 `ctl=no`、`pathGrantId` 行 `i18nkey=-`；
  ui-ids fence 59 → **56**。

## 2026-11-06 — §8 新增 SP5：右侧边栏整块删除，导出设置段迁入 `#save-modal`

- 头「最后核对」换 2026-11-06，SP1–SP4 降级为「上一轮」；§8 的 SP1 段落挂「**SP5 再修订**」标记。
- §8 新增 **SP5** 决策行（来源 = 用户 2026-11-06 对话指令）+ 表后收尾说明段；SP2 行补
  「SP5 起这个导出段位于保存对话框内」。
- §6 布局段：`#app-main` = **单列 full-bleed**（`minmax(0, 1fr)` + `"topbar" "preview"`，
  HD3 的固定 two-col 作废）；「侧栏只剩导出设置 + 动作段」改成「`#panel-export` = 保存
  对话框内的导出设置段（modal 内滚动：`top: 8vh` + `max-height: 84vh` + `overflow-y: auto`）」；
  顶栏段注明「保存」是对话框唯一按钮入口。
- §3 绑定表：五个导出行宿主列改「保存对话框 · 导出设置段」；语言/主题行注明 SP5 后仍在顶栏。
- §5 `Ctrl+S` 行注明顶栏「保存」= 唯一按钮入口（侧栏「保存到文件」按钮已删）。
- §1 状态表 `export`/`save-confirm` 描述换宿主；§7 落盘链句子改「sidebar buttons removed in
  SP1, whole sidebar gone in SP5」。
- §4：151 → **144** 键（删 `save.open.btn` + `ui.lang.ctl`/`ui.lang.hint`/`ui.theme.ctl`/
  `ui.theme.hint` + `split.undo.btn`/`apply.write.hint`（唯一绑定面 = 已删侧栏 `#chain-hint`））；
  §2 的 `ui.lang`/`ui.theme` 行 `i18nkey=` 改挂切档自身文案键（`lang.en`/`theme.light`，
  `decision=SP5`）并在 §4 规则段写明例外；ui-ids fence 63 → 59。

## 2026-11-05 — §8 新增 SP1–SP4：右侧边栏收尾（删面板 + 分页条瘦身 + z 序 + 骑缝章模式按钮）

- **SP1**：§2 字段表把失去控件的行改 `ctl=no`（切分组、`seal.prepare.*`、assetId 组）
  或删除（`api.batch.*` 14 行、`decision.assetIds`）；§6 ui-ids 96 → 63（删
  `panel-seal/instances/split/batch/crosspage`、`asset-hooks`、`strip-preview`、
  `instance-*` 按钮行、`batch-*`、`split-apply/veto/undo`、`seal-preset-*`…）；§7 驱动 API
  增 `setCrosspageAdd/addCrossInstanceAt/runSplit(opts)` 并注明落盘链键盘入口。
- **SP2**：§6 分页条描述改「纯缩略图条（栏高定死、宽度随页比、间距 2px、无 All）」。
- **SP3**：§6 预览卡 z 序段（stamp-layer 4 < seal-preview 5 < log-console 7 < 面板/齿轮 8）。
- **SP4**：§2 `ui.seal.crosspageAddMode` + `ui.seal.crosspageAdd` 行、顶栏描述、
  §7.1 探针 `crosspageAdd`/`strips`（叠加层条带盒读数）。
- §4：267 → 151 键（随面板删除批量移除死键，含 `app.sealAddMode.hint`；再回补
  `binding.none`/`ui.crosspage.binding.*`/`seal.upload.btn`/`save.replace.on`/
  `seal.despill.revert` 等活键，并新增 `app.sealCrossAddMode.btn`/
  `crosspage.binding.fixed`）；`crosspage.binding.fixed` 文案「先选中骑缝实例」。
- 决策表新增 SP1–SP4 行（用户 2026-11-05 对话指令）+ 收尾说明段。

## 2026-11-05 — §8 新增 V7：Ctrl+滚轮恒为整页缩放（取代 V3 的实例缩放通道）

- V3 行标注「2026-11-05 被 V7 取代」；V7 行登记用户修正指令（滚轮缩放针对全局、
  印章与文件相对比例不变）。
- §3 绑定表：选中实例行的 `apply.scale` 通道 = 四角手柄 + `+/−`（滚轮退出）；
  §5 快捷键表 `Ctrl+滚轮` 行换义为整页视图缩放。
- §4 增 `view.zoom.hint`（266 → 267）；§7 叠加层接口清单删 `consumeWheel(ev)`。

## 2026-11-05 — §7.1 标题 + §4 跨模块事件句改到 `app-shell-*.js` 模块组（壳拆分，AGENTS §5.35）

- 纯文件名引用更新；探针/事件/字段契约零变化，§8 决策表不动（非 UI 语义）。

## 2026-11-05 — §8 新增 HD17/HD18：装载只设当前印章（实例可全删、boot 无预置）+ 参数面板默认收起齿轮按钮

- 头「最后核对」重写为本轮摘要（HD13–HD18）；§4 换一键（删 `instances.err.last`、增
  `instance.collapse.btn`，仍 266 键）；§6 ui-ids 增 `instance-collapse`/`instance-fab`
  （94 → 96）+ §6 段落写明面板默认收起；§7 mock 探针 `instancePanel` 增收起态、§7.1
  `instancePanel` = `{visible, collapsed, fabVisible, left, top, w, h}`。
- §8 决策表新增 HD17/HD18 两行（来源 = 用户 2026-11-05 对话指令）+ 表后段落注记（HD17 作废
  PD1 的图片指派半边与 boot 默认实例；HD18 叠加在 HD12 面板上）。


## 2026-11-05 — §8 新增 HD13–HD16：预览卡 overlay + 下拉当前选项 + 顶栏同高 34px + 后端终端开关

- 头「最后核对」重写为本轮摘要；§2 增 `ui.consoleVisible` 行；§4 增 `app.console.btn`
  （265 → 266）；§6 ui-ids 增 `btn-console`/`log-console`/`log-console-body`（91 → 94）+
  顶栏段落重写（左簇含印章通道、右簇含后端终端、控件同高、预览卡/终端面板 = overlay）；
  §7 mock 探针 + `console`，§7.1 `recentSeals` 增 `selected` + `console` 探针行。
- §8 决策表新增 HD13/HD14/HD15/HD16 四行（来源 = 用户 2026-11-05 对话指令）+ 表后段落注记
  （HD13 修订 HD9 形态、HD14 叠加在 HD8 下拉上、`api/logs` 路由登记进 AGENTS §6）。


## 2026-11-04 — §8 新增 HD8–HD12：顶栏印章通道 + 左下预览 + 加章模式 + 逐页落盘 + 浮动面板（侧栏两段删除）

- **来源**：用户 2026-11-04 对话指令（功能调整 1–6）；HD11 是对 W4 的修订（实例 `pages` 默认 =
  放置页，跨页实例仍 `all`），HD12 作废「叠加参数/位置与尺寸」两段的控件形态。
- **§2**：改 3 行（`fs.pick.filter` 词表、`scale` 0.05..5.0、`pos/anchor/offset/pages` 转 `ctl=no`）
  增 2 行（`ui.seal.addMode`、`decision.seal.recentSeals`）。
- **§4**：删 14 键（两段控件的 ctl/hint 键 + 死键）+ 增 9 键（面板标题、开关、预览名、
  `seal.recent.stale`、`seal.addMode.noseal` 等），270 → 265。
- **§6**：ui-ids 删 7 增 9（`#seal-file-input`、两段 id → `#btn-seal-upload`、`#seal-recent-select`、
  `#btn-seal-add`、`#seal-preview*`、`#instance-panel`、`#instance-reset/remove`），89 → 91。
- **§7/§7.1**：删 `setGeomMode`；增 `setAddMode`/`openRecentSeal`/`dropRecentSeal` 与探针
  `addMode`/`recentSeals`/`sealPreview`/`instancePanel`/`page`/`defaults`/`currentSeal`（**本轮回填**：
  名称与返回形态按实现钉死 = `{paths, names, optionNames, optionValues}`、`{visible,w,h,name,drawn}`、
  `{visible,left,top,w,h}`）。
- **§8** 五行决策（选项文本 + 「用户 2026-11-04 对话指令」）；表后段落写明预览出血/面板翻转语义。

## 2026-11-04 — §8 新增 V4/V5/V6：fit 整页 + 无滚动条/Space 平移 + Ctrl+中键回 fit

- **来源**：人工端到端验收轮的用户 2026-11-04 修正指令（同一轮的 ghost/滑杆两项是缺陷修复，
  不进本表，见 PLAN §10.1 与 changelog 同期条目）。
- **V4**：fit 从「仅适配宽」改为**整页适配**（`min(w/h)`，保比例，打开默认 fit），ResizeObserver
  re-fit 同时盯宽高。V4 作废 P1 时代语义。
- **V5**：`#preview-stage` `overflow: hidden`（无滚动条）+ 平移走程序化偏移（Space+方向键 /
  Space+左键拖动 / 滚轮）；原生 clamp = 「页四边不超出容器四边」。§6 段新增无滚动条说明。
- **V6**：Ctrl+鼠标中键 = 回 fit（capture `pointerdown` + `preventDefault` 吃掉 autoscroll）。
- **§5 快捷键表**新增「Space + 方向键 / Space + 左键拖动 / 滚轮」与「Ctrl + 鼠标中键」两行。
- **§4 增 2 键**（268 → 270：`view.pan.hint`、`view.fit.hint`；`app-shell.js` 的快捷键表行）。
- **§7.1**：预览接口补 `panStage(dx,dy)` 与 `probe('pan')`；叠加层 `instancePixels` 注明实例
  画布是不挂 DOM 的 probe 背板（ghost 修复）。

## 2026-11-04 — §8 新增 HD5/HD6/HD7：顶栏去文本 + 启动页装载入口精简 + 左列出血

- **来源**：不是 ask 轮次，而是用户 2026-11-04 对话里的三条指令 → §8 新增 HD5（顶栏不要文本、
  按钮怎么排）、HD6（启动页装载入口形态）、HD7（左列预览要不要内缩）三行。HD5 作废 HD2 的
  「顶栏文本承载」半边（`#top-file` 删除，窗口标题仍在），表后段落写明这一点；HD1/HD3/HD4 沿用。
- **§6 ui-ids**：删 4 个 id —— `top-file`、`empty-upload`、`empty-open`、`file-input`，
  93 → **89**。§6 段落重写：顶栏**没有任何文本**，左簇 = 打开 + 保存相邻贴左缘，右簇 =
  语言 → 主题 → 快捷键（**快捷键最右**，在明暗切档右侧），全部图标 + `data-i18n-title`；
  版本 + 打开后的文件名只写在窗口标题（原生 `windowTitle` 与 `document.title` 同一个串）；
  `#app-main` 不带版式属性（HD3）、左列的 `#preview` 无内边距无圆角（HD7）。
- **§4 i18n**：删 `empty.open.btn`、`empty.upload.btn` 两键（270 → **268**），`empty.pick.btn`
  改成 Open file / 打开文件（「选择文件」→「打开文件」）；`top.file.hint` **保留**（仍用于
  `#save-source` / `#confirm-path` 的路径提示）。
- **驱动面**：不变。`probe('version')` 仍是纯版本串、`probe('docTitle')` 仍读窗口/标签页标题；
  没有新 probe、新字段、新路由；12 态状态机与深链不变。
- **同步**：前端 `web/static/{index.html,style.css,app-shell.js,app-api.js,app-i18n.js}`
  （`setDocTitle()`、`#empty-path` 的 `keydown` Enter → `openByPath`、删隐藏 `<input id="file-input">`
  及其 change 监听、删 `.file-chip`、左列出血）；`docs/ui/mockup.html` 镜像同一契约（删那 4 个元素
  与监听 + `.file-chip` 规则、`#empty-pick` = Open file / 打开文件、`#empty-path` Enter、HD7 出血、
  顶栏无文本节点）；`tools/verify/{ui-contract,shell-smoke,preview-smoke,overlay-smoke}.mjs`
  （89 id + 268 键三方一致、「删件 id 未复活」守卫、顶栏图标几何 + 「顶栏无文本」计数、
  真 UI 打开通道改走 `#empty-path` 回车）；AGENTS §5.24–§5.26 + §11、`PROJECT_MAP`、
  `IMPLEMENTATION_PLAN` §10.1、README 功能表。

## 2026-11-04 — §8 新增 HD4：显示版本 = `0.1-dev`（Go 伪版本不再进 UI）

- **来源**：用户 2026-11-04 对话指令「版本为 0.1-dev」→ §8 新增 HD4 行（选项：沿用 Go 伪版本 /
  固定 dev 横幅；已确认 = 固定 dev 横幅，取值 `0.1-dev`）。
- **影响面**：当时四处同源的版本串（原生窗口标题栏 `AutoStamp 0.1-dev`、浏览器标签页 `document.title`、
  顶栏 `#top-file`、`GET /api/health` 的 `version`；`#top-file` 已于同日 HD5 删除，现为三处同源）此前显示 Go 工具链给未打标签提交打的伪版本
  `v0.0.0-20261103072915-f46b31ebafd1+dirty`，标题栏被 commit 串占满；`internal/app.pickVersion`
  只认真实标签（`v1.2.3`、`v1.2.3-rc.1` 原样），伪版本 / `devel` / `+dirty` 一律回落 `devVersion`。
  语义面（字段词表、§2、§6 id、§7 驱动接口）无改动；mock 的 `S.version` / `<title>` / `#top-file`
  占位改 `0.1-dev`（`#top-file` 那份同日随 HD5 删除）。门槛：`internal/app/version_test.go` 的版本取值表 + `shell-smoke` 的动态比对。

## 2026-11-03 — 顶栏收尾（HD1/HD2/HD3）：§2 删 `ui.density`、§4 删 12 键、§6 删 6 个契约 id、§7 去 `setDensity`

- **来源**：不是 ask 轮次，而是用户在 2026-11-03 对话里直接下的顶栏指令 → §8 新增 HD1（顶栏精简 +
  图标化：删品牌文字 / 最近入口 / 顶栏上传 / 导出设置入口 / 密度切档 / 版本 chip，余下控件用内嵌 SVG +
  `data-i18n-title` tooltip，打开左对齐、保存 + 快捷键 + 语言 + 主题右对齐）、HD2（`#top-file` = 窗口标题
  文本：无文档 = `AutoStamp <版本>`，打开后追加 ` 文件名`；版本串写进原生窗口标题栏与浏览器标签页，
  不新增控件）、HD3（版式固定 two-col）三行。（HD2 的「顶栏承载文本」半边 2026-11-04 随 HD5 撤掉。）
- **作废**：L1（布局密度三档切档）与 RF1（最近文件 UI 入口）在原「已确认」格子里追加作废注记 ——
  版式只剩 two-col、两个最近入口都删、`config.recentFiles` 后端继续记录但不再展示；表后段落写明
  HD1/HD2/HD3 作废的是可见形态，字段/路由不变。
- **契约面删除**：§2 的 `field=ui.density …` 行；§3 的「最近文件 · 入口」行，「顶栏 · 语言/主题/密度」
  改成「顶栏 · 语言/主题」；§6 ui-ids 的 `btn-export`、`btn-upload`、`density-seg`、`empty-recent`、
  `recent-menu`、`recent-open`（`app-logo`/`app-title`/`app-version`/`recent-clear` 本来就不在契约表里，
  只是 mock/壳里的元素，删元素即无需登记）。§6 另补 `#top-file` 语义注记（窗口标题文本 + `title` 属性 =
  完整路径 · 体积）与「`#app-main` 不再带版式属性」（`#top-file` 与那条注记已在 2026-11-04 随 HD5 撤掉，见上面第一条）。
- **i18n**：§4 删 12 键（`density.twoCol/singleCol/collapsed`、`ui.density.ctl/hint`、`recent.title/open/
  clear/empty`、`app.export.btn`、`app.title`、`app.upload.btn` —— 最后一个是顶栏上传删除后的死键，
  三处都没使用者），`lang.cn`/`lang.en` 的 en/cn 统一成 `中` / `EN`（与分段按钮文本一致，免得 i18n 覆盖
  断言把「按钮文字 vs 目录值」判成 mismatch）。总数 282 → 270。
- **驱动面**：§7 与 §7.1 的 `setDensity(d)` 删除；§7.1 `probe` 去 `density`、加 `docTitle`，`version`
  改为返回纯版本串（health 的值），`i18nPairs()` 多一种 kind `title`（来自 `[data-i18n-title]`）。
  深链 `/#<state>` 与 12 态状态机不变。
- 同步文档：AGENTS §5.22 改写 + 新增 §5.24 顶栏契约事实 + §11 速查表（删「改最近文件」行、补
  「改 UI 契约 / 参数词表」相关文件列）、`IMPLEMENTATION_PLAN` §10.1 登记本轮、`PROJECT_MAP`
  （app-shell / style.css / app-i18n / shell-smoke 行）、README 功能表。

## 2026-11-03 — impeccable polish：导出段不再「假失效」+ `.seg.sm` 内边距（真 UI 扫描 8→0）

- 用安装好的 impeccable skill 对真 exe 跑 `detect`（真链 http://127.0.0.1:PORT/，空文档态）得 8 条缺陷证据：
  `#crosspage-binding` 的 cramped-padding、`#panel-export` 段 5 条 `hintline`/`tag`/label 低对比（2.2:1/4.0:1）。
- **根因（本地缺陷，不新增决策）**：`html:not([data-state="export"]) #panel-export .body { opacity: .55 }`
  把「导出设置」侧栏段整段压到 55% —— 而这些字段就是保存/预估的输入（`exportDpiOf/exportQualityOf` + E1 预估行），
  平时必须能操作。视觉「淡化」与可操作矛盾（误导状态）且文字对比降到 2.2:1（WCAG 不适用豁免）。
  修复 = **删掉该淡化规则**（真 style.css 与 mock 同步删）；状态本身由导出弹窗表达，不需要整段变暗。
  真值探针（CDP getComputedStyle）确认淡化链只有 `.body@op0.55` 一处，其余 `opacity` 仅剩 `.btn:disabled`（disabled 豁免合法）。
- `.seg.sm` 内边距 3px→8px（cramped-padding 缺陷：分段控件文字贴容器边框）；真/动 mock 同步。
- 复扫同一真链 = 0 findings；full verify 链（`build.ps1 -Task verify`）重跑全绿（失败 0 / 跳过 0）。


## 2026-11-03 — 粘贴/拖拽装载契约（PD1/PD2）：§4 load.* + §6 drop-hint + §7.1 `load` 读数

- §8 决策表新增 PD1（剪贴板装载语义）与 PD2（鼠标拖拽装载）两行，确认来源 = 用户任务明确请求（2026-11-03）：
  只接受「单个 PDF」或「单张/复数图片」；多个 PDF、PDF+图片混拼、其它文件 → toast 告警且不装载；
  焦点在输入框且剪贴板含 `text/plain` 时放行文本粘贴（路径框语义不受劫持）。
- §4 新增 6 个 `load.*` 键（`load.paste.hint` / `load.drop.hint` / `load.reject.multi|mix|other.hint` / `load.seals.ok`），并更新 `empty.hint` 文案提到粘贴/拖入。
- §5 快捷键表新增「Ctrl+V / 拖入窗口」行；§6 契约 id 新增 `drop-hint`（预览区拖拽反馈 `#drop-hint` + `#preview[data-drag]`）；§7.1 壳 probe 关键字新增 `load`（`loadLog = {kind, reason, names, count}`）。
- 全部是前端装载 gate（`app-shell.js` 的 `submitFiles`/`classifyLoad`/窗口级 paste/drag 处理），无新路由、无新字段；AGENTS §5.23 记录同一决策。

## 2026-11-02 — P6 决策表补齐（PR/BR/BM/RF 22 行）+ §2/§3/§4 加预设与批处理

- **P6 决策表补齐**：此前 §8 从来没有 P6 的用户确认记录，只有 `IMPLEMENTATION_PLAN` 里的
  「待确认」清单（W9）。本轮按 P6 交互协议用 `ask` 提问，得到答复：批处理改成**前端跑链**
  （BM1-BM4 取代已作废的 BC1-BC4）、报表导出格式（BR7 = 前端生成 CSV/JSON，不发请求）、
  其余（并发数、跳过加密件、预设同名覆盖、载入预设、最近文件入口）按推荐默认确认。
- **诚实修正**：BC1-BC4 曾被写成「已实现」，但仓库里从未有 `internal/batch`；本轮按真实代码
  重写（无后端作业路由、无 SSE）。BM2 的输出命名后来因 `fsx` 的目标校验只认 `.pdf` 单扩展，
  定成 `_batch\<原名>.dpi<N>.q<Q>.pdf`。
- §2 新增：`api.fs.pick.dir`、`api.save.mkdirs`、`api.batch.presetName/dpi/customDpi/quality/concurrency`；
  §3 新增「印章预设库」5 行 + `#batch-*` 卡控件；§4 新增 `seal.preset.*`、`api.batch.*.ctl/.hint`、
  `ok.batch.*`、`batch.report.*`、`batch.export.*`、`batch.status.encrypted`、`batch.empty/noPreset/
  fileFail/started/stopped` 等键（en/cn）；§6 加 S6（预设）/S7（批处理）状态机行；
  §9 词表补 `pages`/实例字段/`sealId`/`spec` 等遗漏项。

## 2026-11-02 — P5 决策 W5/W6 + §4 加两键 + mock 镜像

- §8 决策表加 **W5**（光栅化何时触发：保存时自动，不加新控件；`mode=vector` 不发请求）与
  **W6**（90 MB/页：前端按体积预估提交前拦截 + 服务端硬限 400 `page_too_large`），
  来源 = 第 5 轮 `ask`（2026-11-02），轮次说明同步登记。
- W5 行追加实现决定(2026-11-02):同一份 raster 参数第二次保存**不再**光栅化(复用已光栅化
  asset),只有 `dpi/质量/pages` 变了才重光栅化一次 —— 不新增控件、不改字段词表。
- §4 加 `ok.exported`（带 `%d` 占位）与 `warn.export.tooBig`，键数 198 → **208**
  （`gen-i18n.mjs` 重生成 `app-i18n.js`）。
- `docs/ui/mockup.html` 同步镜像：导出段 `warn.export.tooBig` 的 note 上屏 +
  `#save-confirm` 里的 W5/W6 链（`ok.exported`、`warn.export.tooBig` toast）——
  只改 §4 不上 mock 会被 `ui-contract` 判 `E-I18N-UNUSED`（本轮实测踩到）。

## 2026-10-30 — P2 接线：§2.2 词表补全 / §4 加 2 键 / §6 修 fence / §7.1 探针表 / §8 C1+V3 / §11 令牌记录

- §2.2 补 P2 用到的词表行：`seal.prepare.despill/alphaTrim/resampleDpi`（含默认值与
  「撤销去背」语义）、`seal.err.type` / `seal.err.nosource`（toast 文案）、
  `ui.split.mode` / `ui.split.veto`（逐页否决，切点预览在页框上画）。
- §4 加两行（`seal.err.type`、`seal.err.nosource`）；`stamp.drag.hint` 在 mock 与真实面板
  都上屏（此前只登记不显示，`ui-contract` 判「§4 键未在 mock 使用」而失败）。
  重新生成目录：196 键（**唯一来源仍是 §4 表**；`gen-i18n.mjs` 读 mock 的内嵌字典，
  两者由 `ui-contract` 互相校验 —— 只改 §4 不上 mock 会失败）。
- §6 `ui-ids` 块**缺闭合 fence**（`ui-contract` 报 `E-SPEC: ui-ids block is empty`、
  `ids=0`）→ 补 ` ``` `；块内 78 个 id 与 `index.html` 一致（ids=82 含 4 个 JS 生成的
  动态 id 例外，见 §6 说明）。
- §7.1 探针表：壳 `probe` 补 `estimate`（导出体积预估，早已在 §7 列出但壳未实现 → 本轮实现）；
  预览 `probe` 补 `splitPreview`；叠加层 `probe` 补 `drag instancePixels selected filter affordance`
  并说明 `imageDataOf/pixelsForRect` 是供脚本算像素的纯函数。
- §8：C1 行记「P2 实测：手柄/标尺/条带都按左上原点 y 向下」；V3 行记滚轮只在光标位于
  选中实例内时生效 + 事件必须被实例吞掉（FACTS §1.8 的实测依据）。
- §11 追加校验记录：P2 的 `overlay-smoke.mjs` + `--only=` 令牌清单（同一行内列出令牌）。
## 2026-10-29 — P1 落地：预览区绑定 / 契约 id 说明 / §7 钩子 / V1-V3 决策

- §3 预览绑定表补三行：预览区（`.page-frame` → `canvas.page-canvas` + `.textLayer`，
  字节走 `GET /api/pdf/raw?id=`）、分页条（`#page-pager` 内 `button.chip[data-page]`
  含 `canvas.pg-thumb`）、标尺与像素读数（只读派生，不请求）。
- §6 之后加说明：`#preview-stage` 的页框与 `#page-pager` 的 chip 全部 JS 生成，
  **不占契约 id**（靠 `class` + `data-page`）；`#asset-hooks` / `pathGrantId` 的 chip
  只显示句柄值本身，本地化文案进 `title`/`aria-label`（动态文本与 §4 的 `applyLang()`
  「元素文本 = en 值」规则冲突）。
- §5 的 `Ctrl+滚轮` 行标出归属：P1 = 视图缩放，P2 起光标在选中实例上时 = `apply.scale`。
- §7 登记真实壳的驱动面：`__autoStampPreview`（`open`/`setPassword`/`reload`/`close`/`goTo`/
  `zoomBy`/`zoomTo`/`fit`/`pageCount`/`pageMeta`/`sample(x,y,w,h)` 按 PDF 点取样 /
  `probe` 11 个关键字）、`__autoStampTextLayer`、`__autoStampPager`，三个跨模块事件
  `autostamp:lang` / `autostamp:open` / `autostamp:page`；校验命令补 `preview-smoke.mjs`。
- §8 决策表新增 **V1 单页视图**、**V2 chip + chip 内缩略图**、**V3 滚轮归属**，
  均为 2026-10-29 ask 第 3 轮确认；因此删掉旧句「P0.5 共 2 轮收敛，未使用第 3 轮」。

## 2026-10-29 — 增 §7.1「真实壳的驱动接口」

- 登记 `window.__autoStampShell` 的驱动面（`STATES`/`setState`/`verifyState`/`setParams`/
  `fields`/`ids`/`i18nPairs`/`probe`/`applyLang`/`applyTheme`/`setDensity`/`setModal`/
  `clearToast`/`addInstance`/`selectInstance`/`deleteSelected`/`duplicateSelected`）+
  `probe` 关键字清单 + 深链 `/#<state>` + 三条校验命令（`shell-smoke`、`webview-launch`、
  `comprobe`）。
- 原因：P0 壳的运行时断言不能再依赖 `docs/ui/mockup.html`（假数据），必须直接驱动
  真实嵌入页面；`tools/verify/shell-smoke.mjs` 用的就是这套钩子。
- §7 的 mock 深链行一度被本节插入覆盖，已恢复（mock 与壳两套钩子并存）。

## 2026-10-29 — P0.5 用户确认第 1、2 轮回填（第 1 轮有语义变更）

- §8 决策表：D2–D4、L1、CP1 记为**已确认**（2026-10-29，ask 第 1 轮），D1、I1、S1、E1
  记为**已确认**（同日，ask 第 2 轮）。表尾说明改为「2 轮收敛，未使用第 3 轮」；
  B1/D5 仍按 `IMPLEMENTATION_PLAN` §9 默认登记。
- **D2 取值域变化**：`ui.crosspage.binding` 由 `right|left|alternate` 改为
  `right|alternate|none`（用户原文：「可选，1、单面仅右侧。2、双面奇偶分别左右，
  左右的是两个章分割。3、无骑缝章」）。`left` 未列入 → 从 §2 取值域、§4 词表与 mock 移除。
  新增 i18n 键 `binding.none`；`binding.right` / `binding.alternate` 文案改为
  「单面：右缘连续」/「双面：奇右偶左」。
- §2 行 `ui.crosspage.binding`：`range=right|alternate|none`；§4 `ui.crosspage.binding.hint`
  补充「选无骑缝章即清掉 `apply.crossPage`」；新增 `crosspage.binding.fixed`（自动纠正 toast）。
- §4 词表：4 个 `—` 英文标签补齐为 `Binding edge (D2)` / `Per-page strip zoom` /
  `Manual split` / `Auto-detected pages`（en 列与 mock 的 `.flabel` 文本一致）。
- §7 mock 驱动接口：补 `setDensity(d)`（`two-col` / `single-col` / `collapsed`）。

## 2026-10-28 — P0.5 初版（mock 冻结前）

- 新建 `docs/UI_SPEC.md`：§1 状态机（15 态）、§2 `ui-fields` 字段表（44 项）、
  §3 控件↔字段绑定、§4 i18n 清单、§5 快捷键、§6 `ui-ids` 契约 id、
  §7 `window.__autoStampMock` 驱动接口、§8 决策表（含 `待 P0.5 第 1 轮` 占位）、
  §9 与 AGENTS §6 的映射、§10 变更纪律。
- 配套 `docs/ui/mockup.html`（可交互 mock，不进 embed）+ `docs/ui/fixtures/`
  （由 `tools/genfix/main.go` 生成）+ `tools/verify/ui-smoke.mjs` /
  `tools/verify/ui-contract.mjs`（三方一致性）。
