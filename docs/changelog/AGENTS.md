# AGENTS.md

> `AGENTS.md` 的变更叙述历史（最新在上）。正文只留当前态事实。

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
