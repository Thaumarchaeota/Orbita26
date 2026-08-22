$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, "Local\OrbitaDevSession", [ref]$createdNew)
if (-not $createdNew) {
    Write-Host "[dev.bat] Another Orbita development session is already running."
    Write-Host "[dev.bat] It was not cleaned or interrupted. Use that terminal, or stop it first."
    $mutex.Dispose()
    exit 2
}
$ownsMutex = $true

$sessionChild = $null

function Stop-SessionChildTree {
    param([System.Diagnostics.Process]$Process)
    if ($null -eq $Process) { return }
    try {
        if (-not $Process.HasExited) {
            # Only this wrapper's npm root and descendants are eligible. Do not
            # broaden dev-clean to arbitrary Cargo/Node processes from another session.
            & taskkill.exe /PID $Process.Id /T /F 2>$null | Out-Null
            $Process.WaitForExit(5000) | Out-Null
        }
    }
    catch {
        # The child can win the exit race; cleanup stays scoped even then.
    }
    finally {
        $Process.Dispose()
    }
}

function Start-SessionChild {
    param([string]$WorkingDirectory)

    # vcvars can expose Path/PATH as duplicate case-insensitive keys. Windows
    # PowerShell's EnvironmentVariables getter then returns null, so do not use
    # Start-Process (which enumerates it) or assign a custom environment here.
    # ProcessStartInfo inherits the raw OS environment and still returns a PID.
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = (Get-Command npm.cmd -CommandType Application -ErrorAction Stop).Source
    $startInfo.Arguments = "run tauri dev"
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    return [System.Diagnostics.Process]::Start($startInfo)
}

try {
    # Resolve the toolchain only for the owner. A competing invocation must not
    # spend time running environment setup before it reports the active session.
    . "$PSScriptRoot\env.ps1"
    while ($true) {
        Write-Host "[dev.bat] Cleaning stale processes..."
        & "$PSScriptRoot\dev-clean.ps1"
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[dev.bat] Cleanup failed; no Tauri/Vite process was started."
            exit $LASTEXITCODE
        }

        $sessionChild = Start-SessionChild "$PSScriptRoot\..\orbita"
        try {
            $sessionChild.WaitForExit()
            $exitCode = $sessionChild.ExitCode
        }
        finally {
            Stop-SessionChildTree $sessionChild
            $sessionChild = $null
        }

        if ($exitCode -eq 0) {
            exit 0
        }

        Write-Host ""
        Write-Host "[dev.bat] Abnormal exit code=$exitCode; retrying in 5 seconds (Ctrl+C stops this session)."
        Start-Sleep -Seconds 5
    }
}
finally {
    Stop-SessionChildTree $sessionChild
    # The mutex owns the whole clean + Vite/Tauri lifecycle, so a second dev.bat
    # cannot kill a healthy session between its port check and Vite bind.
    if ($ownsMutex) {
        $mutex.ReleaseMutex()
    }
    $mutex.Dispose()
}
