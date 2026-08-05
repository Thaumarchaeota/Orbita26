$p = Join-Path $PSScriptRoot "..\src\ui"
$c = Get-Content (Join-Path $p "theme-launcher-local.css")
$c[0..853] | Set-Content (Join-Path $p "theme-launcher-grid.css") -Encoding utf8
$c[854..1151] | Set-Content (Join-Path $p "theme-launcher-sidebar.css") -Encoding utf8
$c[1152..($c.Length - 1)] | Set-Content (Join-Path $p "theme-launcher-dialogs.css") -Encoding utf8
$s = Get-Content (Join-Path $p "theme-shell-ai.css")
$s[0..467] | Set-Content (Join-Path $p "theme-shell-layout.css") -Encoding utf8
$s[468..($s.Length - 1)] | Set-Content (Join-Path $p "theme-ai-panel.css") -Encoding utf8
