# AutoStamp

独立桌面 App：在 PDF 上盖印章 / 加骑缝章，带实时预览与混合模式，纯本地单二进制。

- 形态：Go 单 exe + WebView2 窗口（内嵌原生 JS 前端），监听 `127.0.0.1`，无鉴权、无云上传、无数据库。
  窗口标题栏与浏览器标签页都显示 `AutoStamp <版本>`，打开文档后追加文件名。
- 依赖：`pdfcpu`（PDF 解析/切分/合并/印章落盘）、`pdfjs-dist`（页面渲染/文本层/缩略图）、
  自写 ExtGState `/BM` 注入层与 stdlib PDF writer。

## 功能（P0–P7 全部实现）

1. 读取并显示文本型 / 图片型 / 混合型 PDF（渲染 + 文本层 + 缩略图）。
2. 叠加带透明通道的印章图片：尺寸 / 位置 / 旋转 / 明度 / 饱和度 / 透明度，实时预览；
   印章可一键去白底（despill）与透明边裁切。
3. 自动切分 2 拼扫描页（自动判定 / 行列表格 / 自定义切点 / 逐页否决），
   并给多页 PDF 加**骑缝章**（装订边右/双面交替、起始位置可调）。
4. 16 种混合模式（normal / multiply / color-dodge / …）+ 透明度，预览与落盘像素一致。
5. 保存：矢量（保留文字/矢量）或光栅（整页位图，抗篡改），可调 DPI（72/150/300/自定义）
   与 JPEG 质量（40-95），并显示导出体积预估。
6. 印章**预设库**（印章图 + 盖章参数，同名覆盖、载入即用）与**批处理**：
   选一个目录 → 队列逐文件跑「打开→(切分)→盖章→光栅导出→写盘」，
   输出 `源目录\_batch\原名.dpi<数字>.q<数字>.pdf`；加密件自动跳过，报表可导出 CSV/JSON。
7. 界面固定「左预览 + 右侧参数面板」双栏，左列预览占满整列（无内缩、无卡片边框）。顶栏**没有任何
   文本**，只有图标控件（左簇 = 打开 → 上传印章 → 最近印章下拉 → 加章模式开关 → 保存；右簇 =
   语言 / 主题 / 快捷键，快捷键在最右，悬停即见提示）；版本号与打开后的文件名只写在**窗口标题栏**
   （浏览器标签页同源）。印章参数（混合模式 / 透明度 / 明度饱和度 / 缩放 / 旋转 + 复位 / 删除）在
   选中实例右侧的**浮动面板**，印章预览在左列底部；实例只作用于放置页（不同页可盖不同章）。
   打开文档的入口 = 顶栏「打开」、启动页「打开文件」、路径框回车、拖放/粘贴（同一 gate）。

## 构建

```powershell
go build -tags webview -trimpath -ldflags "-s -w" -o dist/autostamp-webview-stripped.exe .
powershell -NoProfile -File build.ps1                 # clean+vet+test+3 个 exe+全套校验
powershell -NoProfile -File build.ps1 -Task stripped,package   # 出货 zip（exe + README）
powershell -NoProfile -File build.ps1 -Task webview -Run        # 窗口版并直接启动
```

一键脚本 `build.ps1`（PowerShell 5.1+，文件必须 UTF-8 **带 BOM**）把编译与全部
headless 数值校验串成一条命令；任一失败退出码 1。校验脚本见 `tools/verify/`
（契约、壳、查看链路、叠加预览、落盘回读、光栅导出、批处理、像素矩阵、真窗口）。

## 首次运行

在 `%APPDATA%\AutoStamp\` 生成 `settings.json`（印章/切分/导出/批处理默认值）+
`seals\`（印章预设）；临时会话资产在 `%LOCALAPPDATA%\AutoStamp\session\`
（TTL 2 小时，单文件上限 256 MiB，总量上限 2 GiB）。所有写盘都是临时文件 + rename。

## 阅读顺序

1. `AGENTS.md` — 技术栈、目录结构、HTTP 契约、编码规范、验证要求、禁止事项。
2. `docs/IMPLEMENTATION_PLAN.md` — P0–P7 阶段、验收标准、状态跟踪（§10）。
3. `docs/UI_SPEC.md` — UI 状态机、参数词表、用户确认决策表。
4. `docs/FACTS.md` — pdfcpu / pdf.js / Chromium 实测事实与体积数据。
5. `PROJECT_MAP.md` — 代码地图。
