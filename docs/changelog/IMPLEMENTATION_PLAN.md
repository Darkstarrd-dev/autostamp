# docs/changelog/IMPLEMENTATION_PLAN.md

> `docs/IMPLEMENTATION_PLAN.md` 的变更叙述历史（最新在上）。正文只留当前态事实。


## 2026-11-03 — 工作模式切换：§10.1 人工端到端验收 + 细节调整 + 功能细化

- 头「最后核对」登记 P0–P7 收官 + 同日 PD1/PD2 装载与 impeccable polish（commit `7d241d3`）。
- §0 新增第 9 条：全部阶段 `[x]` 后「当前阶段」规则失效，工作按 §10.1 流程走；UI 语义门槛不变。
- 新增 §10.1：不再新开 P 框；验收发现/细化项逐行登记（项/来源/状态/实测列），验收通道 =
  `build.ps1 -Task webview -Run` 真窗口或出货 zip；改动后必跑 `vet,test,verify` 且扩展 verify 断言；
  polish 可用 `.omp/skills/impeccable` 的 `detect`（修后复扫归零）。已登记 PD1/PD2 与 polish 两条
  已完成项，以及「人工端到端验收轮」待办行。
- AGENTS §0 文档清单同步指向 §10.1。

## 2026-11-03 — P7 勾 `[x]`：Origin 出货默认开、nosniff、上限清单、崩溃恢复

- P7 节重写：Origin `strictOrigin` 默认 `true`（十脚本真 UI 在默认开下仍全绿 = 同源链没断）、
  `nosniff` 全覆盖、CSP 已钉死（**原计划的「内联 hash」不需要**：无内联脚本）、
  上传/词表上限（256 MiB / 20 MiB / 90 MiB×200 页 / dpi 96..600 / quality 40..95 /
  pdfcpu 64 MB + 50 MP / `exportTimeout` 5 min）、启动 `Scavenge`、i18n 276 键。
- §10 P7 行填实测；头「最后核对」= **P0–P7 全部完成**。
- D6 已在上一行改成「已被 BR3 取代」（并发默认 2）。
- 顺带：`README.md` 重写（之前还写「尚未开始 P0，无源码可构建」；它是 zip 的出货说明）。

## 2026-11-03 — P6 勾 `[x]` + 实测回填；P6 节重写（前端跑链、未采纳项登记）

- 状态表 P6 → `[x]`（实测见 §10 行）；P6 正文重写：交付形态改成 **预设库 + RF1 入口 +
  前端跑链 + `build.ps1 -Task package`**，验收改成实测清单（22 份样本、`[22,20,1,1]`、
  产物/源文件哈希不动、CSV/JSON、exe 19,744 KB、冷启动 514 ms）。
- **未采纳项登记**（不再当待办）：预设导出 zip（不在需求 1–5、无确认记录）、`rsrc` 图标 exe
  （要引外部工具）、页眉页脚 / 多印章独立通道（OP1；多印章 = P2 多实例已覆盖）。
- §9 的 **D6 改成「已被 BR3 取代」**：并发默认 2（1..8 可调），失败不中断仍是队列语义。
- 头部「最后核对」= 2026-11-03，当前阶段 = P7。

## 2026-11-02 — P5 勾 `[x]` + 实测（验收的 ±5% 改成 ±40% 量级）

- §10 的 P5 行填实测：`bytesPerPage` 141,139/143,019 B、导出文件 285,313 B、
  页 pt Δ 0.000、回读 Δ (1,-1,0)、vector 零请求、W6 拦截、`export-smoke` 进 verify 链。
- P5 正文「关键实现」写实：前端按 `scale=dpi/72` 渲染回传、JPEG 直传不重编码、
  `ptString` 不加旋转量；vector 子集走 `api.Trim`（`api.ExtractPagesFile` 只产每页
  单页文件，产不出一个子集资产 —— 这是实测出来的偏离）。
- 「验收」的 ±5% 划掉并写清为什么钉不住；`300dpi + q92 单页 ≤ 500 KB` 那条仍 `UNVERIFIED`。
- 顶部「最后核对」：当前阶段 = P6（预设/批处理/打包）。
- P5 正文补「保存幂等」与验收一条:二次保存 export 请求 0 次、改参数后恰好 1 次 + 新 asset。

## 2026-11-02 — P4 勾 `[x]`，P3 补骑缝落盘后勾 `[x]`

- §10 的 P4 行填实测（apply/save 两路由、回读矩阵 48 组最大 Δ = 2、落盘几何实测数字、
  保存链与撤销断言、顺带修掉前端快照身份 bug → FACTS §1.9）。
- §10 的 P3 行改 `[x]`：2026-10-29 只有切分半边，2026-11-02 补骑缝落盘
  （`apply-smoke --only=strip`：逐页半枚色 Δ 0、条带 bbox 四边 ≤1 pt）。
