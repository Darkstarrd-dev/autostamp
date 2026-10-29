# AGENTS.md

> `AGENTS.md` 的变更叙述历史（最新在上）。正文只留当前态事实。

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
