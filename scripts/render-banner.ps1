param([string]$BrowserPath)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
if (-not $BrowserPath) {
    $BrowserPath = @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ([Environment]::GetEnvironmentVariable('ProgramFiles(x86)')) 'Microsoft\Edge\Application\msedge.exe')
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $BrowserPath) { throw 'Pass -BrowserPath with a Chromium browser executable.' }
$profilePath = Join-Path ([System.IO.Path]::GetTempPath()) ('codex-banner-' + [guid]::NewGuid().ToString('N'))
$outputPath = Join-Path $repoRoot 'assets\banner.png'
$sourceUri = [System.Uri]::new((Join-Path $repoRoot 'assets\banner.svg')).AbsoluteUri
$arguments = @(
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=1280,640',
    ('--user-data-dir="' + $profilePath + '"'),
    ('--screenshot="' + $outputPath + '"'),
    $sourceUri
)
$process = Start-Process -FilePath $BrowserPath -ArgumentList $arguments -WindowStyle Hidden -PassThru
if (-not $process.WaitForExit(30000)) {
    $process.Kill()
    throw 'Banner rendering timed out.'
}
if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $outputPath)) { throw 'Banner rendering failed.' }
Write-Output $outputPath
