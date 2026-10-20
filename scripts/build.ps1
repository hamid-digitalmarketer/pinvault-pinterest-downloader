<#
.SYNOPSIS
  PinVault production build script.

.DESCRIPTION
  1. Runs Node validation (manifest contract, required files, JS syntax, tests).
  2. Stages the loadable extension files into dist\_staging.
  3. Produces dist\pinvault-pinterest-downloader-1.0.0.zip.

  Requirements: Node.js >= 16 on PATH, PowerShell 5.1+.
  Usage: powershell -ExecutionPolicy Bypass -File scripts\build.ps1
#>
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Dist = Join-Path $Root 'dist'
$Staging = Join-Path $Dist '_staging'
$Version = '1.0.0'
$ZipName = "pinvault-pinterest-downloader-$Version.zip"
$ZipPath = Join-Path $Dist $ZipName

Write-Host "== PinVault build $Version ==" -ForegroundColor Cyan
Write-Host "Root: $Root"

# 1. Node validation gate
Write-Host "`n[1/3] Node validation..." -ForegroundColor Yellow
$node = (Get-Command node -ErrorAction Stop).Source
& $node (Join-Path $Root 'scripts\validate-build.js')
if ($LASTEXITCODE -ne 0) {
  Write-Host "Validation failed. Aborting build." -ForegroundColor Red
  exit 1
}

# 2. Stage loadable files
Write-Host "`n[2/3] Staging loadable extension files..." -ForegroundColor Yellow
if (Test-Path $Staging) { Remove-Item -Recurse -Force $Staging }
New-Item -ItemType Directory -Path $Staging | Out-Null

$loadable = @(
  'manifest.json',
  'background',
  'content',
  'popup',
  'dashboard',
  'lib',
  'icons'
)
foreach ($item in $loadable) {
  $src = Join-Path $Root $item
  if (-not (Test-Path $src)) { throw "Missing loadable item: $src" }
  Copy-Item -Recurse -Force $src (Join-Path $Staging $item)
}
# Never ship tests, scripts, docs, or dotfiles in the loadable zip.
Write-Host "Staged $($loadable.Count) top-level items."

# 3. Zip
Write-Host "`n[3/3] Creating $ZipName ..." -ForegroundColor Yellow
if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
Compress-Archive -Path (Join-Path $Staging '*') -DestinationPath $ZipPath -CompressionLevel Optimal
Remove-Item -Recurse -Force $Staging

$zipInfo = Get-Item $ZipPath
Write-Host "`nBuild complete: $ZipPath ($($zipInfo.Length) bytes)" -ForegroundColor Green
Write-Host "Load unpacked: chrome://extensions -> Developer mode -> Load unpacked -> choose $Root"
exit 0
