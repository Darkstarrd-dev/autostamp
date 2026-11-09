<#
.SYNOPSIS
    AutoStamp 自动编译 + 测试脚本（单一入口，Windows PowerShell 5.1+）。

.DESCRIPTION
    任务：clean / vet / test / genfix / fixtures / console / webview / stripped /
    verify / sizes / run / watch / all / help。
    默认 `all`：clean -> vet -> test -> genfix -> 三个 exe -> verify -> sizes。
    根目录还没有 Go 源码时（P0 未开工）Go 任务只打 [skip]，不算失败；P0 落地后自动生效。
    退出码：0 = 无失败任务；1 = 至少一个任务失败。

.EXAMPLE
    powershell -NoProfile -File build.ps1
    powershell -NoProfile -File build.ps1 -Task webview -Run
    powershell -NoProfile -File build.ps1 -Task genfix,fixtures
    powershell -NoProfile -File build.ps1 -Watch
#>
[CmdletBinding()]
param(
    [string[]] $Task = @('all'),
    [switch] $Watch,
    [switch] $Run,
    [switch] $Once,
    [string] $GoFlags = '',
    [ValidateSet('windows', 'linux', 'darwin')]
    [string] $TargetOS = 'windows'
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$dist = Join-Path $root 'dist'
$script:fail = 0
$script:skipCount = 0

function Write-Head { param([string]$text) Write-Host ''; Write-Host ('== ' + $text) -ForegroundColor Green }
function Write-Ok { param([string]$text) Write-Host ('   ok   ' + $text) -ForegroundColor DarkGreen }
function Write-SkipMsg { param([string]$text) Write-Host ('   skip ' + $text) -ForegroundColor DarkYellow; $script:skipCount += 1 }
function Write-Bad { param([string]$text) Write-Host ('   FAIL ' + $text) -ForegroundColor Red; $script:fail += 1 }
function Write-Log { param([string]$text) if ($text) { Write-Host ('     ' + $text) } }

function Test-Tool { param([string]$name) return [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function Test-RootModule { return Test-Path (Join-Path $root 'go.mod') }
function Test-RootGo { return [bool](@(Get-ChildItem -LiteralPath $root -Filter '*.go' -File -ErrorAction SilentlyContinue)) }

function Invoke-Native {
    param([string]$file, [string[]]$argv, [string]$cwd)
    $argv = @($argv) + @($script:goExtra)
    $prev = Get-Location
    # PS5.1 下若首选项是 Stop，`2>&1` 把原生命令 stderr 并进错误流后会升级为
    # NativeCommandError 终止异常——脚本会停在 & 这一行，后续任务全部消失。
    # 原生命令成败只看 $LASTEXITCODE，故本地临时放宽为 Continue（finally 还原）。
    $prevEA = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        if ($cwd) { Set-Location $cwd }
        & $file @argv 2>&1 | ForEach-Object { Write-Log ('' + $_) }
        return $LASTEXITCODE
    } finally { Set-Location $prev; $ErrorActionPreference = $prevEA }
}

function Start-Clean {
    Write-Head 'clean'
    if (-not (Test-Path $dist)) { Write-Ok 'dist 不存在，无需清理'; return }
    $rm = @(Get-ChildItem -LiteralPath $dist -Filter '*.exe' -File -ErrorAction SilentlyContinue)
    $rm | Remove-Item -Force -ErrorAction SilentlyContinue
    Write-Ok ('清空 dist\*.exe (' + $rm.Count + ' 个)')
}

function Start-GoTask {
    param([string]$Kind)
    switch ($Kind) {
        'vet' { $argv = @('vet', './...') }
        'test' { $argv = @('test', './...') }
        default { throw "unknown go task $Kind" }
    }
    Write-Head ('go ' + $Kind)
    if (-not (Test-RootModule)) { Write-SkipMsg 'go.mod 尚不存在（P0 未开工）'; return }
    if (-not (Test-Tool 'go')) { Write-Bad 'go 未安装/不在 PATH'; return }
    $code = Invoke-Native -file 'go' -argv $argv
    if ($code -ne 0) { Write-Bad ('go ' + $Kind + ' 退出码 ' + $code) } else { Write-Ok ('go ' + $Kind) }
}

function Start-Genfix {
    Write-Head 'genfix (tools/genfix 独立模块)'
    $dir = Join-Path $root 'tools/genfix'
    if (-not (Test-Path $dir)) { Write-SkipMsg 'tools/genfix 缺失'; return }
    if (-not (Test-Tool 'go')) { Write-Bad 'go 未安装/不在 PATH'; return }
    if (-not (Test-Path $dist)) { New-Item -ItemType Directory -Path $dist | Out-Null }
    $code = Invoke-Native -file 'go' -argv @('vet', './...') -cwd $dir
    if ($code -ne 0) { Write-Bad 'go vet (tools/genfix)'; return }
    $code = Invoke-Native -file 'go' -argv @('build', '-o', (Join-Path $dist 'genfix.exe'), '.') -cwd $dir
    if ($code -ne 0) { Write-Bad 'go build (tools/genfix)'; return }
    Write-Ok 'dist\genfix.exe'
}

function Start-Fixtures {
    Write-Head 'fixtures (docs/ui/fixtures)'
    $exe = Join-Path $dist 'genfix.exe'
    if (-not (Test-Path $exe)) { Start-Genfix }
    if (-not (Test-Path $exe)) { Write-SkipMsg 'genfix.exe 不可用'; return }
    $fixturesDir = Join-Path $root 'docs\ui\fixtures'
    $code = Invoke-Native -file $exe -argv @($fixturesDir)
    if ($code -ne 0) { Write-Bad 'genfix 运行失败'; return }
    Write-Ok 'page.png / seal.png 已刷新'
}

function Start-Build {
    param([string]$Kind)
    $taglist = @()
    $strip = $false
    switch ($Kind) {
        'console' { $exe = 'autostamp.exe' }
        'webview' { $exe = 'autostamp-webview.exe'; $taglist = @('webview') }
        'stripped' { $exe = 'autostamp-webview-stripped.exe'; $taglist = @('webview'); $strip = $true }
        default { Write-SkipMsg ('未知构建目标 ' + $Kind); return }
    }
    if (-not (Test-RootGo)) { Write-SkipMsg ('build ' + $Kind + '：根目录还没有 *.go（P0 未开工）'); return }
    Write-Head ('build ' + $Kind + ' -> dist\' + $exe)
    if (-not (Test-Path $dist)) { New-Item -ItemType Directory -Path $dist | Out-Null }
    $out = Join-Path $dist $exe
    $argv = @('build', '-trimpath')
    if ($taglist.Count -gt 0) { $argv += @('-tags', ($taglist -join ',')) }
    if ($strip) { $argv += @('-ldflags', '-s -w') }
    $env:GOOS = $TargetOS
    $code = Invoke-Native -file 'go' -argv ($argv + @('-o', $out, '.'))
    if ($code -ne 0) { Write-Bad ('go build ' + $Kind); return }
    $item = Get-Item $out
    $rev = ''
    $prevEA = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'   # 2>$null 重定向在 Stop 下同样会升级报错
    & go version -m $out 2>$null | ForEach-Object { if ($_ -match 'vcs\.revision=([0-9a-f]{7,})') { $rev = $Matches[1].Substring(0, 7) } }
    $ErrorActionPreference = $prevEA
    if (-not $rev) { $rev = 'n/a' }
    Write-Ok ('{0}  {1,8:N0} KB  commit {2}' -f $item.Name, ($item.Length / 1KB), $rev)
}

function Start-Verify {
    Write-Head 'verify (tools/verify)'
    if (-not (Test-Tool 'node')) { Write-Bad 'node 未安装/不在 PATH'; return }
    # 契约/壳/查看链路/叠加预览/落盘回读/光栅导出/像素矩阵/真窗口九个脚本按 AGENTS §8 串成一条命令;
    # 前八个不需要 GUI,webview-launch 依赖 -tags webview 的 exe(由 all/`-Task webview` 先建好)。
    foreach ($s in @('ui-contract.mjs', 'ui-smoke.mjs', 'shell-smoke.mjs', 'preview-smoke.mjs', 'overlay-smoke.mjs', 'apply-smoke.mjs', 'export-smoke.mjs', 'pixel-matrix.mjs', 'webview-launch.mjs')) {
        $p = Join-Path $root ('tools\verify\' + $s)
        if (-not (Test-Path $p)) { Write-SkipMsg ('缺 tools/verify/' + $s); continue }
        $code = Invoke-Native -file 'node' -argv @($p)
        if ($code -ne 0) { Write-Bad $s } else { Write-Ok $s }
    }
}

function Start-Sizes {
    Write-Head 'sizes'
    if (-not (Test-Path $dist)) { Write-SkipMsg 'dist 不存在'; return }
    $files = @(Get-ChildItem -LiteralPath $dist -Filter '*.exe' -File -ErrorAction SilentlyContinue)
    if ($files.Count -eq 0) { Write-SkipMsg 'dist 内没有 exe（先跑 build）'; return }
    $total = 0
    foreach ($f in $files) {
        $total += $f.Length
        Write-Host ('     {0,-32} {1,8:N0} KB' -f $f.Name, ($f.Length / 1KB))
    }
    Write-Host ('     {0,-32} {1,8:N0} KB' -f 'TOTAL', ($total / 1KB)) -ForegroundColor DarkGreen
}

function Start-Run {
    Write-Head 'run'
    $appExes = @('autostamp-webview.exe', 'autostamp.exe') | ForEach-Object { Join-Path $dist $_ } | Where-Object { Test-Path $_ }
    if (-not $appExes) {
        Write-SkipMsg 'dist 内没有 autostamp*.exe（P0 未开工，窗口/控制台版还不存在）'
        if (Test-Path (Join-Path $dist 'genfix.exe')) {
            Write-Host '   提示: dist\genfix.exe 是命令行素材生成器（打印 3 行即退出）；' -ForegroundColor DarkGray
            Write-Host '         在资源管理器里双击它会看到 cmd 窗口一闪即退，这是正常行为，不是崩溃。' -ForegroundColor DarkGray
            Write-Host '         要跑应用：等 P0 落地后 build.ps1 -Task webview -Run' -ForegroundColor DarkGray
        }
        return
    }
    $exe = $appExes | Select-Object -First 1
    Write-Host ('   启动 ' + (Split-Path $exe -Leaf)) -ForegroundColor DarkGreen
    & $exe
}

function Start-Package {
    Write-Head 'package (PC1)'
    if (-not (Test-RootGo)) { Write-SkipMsg 'package：根目录还没有 go.mod/*.go'; return }
    $stripped = Join-Path $dist 'autostamp-webview-stripped.exe'
    if (-not (Test-Path $stripped)) { Start-Build 'stripped' }
    if (-not (Test-Path $stripped)) { Write-Bad 'package 需要 dist/autostamp-webview-stripped.exe'; return }
    # The zip name reuses the same VCS stamp the binary reports through
    # /api/health (AGENTS §4: 版本走 Go 的 VCS 注入，不手写 ldflags), so the
    # artifact name and the version the app prints can never drift apart.
    $rev = ''; $dirty = ''
    $prevEA = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & go version -m $stripped 2>$null | ForEach-Object {
        if ($_ -match 'vcs\.revision=([0-9a-f]{7,})') { $rev = $Matches[1].Substring(0, 7) }
        if ($_ -match 'vcs\.modified=true') { $dirty = '-dirty' }
    }
    $ErrorActionPreference = $prevEA
    if (-not $rev) { $rev = 'unknown' }
    $stage = Join-Path $dist ('pkg-' + $rev)
    if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    New-Item -ItemType Directory -Path $stage | Out-Null
    Copy-Item -LiteralPath $stripped -Destination (Join-Path $stage 'autostamp.exe')
    $readme = Join-Path $root 'README.md'
    if (Test-Path $readme) { Copy-Item -LiteralPath $readme -Destination $stage } else { Write-SkipMsg 'README.md 不在仓库根（zip 内只有 exe）' }
    $zip = Join-Path $dist ('autostamp-' + $rev + $dirty + '-win64.zip')
    if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
    Remove-Item -LiteralPath $stage -Recurse -Force
    $zitem = Get-Item $zip
    $eitem = Get-Item $stripped
    # PC1's size gate (docs/IMPLEMENTATION_PLAN.md P6 验收): the single shipped
    # exe must stay under 25 MB - a jump over that means a dependency crept in.
    if ($eitem.Length -gt 25MB) { Write-Bad ('exe 体积 {0:N0} B 超过 PC1 的 25 MB 上限' -f $eitem.Length) }
    Write-Ok ('{0}  zip {1:N0} KB  exe {2:N0} KB (上限 25 MB)' -f $zitem.Name, ($zitem.Length / 1KB), ($eitem.Length / 1KB))
}

$script:goExtra = @()
if ($GoFlags) { $script:goExtra = @($GoFlags -split '\s+' | Where-Object { $_ }) }

$q = New-Object System.Collections.Queue
$global:AUTOSTAMP_HIT = [System.Collections.Queue]::Synchronized($q)
$global:AUTOSTAMP_EXT = @('.go', '.mod', '.sum', '.mjs', '.js', '.html', '.css', '.ps1')
$global:AUTOSTAMP_SKIP = @('\.git\', '\dist\', '\tmp\', '\node_modules\', '\scratch\')

function Test-WatchedPath {
    param([string]$path)
    if (-not $path) { return $false }
    $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
    if ($global:AUTOSTAMP_EXT -notcontains $ext) { return $false }
    foreach ($s in $global:AUTOSTAMP_SKIP) { if ($path -like ('*' + $s + '*')) { return $false } }
    return $true
}

function Run-Cycle {
    param([string[]]$reason)
    Write-Host ''
    Write-Host ('--- ' + (Get-Date -Format 'HH:mm:ss') + '  触发: ' + ($reason -join ', ')) -ForegroundColor Cyan
    foreach ($k in @('vet', 'test', 'genfix', 'console', 'webview', 'verify')) { Start-Dispatch $k }
}

function Start-WatchLoop {
    Write-Head 'watch'
    $w = New-Object System.IO.FileSystemWatcher
    $w.Path = $root
    $w.IncludeSubdirectories = $true
    $w.NotifyFilter = [System.IO.NotifyFilters]'LastWrite, FileName'
    $handler = {
        $p = $Event.SourceEventArgs.FullPath
        $ext = [System.IO.Path]::GetExtension($p).ToLowerInvariant()
        if ($global:AUTOSTAMP_EXT -notcontains $ext) { return }
        foreach ($s in $global:AUTOSTAMP_SKIP) { if ($p -like ('*' + $s + '*')) { return } }
        $global:AUTOSTAMP_HIT.Enqueue($p)
    }
    Register-ObjectEvent $w Changed -Action $handler -SourceIdentifier 'autostamp-changed' | Out-Null
    Register-ObjectEvent $w Created -Action $handler -SourceIdentifier 'autostamp-created' | Out-Null
    Write-Host ('   观察 ' + $root + '  (' + ($global:AUTOSTAMP_EXT -join ' ') + ')') -ForegroundColor DarkGreen
    try {
        Run-Cycle @('(启动)')
        if ($Once) { return }
        while ($true) {
            Start-Sleep -Milliseconds 300
            if ($global:AUTOSTAMP_HIT.Count -eq 0) { continue }
            $hit = @()
            while ($global:AUTOSTAMP_HIT.Count -gt 0) { $hit += $global:AUTOSTAMP_HIT.Dequeue() }
            Start-Sleep -Milliseconds 400   # 合并连续改动（防抖）
            while ($global:AUTOSTAMP_HIT.Count -gt 0) { $hit += $global:AUTOSTAMP_HIT.Dequeue() }
            Run-Cycle $hit
        }
    } finally {
        Unregister-Event -SourceIdentifier 'autostamp-changed' -ErrorAction SilentlyContinue
        Unregister-Event -SourceIdentifier 'autostamp-created' -ErrorAction SilentlyContinue
        $w.Dispose()
    }
}

function Start-Dispatch {
    param([string]$Kind)
    switch ($Kind) {
        'all' { Start-Dispatch 'clean'; foreach ($k in @('vet', 'test', 'genfix', 'console', 'webview', 'stripped', 'verify', 'sizes')) { Start-Dispatch $k } }
        'clean' { Start-Clean }
        'vet' { Start-GoTask 'vet' }
        'test' { Start-GoTask 'test' }
        'genfix' { Start-Genfix }
        'fixtures' { Start-Fixtures }
        'console' { Start-Build 'console' }
        'webview' { Start-Build 'webview' }
        'stripped' { Start-Build 'stripped' }
        'package' { Start-Package }
        'verify' { Start-Verify }
        'sizes' { Start-Sizes }
        'run' { Start-Run }
        'watch' { Start-WatchLoop }
        'help' { Show-Usage }
    }
}

function Show-Usage {
    Write-Head 'usage'
    Write-Host @'
  任务: all | clean | vet | test | genfix | fixtures | console | webview | stripped |
        package | verify | sizes | run | watch | help
  常用组合:
    build.ps1                                  全量（clean+vet+test+genfix+3 个 exe+verify+sizes）
    build.ps1 -Task genfix,fixtures            只刷新 mock 素材
    build.ps1 -Task verify                     只跑 UI 契约/冒烟校验
    build.ps1 -Task stripped,package           编窗口版（strip）+ 打 PC1 的 win64 zip
    build.ps1 -Task webview -Run               编窗口版并直接启动
    build.ps1 -Watch                           改文件即重编 + 重跑校验（Ctrl+C 退出）
  其他参数: -GoFlags '<额外 go 参数>'  -TargetOS windows|linux|darwin  -Once（配合 -Watch：跑一轮即退）
  版本信息: 取 Go 自动注入的 VCS 戳（debug.ReadBuildInfo 的 vcs.revision），不需要手写 ldflags。
  说明: 根目录还没有 go.mod/*.go 时 Go 任务自动 skip（P0 未开工），不计入失败。
'@ -ForegroundColor DarkGray
}

$known = @('all', 'clean', 'vet', 'test', 'genfix', 'fixtures', 'console', 'webview', 'stripped', 'package', 'verify', 'sizes', 'run', 'watch', 'help')
$tasks = @($Task | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$bad = @($tasks | Where-Object { $known -notcontains $_ })
if ($bad.Count -gt 0) { Write-Bad ('未知任务: ' + ($bad -join ' ') + '；可选: ' + ($known -join ' ')); exit 1 }
if ($tasks.Count -eq 0) { $tasks = @('all') }
if ($Run) { $tasks += 'run' }
if ($Watch) { Start-Dispatch 'watch' } else { foreach ($k in $tasks) { Start-Dispatch $k } }

Write-Host ''
Write-Host ('汇总: 失败 ' + $script:fail + ' / 跳过 ' + $script:skipCount) -ForegroundColor $(if ($script:fail -gt 0) { 'Red' } else { 'DarkGreen' })
if ($script:fail -gt 0) { exit 1 }
exit 0
