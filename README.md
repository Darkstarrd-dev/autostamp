# AutoStamp

独立桌面 App：在 PDF 上盖印章 / 加骑缝章，带实时预览与混合模式，纯本地单二进制。

- 形态：Go 单 exe + WebView2 窗口（内嵌原生 JS 前端），监听 `127.0.0.1`，无鉴权、无云上传、无数据库。
- 依赖：`pdfcpu`（PDF 解析/切分/合并/印章落盘）、`pdfjs-dist`（页面渲染/文本层/缩略图）、
  自写 ExtGState `/BM` 注入层与 stdlib PDF writer。

## 功能（规划中，见 `docs/IMPLEMENTATION_PLAN.md`）

1. 读取并显示文本型 / 图片型 / 混合型 PDF（渲染 + 文本层 + 缩略图）。
2. 叠加带透明通道的印章图片，可预览并调尺寸、位置、明度、饱和度。
3. 自动切分 2 拼扫描页并给多页 PDF 加骑缝章，可预览、可设起始位置。
4. 混合模式（normal / multiply / color-dodge 等 16 种）与透明度百分比。
5. 保存 PDF，可调图片分辨率（DPI）与 JPEG 质量。

## 当前状态

仓库当前只有文档：`AGENTS.md`（约束）、`docs/IMPLEMENTATION_PLAN.md`（阶段计划）、
`docs/FACTS.md`（实测事实）。**尚未开始 P0**，无源码可构建。

## 规划中的构建命令

```powershell
go build -tags webview -o dist/autostamp-webview.exe .
go build -tags webview -trimpath -ldflags "-s -w" -o dist/autostamp-webview-stripped.exe .
go test ./...
```

## 阅读顺序

1. `AGENTS.md` — 技术栈、目录结构、HTTP 契约、编码规范、禁止事项。
2. `docs/IMPLEMENTATION_PLAN.md` — P0–P7 阶段、验收标准、风险、待定决策。
3. `docs/FACTS.md` — pdfcpu / pdf.js / Chromium 实测事实与体积数据。
