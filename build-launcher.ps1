$ErrorActionPreference = 'Stop'
$launcherBin = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Path $launcherBin -Force | Out-Null
$launcherOutput = Join-Path $launcherBin 'codex-profile-launcher.exe'
$launcherCompiler = @(
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $launcherCompiler) { throw 'The Windows .NET Framework 4.x compiler was not found. Enable .NET Framework 4.8 to build the launcher.' }
& $launcherCompiler /nologo /target:exe /platform:anycpu /optimize+ /r:System.Web.Extensions.dll "/out:$launcherOutput" (Join-Path $PSScriptRoot 'launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Could not compile the Codex profile launcher.' }