- P3 正文：「待办（与 P4 同批）」换成真实形态说明（骑缝预览在 `app-overlay.js`、
  词表接线在 `app-shell.js`，**没有** `app-crosspage.js` 这个文件）；验收三行全部打勾。
- P4 正文加 engine.go 的**偏离说明**：不写第二套服务端状态机；链的状态由 `tmpstore`
  资产 + 前端路由表达，失败回滚 = 每条路由先写完/验完再注册 + 删临时文件。
- 验收命令写实：`node tools/verify/apply-smoke.mjs`（分段 `--only=`）+
  `powershell -NoProfile -File build.ps1 -Task vet,test,verify` → 失败 0 / 跳过 0。

## 2026-10-30 — P2 勾 `[x]` + 实测数据回填（前端半边补齐）

- §10 的 P2 行改 `[x]`：上一轮缺的前端半边（`app-seal.js` 上传/去背/撤销、
  `app-overlay.js` 合成 + affordance、`app-shell.js` 实例↔印章通道、
  骑缝条带预览、`app-preview.js` 的 `state.snapshot` 与切切点预览）本轮补齐。
- P2 正文加「实测（2026-10-30）」小节：16 模式 ×{1.0,0.6,0.3} 全部 absdiff≤1 且
  参考点 == FACTS §1.3；alpha=89 样本落在 `dst*(1-a)+premul*a`；条带（宽 = 页宽 10%、
  `startOffset` 误差 0、`alternate` 条带数 == 页数、逐页列对齐 ≤1 px）；几何
  （四角→`scale`、拖拽→`offset`、旋转手柄→`rotation`、滚轮→V3）；filter 读数 `none`；
  体积预估 == FACTS §4（含 vector 忽略 DPI/质量）；seal meta 计数。
- 验收命令写实：`node tools/verify/overlay-smoke.mjs`（分段 `--only=`）+
  `powershell -NoProfile -File build.ps1 -Task vet,test,verify` → 失败 0 / 跳过 0。
- 顺带修一处真错：`build.ps1` 的 verify 任务列表**缺 `overlay-smoke.mjs` 与
  `pixel-matrix.mjs`**（所以「失败 0」不含 P2 验收脚本，绿灯是假的）→ 已加进列表，
  重跑仍是 失败 0 / 跳过 0。
## 2026-10-29 — P2 状态纠正 + P3 切分后端绿

- **纠正**：§10 的 P2 行先前写成「前端 overlay/探针已 10/10」是错的——仓库里没有
  `web/static/app-overlay.js`，没有 `overlay-geometry.mjs`，`app-shell.js` 里没有
  `data-tune/anchor`。P2 改回 `[ ]`，只记**后端半边**（seal/prepare、seal/raw、`doc`
  字段、`sealimg.go`、`pixel-matrix.mjs` 重跑 §1.3/§1.4）。前端是 P2 的未完成部分。
- P3 行回填：后端切分词表 + `POST /api/pdf/split` 已绿（A4→297.5x842、
  `/Rotate 90`→421x595、原资产保留），永久断言在 `pdfcore/split_test.go` 与
  `api/split_test.go`；骑缝章落盘 + bbox/拼回像素验收留到 P4。
- P3 小节改成「已实测的半边 + 待办（与 P4 同批）」；自动启发式从 `UNVERIFIED` 改为实测
  （`w>h` 且 `w/h>0.7` → 判 2 拼），真实扫描样本仍 `UNVERIFIED`。
## 2026-10-29 — P1 完成：勾状态 + 回填实测数据

- §10 的 P1 行勾 `[x]` + 回填实测摘要（四类样本 / fit 1.671→2.309 / 文本层 spans
  3·24·1·0 / `raw` 会话边界 400·200·206 / `build.ps1 -Task all` 失败 0），
  P1 小节标题同时标 `[x]`。
- P1 交付清单更正为**实际落地名**：`app-preview.js`（懒 `import()` + `sample()` 探针）、
  `app-textlayer.js`、`app-pager.js`（分页 chip + **chip 内缩略图**，取代早期计划的
  `app-thumbs.js` 独立侧栏，见 `UI_SPEC §8` V2）、`internal/api/pdf.go`、
  `internal/webx/session.go`、`internal/fsx/pick*.go`、`internal/pdfcore/read.go`。
- 验收要求从「三类样本」扩成四类（英文多页文字 / 中文 CID / 混合型 / 图片型无文字），
  并在 P1 小节新增「P1 实测」块：样本由 CDP `Page.printToPDF` 现场生成（54,763 /
  186,950 / 23,935 / 46,043 B，不落仓库）、真 UI 通道（`#empty-path` + `#empty-open`）、
  会话令牌 + Range 的具体返回值、vendor `SHA256.txt` 206 项（README 改动后要重生成清单）。
- 顶部「最后核对」改为「P0 + P0.5 + P1 完成；当前阶段 = P2」。

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
