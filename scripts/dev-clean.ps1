. "$PSScriptRoot\env.ps1"

$ports = 1420, 1421
foreach ($port in $ports) {
    Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}

Get-Process -Name orbita -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Start-Sleep -Seconds 1

$busy = Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue
if ($busy) {
    $pid = $busy[0].OwningProcess
    Write-Host "Port 1420 still in use by PID $pid"
    exit 1
}

Write-Host "Clean. Run orbita\dev.bat"
