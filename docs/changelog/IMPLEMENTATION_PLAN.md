# docs/changelog/IMPLEMENTATION_PLAN.md

> `docs/IMPLEMENTATION_PLAN.md` 的变更叙述历史（最新在上）。正文只留当前态事实。

## 2026-10-29 — P0 完成：勾状态 + 回填实测

- 阶段标题 `P0` → `[x]`；验收块下回填实测：Go 测试 46 个（`web` 4 / `api` 8 / `app` 10 /
  `config` 12 / `fsx` 5 / `tmpstore` 7 / `console` 3）；`shell-smoke` OK（真二进制 +
  headless，ids=79 / 字段=44 / 状态=12 / 非预期 console error 0）；`webview-launch` OK
  （真窗口 + 页内 `/api`）；strip 体积 6,912,512 B（控制台）/ 7,345,152 B（WebView2）。
- §10 状态跟踪 P0 行回填同一批数字；`internal/pdfcore` 明确仍未创建（P2-P5）。
- P0.5 验收下补「实测」行（`ui-contract` mock 39 / spec 44 / i18n 190 / 15 状态 /
  75 契约 id / **11** 路由；`ui-smoke` 170 键、0 error）；§10 的 P0.5 行同一并把
  原写错的「10 路由」改成 11（`ui-contract` 实际输出）。
- 头部「最后核对」改为「P0 + P0.5 完成；当前阶段 = P1」。

## 2026-10-29 — P0.5 完成并勾状态

- 阶段标题 `P0.5` 改为 `[x]`；§10 状态跟踪回填实测数据：用户确认 **2 轮**（2026-10-29），
  `ui-contract` OK（mock 39 字段 / spec 44 字段 / i18n 190 键 / 15 状态 / 75 契约 id /
  10 路由三方一致），`ui-smoke` OK（15 状态、console 0 error、无资源失败、
  1280x720 与 1440x900 无横向溢出、29 项断言）。
- §9 决策表 D1–D4 的「确认（P0.5）」列改为「已确认 2026-10-29 + `UI_SPEC` §8 行号」；
  D5/D6 标注仍按 §9 默认。D2 记录为三档（`right` / `alternate` / `none`），
  并写明 `left` 不采纳。
- `ui-smoke` 新增断言组：样式表整体解析（防括号缺失导致规则被丢）、弹窗/toast 的
  `display` 状态机、三档布局密度（single-col / collapsed / two-col 无溢出）、
  D2 三档（`none` 清 `apply.crossPage`、`right` 恢复 10 条带、勾 crossPage 时自动纠正绑定边）、
  `ui.lang` 切换面板标签、快捷键（Del / Ctrl+S / Esc / ? / 方向键 / `+`）。

## 2026-10-28 — 新增 P0.5 阶段

- 加入「P0.5 UI 契约冻结」阶段：交付 `docs/UI_SPEC.md` + `docs/ui/mockup.html` +
  `tools/verify/ui-smoke.mjs` + `tools/verify/ui-contract.mjs`；与用户的交互协议
  （先交 mock 再用 `ask` 批量提问，每轮 2–5 条，最多 3 轮，未定项标 `未评审默认`）。
- §9 追加必问项：布局密度、骑缝章预览形态、多印章实例形态、保存/替换确认方式、
  导出体积预估展示位置（结论只落 `UI_SPEC` 决策表）。
- §0 恢复协议第 8 条：当前阶段为 P0.5 时先读 `UI_SPEC` 决策表，已确认项不得重问，
  禁止把 §9 默认值当已确认或虚构用户确认。
