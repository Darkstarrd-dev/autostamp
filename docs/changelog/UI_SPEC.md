# docs/changelog/UI_SPEC.md

> `docs/UI_SPEC.md` 的变更叙述历史（最新在上）。正文只留当前态事实。

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
