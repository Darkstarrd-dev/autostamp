# AutoStamp

Local PDF stamping app: stamp seals on PDFs, cross-page (riding) seals included, with
live preview and blend modes. Single Windows executable, no installer, no network,
no cloud upload.

独立本地 PDF 印章工具：在 PDF 上盖印章（含骑缝章），实时预览 + 混合模式；
单个 Windows 可执行文件，无需安装、不联网、不上传。

---

## What it does

- Read and display any PDF: text-layer pages, scanned image pages, or mixed.
- Place a transparent PNG seal on the page and see it live: size, position, rotation,
  brightness, saturation, opacity. New seals are auto-sized to a 42 mm-wide stamp.
- Cross-page (骑缝 / riding) seals across a multi-page PDF: one seal is sliced into
  per-page strips on the binding edge (right / left / alternating), draggable vertically,
  rotate-then-slice, randomized uneven slicing that keeps a smooth per-page trend.
- 16 blend modes (`multiply`, `normal`, `color-dodge`, …) + opacity percentage; the
  preview and the saved file are pixel-identical (default = multiply).
- Save as vector (keeps text and vectors) or raster (whole-page bitmap, tamper-evident)
  with DPI (72 / 150 / 300 / custom) and JPEG quality, plus an inline size estimate
  before you commit.
- One-click "remove white background" (despill) of scan-style seal images, and transparent
  edge trimming.
- Everything stays on your machine: the app listens on `127.0.0.1` only, no auth,
  no telemetry, no database, no OCR/upload service.

## 这个 App 是做什么用的

- 读取并显示 PDF：文字型、扫描图片型、混合型都可以（页面渲染 + 文本层 + 缩略图分页条）。
- 在页面上盖透明 PNG 印章，实时预览：尺寸、位置、旋转、明度、饱和度、透明度；
  新放置的印章按 **42 mm 章宽**自动计算缩放。
- 给多页 PDF 加**骑缝章**：一枚印章切成逐页竖条贴在装订边（右缘连续 / 左缘 / 双面奇偶交替），
  纵向拖动位置、先旋转再切条、不匀切片（覆盖率 + 重掷）。
- **16 种混合模式**（正片叠底 / normal / color-dodge …）+ 透明度百分比；预览与落盘像素一致
  （默认正片叠底）。
- 保存为**矢量**（保留文字/矢量）或**光栅**（整页位图，抗篡改），可调 DPI（72/150/300/自定义）
  与 JPEG 质量，保存前显示导出体积预估。
- 一键**去白底**（扫描式淡章）与透明边裁切。
- 全程只在 `127.0.0.1` 监听，不联网、无鉴权、无遥测、无数据库、无 OCR 上传。

## Download / Run

GitHub Releases 里的 `autostamp.exe`（Windows x64，单文件，绿色版）：
download `autostamp.exe` from the GitHub Release and double-click it — a WebView2 window
opens (WebView2 runtime is part of Windows 10/11). No installer, no admin rights.

- 首次运行会在 `%APPDATA%\AutoStamp\` 生成 `settings.json` 与 `seals\`（印章预设），
  临时会话资产在 `%LOCALAPPDATA%\AutoStamp\session\`。所有写盘都是临时文件 + rename。
- 用法：顶栏「打开」/ 启动页大按钮 / 拖进来 / 粘贴 = 装载 PDF；「上传印章」或粘贴图片 =
  装载印章（只设当前印章，不自动放章）；**F1** = 加章模式（点击页面放置）、**F2** =
  骑缝章模式；**Ctrl+Enter** 盖到 PDF、**Ctrl+Z** 撤销落盘、**Ctrl+S** 保存（原生另存为对话框）。

## Built entirely by AI

本项目从设计、编码、UI、文档到数值化验证脚本，全程由 **Strata + Qwen3.8-Flash-Next-IQ3_S**
模型完成（无人类编写代码）。
This project — design, implementation, UI, documentation, and the headless numeric
verification harness — was produced end to end with the **Strata + Qwen3.8-Flash-Next-IQ3_S**
model. No hand-written code.

## License

[Unlicense](https://unlicense.org/) — public domain, do anything, see [`UNLICENSE`](UNLICENSE).
All code and documentation in this repository is dedicated to the public domain.

Third-party components shipped inside the repository and inside the released binary keep
their own licenses and are not covered by the dedication above: `web/static/vendor/pdfjs/`
(pdfjs-dist, Apache-2.0), `github.com/pdfcpu/pdfcpu` (Apache-2.0), and the bundled
standard fonts.
第三方组件（`web/static/vendor/pdfjs/`、`pdfcpu`、内置标准字体）保留各自的许可证，
不受上面的公有领域声明约束。

## Repository layout

|Path|What|
|---|---|
|`main.go` + `host_*.go`|entry point, port selection, WebView2 window / browser fallback|
|`internal/`|Go backend: config, session store, path grants, PDF core (split / seal / blend / raster / adjust), HTTP API|
|`web/static/`|native HTML + vanilla JS front end (embedded with `//go:embed`), vendored `pdfjs-dist`|
|`AGENTS.md` (root)|the project contract: stack, HTTP API, coding rules, verification requirements|
|`docs/`|`UI_SPEC.md`, `FACTS.md` (measured facts), `IMPLEMENTATION_PLAN.md`, per-doc changelogs|
|`tools/verify/`|headless-Chromium numeric verification scripts (pixel matrix, disk re-read, shell smoke)|
|`build.ps1` / `build1.ps1` / `buildm.ps1`|one-command build + full verify chain; UPX-packed single-exe output|

```powershell
go build -tags webview -trimpath -ldflags "-s -w" -o dist/autostamp.exe .
powershell -NoProfile -File build.ps1            # clean + vet + test + 3 exes + all verify tasks
```
