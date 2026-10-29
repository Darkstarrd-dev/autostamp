# docs/changelog/FACTS.md

> `docs/FACTS.md` 的变更叙述历史（最新在上）。正文只留当前态事实。


## 2026-10-29 — P2 印章通道：探针目录事实纠正 + §1.3/§1.4 重跑

- §5 探针目录那条改成「已入库」：仓库里 `tools/verify/csp.mjs`、`probe.mjs` 都在
  （早前会话记的「已删除」是未提交状态下的记忆错误，本次实测纠正）。§7.1 的
  CSP 未验证项随之闭合：`web/embed.go` 的 CSP 已带 `'unsafe-inline'` + `data:`，
  并有 `web/embed_test.go` 断言。
- §1.3 加重跑记录（`tools/verify/pixel-matrix.mjs --only=matrix`，应用的页面内跑，
  底 `#d9e6ff` 叠实心 `#c8181c`）：`multiply`×1.0 → (170,22,28) 与旧记录一致；
  canvas `globalAlpha=0.6` → (189,105,119)，绿通道比 PDF `/ca 0.6` 那条少 1/255。
  **推论用于 P4**：「预览 == 落盘再渲染」的回读断言只能取 ≤1 容差，不能要求逐字节等。
- §1.4 加第二条：污染数值跟绘制路径走（旧 (54,33,25) 出自已删除探针的 `drawImage`
  路径；本次实心 `fillRect`+`multiply` 路径重跑得 (100,66,75)，复位后回 (170,22,28)）。
  回归用例断言的是机制，不是具体数值。
- §1.2 补：模式名有效性必须靠读回 `globalCompositeOperation` 验（非法名 canvas
  静默保留旧 gco，等于没混合）；`lighten`/`saturation` 与这块底组合时按数学就
  不该改变像素 —— 「叠图必须变」不能当 16 模式的通用断言，`difference` 才行。

## 2026-10-29 — P1 实测：新增 §1.7，§5.1 补探针，§6 消一项

- 新增 §1.7（P1 查看链路，`tools/verify/preview-smoke.mjs`）：pdf.js 必须用 `httpHeaders`
  带 `X-AutoStamp-Session`（缺则 `/api/pdf/raw` 回 400 `bad_session`）；`PDFDocumentProxy`
  **没有** `destroy()`，销毁句柄是 `getDocument` 返回的 task；同一 `PageProxy` 同时只允许
  一个 render（并发会被取消 → 缩略图只能串行）；文本层要按 `OutputScale.pixelRatio`
  构建才有 drift 0；`display:none` 的容器宽度为 0，不能据此算 fit（旧代码用 240 px 下限
  算出 0.403）；56 px 高的 chip 缩略图里文字是亚像素（ink=0），断言只能测 alpha 覆盖；
  中文 CID 样本渲染/抽取正常（spans 24）；四类样本体积。
- §5.1 增加 `preview-smoke.mjs` 行（覆盖 §1.1 §1.7）；§6 的「真实中文 CID 文本抽取质量」
  改为消项说明。
- §1.6 补一句：进程被 kill 后 WebView2 仍短暂锁定 profile 目录，`rmSync(maxRetries)`
  12×250 ms 仍可能 `EPERM` → `webview-launch.mjs` 只打 soft 警告。

## 2026-10-29 — P0 实测：CSP/静态、COM 次序、体积、探针清单

- 新增 §1.5：`style-src` 必须带 `'unsafe-inline'`（否则 CSSOM 写样式被 Chromium 拦掉，
  面板宽度/预览 transform 全废）；Chromium 会自动请求 `/favicon.ico`（已用
  `favicon.svg` + `<link rel="icon">` 消掉 404）；未注册 verb 的 `/api/...` 命中
  `GET /` → **405 纯文本**，前端必须按 `http_<status>` 上报而不是 `bad_json`。
  实测脚本 `tools/verify/shell-smoke.mjs`，`web/embed_test.go` 逐条断言 CSP 指令。
- 新增 §1.6：本机 `CoInitializeEx(…, 0x2)` 在**任意顺序**（锁线程前后）下返回
  `errno=0x1`（= `S_FALSE`，其 `Error()` 文案「Incorrect function.」是误导），
  因此窗口代码把 0x1 与 `RPC_E_CHANGED_MODE` 都当可容忍；`-tags webview` 真窗口
  实测通过（`webview-launch.mjs` 打印 `webview window opened` 且页内完成
  `/api/health` + `/api/settings`）。探针：`tools/verify/comprobe`。
- 同节补一条：进程被 kill 后 WebView2 仍会短暂锁定 profile 目录，`rmSync` 重试
  12 次仍可能 `EPERM` —— 验证脚本的清理因此只 soft 警告（目录在 `%TEMP%`）。
- 新增 §4.1（控制台 strip 6,912,512 B；WebView2 strip 7,345,152 B；未 strip
  9,782,784 / 10,464,256 B）与 §4.2（`/api/health` 返回 VCS 版本戳字段，
  前端据此确认端口上确实是本 App）。
- §5 拆成 5.1（仓库内可就地重跑的探针清单 + 与本文编号的映射）与 5.2
  （已删除的一次性历史探针：§1.1-§1.4、§2、§3、§4 的数值现不可重跑，
  P1-P5 会把断言重写进 `internal/pdfcore` 单测与 `tools/verify/`）。
- §6 未验证清单：WebView2 回退仍 `UNVERIFIED`，但注明窗口本身已在带 Runtime 的
  本机实测通过（§1.6）。
- 修正引用：`web/embed_test.go` 的注释把 CSP 事实指向 §1.6，实为 §1.5。

## 2026-10-28 — 记录 pdf.js 资产获取方式与 tarball 体积

- §3 加本机实测的获取命令（`npm pack pdfjs-dist@6.4.299` → 8,539,589 B / 554 files）；
  旧的 jsdelivr 逐文件下载同样可行，但 `npm pack` 更快更完整。
- 体积表：`build/pdf.min.mjs` 448 KB（br 118 KB）、`pdf.worker.min.mjs` 1,235 KB（br 338 KB）、
  `cmaps` 1,140 KB、`wasm` 1,507 KB、`standard_fonts` 779 KB、`image_decoders` 626 KB、
  `iccs` 15 KB；最小集（core + worker + cmaps）≈ 2.8 MB，全量 ≈ 5.98 MB。
- §5 记下「探针目录已删除」这一事实：§1-§4 的数值变成「已观测、不可就地重跑」，
  并要求 P0/P1 把探针重写进仓库后再逐节重跑（本次 5.1/5.2 拆分即该要求的开始）。

## 2026-10-19 — 首次实测（pdfcpu v0.16.3 + Chromium 151）

- §1：pdf.js 6.4.299 只有 ESM（`legacy/build/pdf.js` 等 404）；`saveDocument()` 走注释通道，
  不适用于印章语义；`ctx.filter` 泄漏复现（(54,33,25) vs 期望 (0,0,0)）；
  预览与落盘像素一致（`multiply` + `ca/CA 0.6` → (189,106,119)）。
- §2：pdfcpu `Cut` 的 outDir 必须先存在、每个输出含「原页 + 两块」；`opacity:` 写成
  `CA/ca`，透明 PNG 自动 `SMask`；`/BM` 只出现在 validate 白名单 → 混合模式需自写注入。
- §2.5 / §4：pdfcpu 净增 11.06 MB；A4 单页 JPEG 导出体积表（72/150/300 dpi × q40/75/92）。
