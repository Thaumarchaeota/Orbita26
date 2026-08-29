param(
  [string]$OutDir = (Join-Path $PSScriptRoot "..\docs\plans\evidence\v0.0.17-finance-ui\phase-c"),
  [int]$CdpPort = 9333
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Write-Host "Phase C motion evidence"
Write-Host "1. Start dev with CDP: `$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=$CdpPort'; apps\desktop\dev.bat"
Write-Host "2. In Insight Finance detail DevTools console: localStorage.setItem('orbitaCdsMotionDiag','1'); location.reload()"
Write-Host "3. Run: cd apps\desktop; `$env:ORBITA_CDP_PORT=$CdpPort; node scripts/cds-motion-evidence.mjs"
Write-Host ""

if (-not (Get-Process orbita -ErrorAction SilentlyContinue)) {
  Write-Host "orbita.exe not running; harness-only fallback will be used by cds-motion-evidence.mjs"
}

Push-Location (Join-Path $PSScriptRoot "..\apps\desktop")
try {
  $env:ORBITA_CDP_PORT = "$CdpPort"
  node scripts/cds-motion-evidence.mjs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
  Pop-Location
}

$json = Join-Path $OutDir "motion-events.json"
if (Test-Path $json) {
  Write-Host "Evidence written: $json"
  Get-Content $json
}
