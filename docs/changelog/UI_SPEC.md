# docs/changelog/UI_SPEC.md

> `docs/UI_SPEC.md` 的变更叙述历史（最新在上）。正文只留当前态事实。

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
