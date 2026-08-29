. "$PSScriptRoot\env.ps1"

function Get-ListeningProcessIds([int]$Port) {
    # Get-NetTCPConnection relies on a CIM provider which can be denied even to
    # an interactive developer shell.  Do not turn that access failure into a
    # false "Clean" result: dev-session depends on this check before it starts.
    & netstat -ano -p tcp | ForEach-Object {
        $columns = ($_ -replace '^\s+', '') -split '\s+'
        if (
            $columns.Length -ge 5 -and
            $columns[0] -eq 'TCP' -and
            $columns[1] -match (":${Port}$") -and
            $columns[3] -eq 'LISTENING'
        ) {
            [int]$columns[4]
        }
    } | Select-Object -Unique
}

$ports = 1420, 1421
$ports += 8000..8010
foreach ($port in $ports) {
    Get-ListeningProcessIds $port |
        ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}

Get-Process -Name orbita -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# orbita 异常退出时 ledger sidecar 子进程可能残留（占满 8000–8010）
# A ledger uvicorn instance always listens on the managed range above.  Using
# port ownership keeps cleanup functional where the Win32_Process CIM provider
# is unavailable, while avoiding broad termination of unrelated Python work.

Start-Sleep -Seconds 1

foreach ($checkPort in $ports) {
    $busyPid = Get-ListeningProcessIds $checkPort | Select-Object -First 1
    if ($busyPid) {
        Write-Host "Port $checkPort still in use by PID $busyPid"
        exit 1
    }
}

Write-Host "Clean. Run apps\desktop\dev.bat"
