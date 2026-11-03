<#
.SYNOPSIS
    buildm.ps1 — 极限压缩出货件（m = maximal）：webview + strip 后 UPX 重打包，
    名字为 autostamp.exe（已存在则覆盖）。

.DESCRIPTION
    1) 先同 build1.ps1：go build -tags webview -trimpath -ldflags "-s -w"
       -o dist\autostamp.exe .（保证打包输入来自当前源码）
    2) UPX：默认 --ultra-brute（极限：全部方法 + 暴力穷举）。
       -Fast 改用 --best --lzma（快得多，压缩率略低）。
       upx 定位顺序：PATH → tools\upx\upx.exe → 缺失时从 GitHub releases
       自动下载 v5.0.2 win64 zip 解到 tools\upx\（tools/upx 由 .gitignore 的
       *.exe 规则屏蔽，不入库、不进 embed）。
    3) 打包后必过两道验证，任一失败退出码 1：
       upx -t 自校验；再真启动一次（-window=false -no-browser，沙箱化
       %APPDATA%/%LOCALAPPDATA%），解析 stderr 的 url= 行并请求 /api/health。
       这是 UPX×Go 组合的历史坑（打包损坏 = 出货炸）的门槛，不接受「压上了就出货」。
    注意：UPX 会剥掉 PE note/section 的原始布局，打包后 `go version -m` 读不出
    commit；版本在打包前从原始 exe 读取打印。UPX 许可证例外条款允许压缩产物
    不附源码（AGENTS §9 无关：UPX 只是构建期工具，不随 exe 出货）。
    AV 误报提示：UPX 压缩过的 exe 常被杀软按「UPX.PEX downloader」类签名拦截，
    分发渠道（邮件/下载站）需白名单或改走 build1.ps1 的未压缩版。
    退出码：0 = 成功且两道验证通过；1 = 失败。

.EXAMPLE
    powershell -NoProfile -File buildm.ps1
    powershell -NoProfile -File buildm.ps1 -Fast
#>
[CmdletBinding()]
param(
    [switch] $Fast,
    [switch] $SkipCheck,
    [string] $UpxExe = '',
    [string] $GoFlags = ''
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$dist = Join-Path $root 'dist'
$out = Join-Path $dist 'autostamp.exe'
$upxDir = Join-Path $root 'tools\upx'
$upxLocal = Join-Path $upxDir 'upx.exe'
$upxVersion = '5.0.2'

$script:goExtra = @()
if ($GoFlags) { $script:goExtra = @($GoFlags -split '\s+' | Where-Object { $_ }) }

function Write-Ok { param([string]$text) Write-Host ('   ok   ' + $text) -ForegroundColor DarkGreen }
function Write-Bad { param([string]$text) Write-Host ('   FAIL ' + $text) -ForegroundColor Red }
function Write-Log { param([string]$text) if ($text) { Write-Host ('     ' + $text) } }

function Invoke-Native {
    param([string]$file, [string[]]$argv)
    $argv = @($argv) + @($script:goExtra)
    $prevEA = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'   # 原生命令 stderr 在 Stop 下会升级为 NativeCommandError
    try {
        & $file @argv 2>&1 | ForEach-Object { Write-Log ('' + $_) }
        return $LASTEXITCODE
    } finally { $ErrorActionPreference = $prevEA }
}

# UPX 定位（参数指定 → PATH → tools\upx\upx.exe → 自动下载）。返回执行 upx 的命令路径。
function Resolve-Upx {
    if ($UpxExe) {
        $p = if ([System.IO.Path]::IsPathRooted($UpxExe)) { $UpxExe } else { Join-Path $root $UpxExe }
        if (Test-Path $p) { return $p }
        Write-Bad ('指定的 upx 不存在：' + $p); exit 1
    }
    $cmd = Get-Command upx -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    if (Test-Path $upxLocal) { return $upxLocal }
    Write-Host ('   upx 不在 PATH，也没有 ' + $upxLocal + ' -> 从 GitHub 下载 v' + $upxVersion) -ForegroundColor DarkYellow
    if (-not (Test-Path $upxDir)) { New-Item -ItemType Directory -Path $upxDir | Out-Null }
    $zip = Join-Path $env:TEMP ('upx-' + $upxVersion + '-win64.zip')
    $unzip = Join-Path $env:TEMP ('upx-' + $upxVersion + '-unzip')
    $url = 'https://github.com/upx/upx/releases/download/v' + $upxVersion + '/upx-' + $upxVersion + '-win64.zip'
    $prevEA = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip
    } finally { $ErrorActionPreference = $prevEA }
    if (-not (Test-Path $zip)) { Write-Bad ('下载失败：' + $url); exit 1 }
    if (Test-Path $unzip) { Remove-Item -LiteralPath $unzip -Recurse -Force }
    Expand-Archive -LiteralPath $zip -DestinationPath $unzip -Force
    $found = @(Get-ChildItem -LiteralPath $unzip -Filter 'upx.exe' -File -Recurse -ErrorAction SilentlyContinue)
    if ($found.Count -eq 0) { Write-Bad ('zip 里没有 upx.exe：' + $zip); exit 1 }
    Copy-Item -LiteralPath $found[0].FullName -Destination $upxLocal -Force
    Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $unzip -Recurse -Force -ErrorAction SilentlyContinue
    Write-Ok ('已安装 tools\upx\upx.exe（' + $upxVersion + '）')
    return $upxLocal
}

Write-Host ('== buildm (webview + strip + UPX ' + $(if ($Fast) { '--best --lzma' } else { '--ultra-brute' }) + ' -> ' + (Split-Path $out -Leaf) + ')') -ForegroundColor Green

