# AGENTS.md

> `AGENTS.md` 的变更叙述历史（最新在上）。正文只留当前态事实。

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
