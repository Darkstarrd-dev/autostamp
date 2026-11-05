# docs/changelog/UI_SPEC.md

> `docs/UI_SPEC.md` 的变更叙述历史（最新在上）。正文只留当前态事实。


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
