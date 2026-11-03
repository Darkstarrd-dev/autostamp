<#
.SYNOPSIS
    build1.ps1 — 只产出一个出货名单 exe：webview + strip，名字为 autostamp.exe（已存在则覆盖）。

.DESCRIPTION
    等价于：go build -tags webview -trimpath -ldflags "-s -w" -o dist\autostamp.exe .
    与 build.ps1 的 stripped 任务同一构建（AGENTS §4），区别只有输出名。
    注意：build.ps1 -Task console 也会写 dist\autostamp.exe（console 构建），
    两者互相覆盖（2026-11-03 用户决定：单 exe 出口统一用这个名字）。
    文件被运行中的进程锁住时会报「占用」并退出码 1，不静默跳过。
    退出码：0 = 成功；1 = 失败。

.EXAMPLE
    powershell -NoProfile -File build1.ps1
#>
[CmdletBinding()]
param(
    [string] $GoFlags = ''
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$dist = Join-Path $root 'dist'
$out = Join-Path $dist 'autostamp.exe'

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

Write-Host ('== build1 (webview + strip -> ' + (Split-Path $out -Leaf) + ')') -ForegroundColor Green

if (-not (Get-Command go -ErrorAction SilentlyContinue) ) { Write-Bad 'go 未安装/不在 PATH'; exit 1 }
if (-not (Get-ChildItem -LiteralPath $root -Filter '*.go' -File -ErrorAction SilentlyContinue)) {
    Write-Bad '根目录没有 *.go（P0 未开工？）'; exit 1
}

# dist\autostamp.exe 正在运行时 Windows 会锁住文件，go build 的覆盖必然失败——
# 先点名进程，给出可读提示而不是 go 的 access denied。
$running = Get-Process -Name 'autostamp' -ErrorAction SilentlyContinue
if ($running) {
    Write-Bad ('autostamp.exe 正在运行（PID ' + (($running | ForEach-Object { $_.Id }) -join ', ') + '），先退出再跑本脚本')
    exit 1
}

if (-not (Test-Path $dist)) { New-Item -ItemType Directory -Path $dist | Out-Null }
if (Test-Path $out) { Write-Host '   目标已存在 -> 覆盖' -ForegroundColor DarkYellow }

$code = Invoke-Native -file 'go' -argv @('build', '-tags', 'webview', '-trimpath', '-ldflags', '-s -w', '-o', $out, '.')
if ($code -ne 0) { Write-Bad ('go build 退出码 ' + $code); exit 1 }

$item = Get-Item $out
$rev = ''
$prevEA = $ErrorActionPreference
$ErrorActionPreference = 'Continue'   # 2>$null 重定向在 Stop 下同样会升级报错
& go version -m $out 2>$null | ForEach-Object { if ($_ -match 'vcs\.revision=([0-9a-f]{7,})') { $rev = $Matches[1].Substring(0, 7) } }
$ErrorActionPreference = $prevEA
if (-not $rev) { $rev = 'n/a' }
Write-Ok ('{0}  {1,8:N0} KB  commit {2}' -f $item.Name, ($item.Length / 1KB), $rev)
exit 0
