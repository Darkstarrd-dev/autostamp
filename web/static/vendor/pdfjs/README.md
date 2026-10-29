# vendor/pdfjs — 第三方前端资产（不要手改）

|项|值|
|---|---|
|来源|`pdfjs-dist@6.4.299`（npm tarball `pdfjs-dist-6.4.299.tgz` = 8,539,589 B / 554 files）|
|许可证|Apache-2.0（见 `LICENSE`，附 jbig2/openjpeg/qcms 的子许可在 `wasm/LICENSE_*`）|
|获取方式|`npm pack pdfjs-dist@6.4.299` + `tar -xzf`（本机 2026-10-28 实测，见 `docs/FACTS.md` §3）|
|导入日期|2026-10-29（P1）|
|校验|`SHA256.txt`（本目录相对路径，204 个文件；Go 侧断言 `web/embed_test.go:TestVendorChecksums`）|

## 本目录的裁剪状态

保留：

|目录/文件|体积|用途|
|`build/pdf.min.mjs`|469 KB|pdf.js 核心（只有 ESM，无 UMD，FACTS §1.1）|
|`build/pdf.worker.min.mjs`|1.24 MB|worker（`GlobalWorkerOptions.workerSrc`）|
|`cmaps/`（167 文件）|1.17 MB|CJK 字符映射（中文 CID 显示必需，`cMapUrl`）|
|`standard_fonts/`（18 文件）|798 KB|PDF 标准字体替代（`standardFontDataUrl`）|
|`wasm/`|1.54 MB|`jbig2`/`openjpeg`/`qcms`/`quickjs-eval` + fallback js + 子许可（`wasmUrl`）|
|`image_decoders/pdf.image_decoders.min.mjs`|60 KB|JPX/JPEG2000 等解码（pdf.js 6 把解码器拆到 worker 侧）|
|`iccs/`|15 KB|ICC 色彩配置|
|`web/pdf_viewer.css`|169 KB|官方 viewer 样式；本项目只用其 `.textLayer` 规则（文本层可选中/可搜索），其余规则不匹配本项目 DOM|
|合计|**5,486,850 B / 205 files**|（对比：tarball 全量解压 ≈ 34.9 MB，含 `src/`、`legacy/`、`web/`、`types/`、`*.map`）|

未 vendor（刻意排除，P6 若需要再取）：

- `build/pdf.mjs`、`pdf.sandbox.*`（表单/shader 沙箱，本项目不用）、`*.map`（调试映射）
- `legacy/`（旧浏览器构建）、`web/pdf_viewer.mjs`（官方 viewer 组件，本项目自己写渲染与文本层，见 FACTS §1.1）——但 `web/pdf_viewer.css` 已 vendor（文本层 CSS 依赖 `--total-scale-factor` 等官方令牌，手抄会漂移）
- `src/`、`types/`、`image_decoders/*.mjs`（未 min 版）、`CODE_OF_CONDUCT.md`、`package.json`、`webpack.mjs`

## 校验方式

`SHA256.txt` 由 `sha256sum` 生成。本机注意：**Git Bash 的 `sha256sum` 0.8.0（msys64）对
二进制文件做 `-c` 校验会误报 FAILED**（对同一文件直接 hash 是正确的）。因此校验以
PowerShell 为准：

```powershell
Get-FileHash -Algorithm SHA256 .\wasm\jbig2.wasm   # 与 SHA256.txt 比对
```

Go 测试（`go test ./web`）用 `crypto/sha256` 独立复核整份清单，不受上面的工具缺陷影响。

## 升级流程

1. `npm pack pdfjs-dist@<新版本>` → 解包 → 按上表**逐项**覆盖；
2. 重新生成 `SHA256.txt`（`find . -type f ! -name SHA256.txt ! -name README.md -exec sha256sum {} +`）；
3. 更新 `docs/FACTS.md` §1.1/§3（版本、体积、`UNVERIFIED` 状态）与 `docs/IMPLEMENTATION_PLAN.md` §10；
4. 跑 `node tools/verify/shell-smoke.mjs`（断言无 404 / 0 console error）与 PDF 样本渲染
   （`node tools/verify/pdf-samples.mjs`）。