if (-not (Get-Command go -ErrorAction SilentlyContinue) ) { Write-Bad 'go 未安装/不在 PATH'; exit 1 }
if (-not (Get-ChildItem -LiteralPath $root -Filter '*.go' -File -ErrorAction SilentlyContinue)) {
    Write-Bad '根目录没有 *.go（P0 未开工？）'; exit 1
}

$running = Get-Process -Name 'autostamp' -ErrorAction SilentlyContinue
if ($running) {
    Write-Bad ('autostamp.exe 正在运行（PID ' + (($running | ForEach-Object { $_.Id }) -join ', ') + '），先退出再跑本脚本')
    exit 1
}

# 1) 构建输入（同 build1）——打包的对象永远来自当前源码，不信任旧 dist 文件。
if (-not (Test-Path $dist)) { New-Item -ItemType Directory -Path $dist | Out-Null }
if (Test-Path $out) { Write-Host '   目标已存在 -> 覆盖' -ForegroundColor DarkYellow }
$code = Invoke-Native -file 'go' -argv @('build', '-tags', 'webview', '-trimpath', '-ldflags', '-s -w', '-o', $out, '.')
if ($code -ne 0) { Write-Bad ('go build 退出码 ' + $code); exit 1 }
$orig = (Get-Item $out).Length
$rev = ''
$prevEA = $ErrorActionPreference
$ErrorActionPreference = 'Continue'   # 2>$null 重定向在 Stop 下同样会升级报错
& go version -m $out 2>$null | ForEach-Object { if ($_ -match 'vcs\.revision=([0-9a-f]{7,})') { $rev = $Matches[1].Substring(0, 7) } }
$ErrorActionPreference = $prevEA
if (-not $rev) { $rev = 'n/a' }
Write-Ok ('打包前 {0:N0} KB  commit {1}' -f ($orig / 1KB), $rev)

# 2) UPX 重打包（原地覆盖）。
$upx = Resolve-Upx
if ($Fast) { $upxArgs = @('--best', '--lzma') } else { $upxArgs = @('--ultra-brute') }
  # PS 5.1 的坑：`$x = if () { @(...) }` 会把单元素数组拆成字符串，
  # 后面 `$argv + @(...)` 就退化成字符串拼接（upx 收到一个带空格的整串参数）——
  # 必须用「直接赋值」形态保住数组身份（2026-11-03 实测报错 unrecognized option）。
$tmpOut = Join-Path $dist 'autostamp.upx-tmp.exe'
$t0 = Get-Date
$code = Invoke-Native -file $upx -argv ($upxArgs + @('-q', '-o', $tmpOut, $out))
if ($code -ne 0) { Write-Bad ('upx 退出码 ' + $code + '（' + ($upxArgs -join ' ') + '）'); exit 1 }
Move-Item -LiteralPath $tmpOut -Destination $out -Force
$packSec = ((Get-Date) - $t0).TotalSeconds
$packed = (Get-Item $out).Length
Write-Ok ('打包后 {0:N0} KB  省 {1:N0}%  ({2:N1}s, upx 参数: {3})' -f ($packed / 1KB), ((1 - ($packed / $orig)) * 100), $packSec, ($upxArgs -join ' '))

if ($SkipCheck) { Write-Host '   [skip] 验证（-SkipCheck）' -ForegroundColor DarkYellow; exit 0 }

# 3a) upx -t：压缩档案自校验。
$code = Invoke-Native -file $upx -argv @('-t', '-q', $out)
if ($code -ne 0) { Write-Bad 'upx -t 自校验失败'; exit 1 }
Write-Ok 'upx -t'

# 3b) 真启动健康检查：无窗口（-window=false）+ 不开浏览器，沙箱化运行数据。
$sandbox = Join-Path $env:TEMP ('autostamp-buildm-check-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $sandbox | Out-Null
$errLog = Join-Path $sandbox 'launch.err.log'
$prevApp = $env:APPDATA; $prevLocal = $env:LOCALAPPDATA
try {
    $env:APPDATA = (Join-Path $sandbox 'Roaming')
    $env:LOCALAPPDATA = (Join-Path $sandbox 'Local')
    $p = Start-Process -FilePath $out -ArgumentList @('-window=false', '-no-browser') -RedirectStandardError $errLog -RedirectStandardOutput (Join-Path $sandbox 'launch.out.log') -PassThru -NoNewWindow
    $url = $null
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
        if (-not $p -or $p.HasExited) { break }
        $txt = if (Test-Path $errLog) { Get-Content -LiteralPath $errLog -Raw -ErrorAction SilentlyContinue } else { '' }
        if ($txt -match 'url=(http://127\.0\.0\.1:\d+)') { $url = $Matches[1]; break }
        Start-Sleep -Milliseconds 250
    }
    if (-not $url) { throw ('启动后 20s 内没有 url= 行：' + $(if (Test-Path $errLog) { Get-Content -LiteralPath $errLog -Raw } else { '(无 stderr 输出)' })) }
    $resp = Invoke-WebRequest -UseBasicParsing ($url.TrimEnd('/') + '/api/health') -TimeoutSec 5
    $json = $resp.Content | ConvertFrom-Json
    if (-not $json.ok) { throw ('/api/health 返回 ' + $resp.Content) }
    Write-Ok ('启动检查：health ok  version ' + $json.data.version + '  pid 已拉起又停掉')
}
catch {
    Write-Bad ('打包后的 exe 启动检查失败：' + $_.Exception.Message)
    exit 1
}
finally {
    if ($p -and -not $p.HasExited) { & taskkill /PID $p.Id /T /F 2>&1 | Out-Null }
    $env:APPDATA = $prevApp; $env:LOCALAPPDATA = $prevLocal
    Remove-Item -LiteralPath $sandbox -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
