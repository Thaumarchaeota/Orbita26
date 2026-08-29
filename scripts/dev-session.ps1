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
$maxConsecutiveFailures = 3

if ($null -eq ("Orbita.Dev.JobNative" -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace Orbita.Dev {
  [StructLayout(LayoutKind.Sequential)]
  public struct IoCounters {
    public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
    public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct BasicLimitInformation {
    public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public long Affinity;
    public uint PriorityClass, SchedulingClass;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct ExtendedLimitInformation {
    public BasicLimitInformation BasicLimitInformation;
    public IoCounters IoInfo;
    public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
  }

  public static class JobNative {
    public const uint JobObjectExtendedLimitInformation = 9;
    public const uint JobObjectLimitKillOnJobClose = 0x00002000;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool SetInformationJobObject(IntPtr job, uint infoClass, IntPtr info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);
  }
}
'@
}

function New-SessionChildJob {
    $jobHandle = [Orbita.Dev.JobNative]::CreateJobObject([IntPtr]::Zero, $null)
    if ($jobHandle -eq [IntPtr]::Zero) {
        throw "Unable to create the Orbita development Job Object (Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error()))."
    }

    $limit = [Orbita.Dev.ExtendedLimitInformation]::new()
    $limit.BasicLimitInformation.LimitFlags = [Orbita.Dev.JobNative]::JobObjectLimitKillOnJobClose
    $size = [Runtime.InteropServices.Marshal]::SizeOf([type][Orbita.Dev.ExtendedLimitInformation])
    $buffer = [Runtime.InteropServices.Marshal]::AllocHGlobal($size)
    try {
        [Runtime.InteropServices.Marshal]::StructureToPtr($limit, $buffer, $false)
        if (-not [Orbita.Dev.JobNative]::SetInformationJobObject($jobHandle, [Orbita.Dev.JobNative]::JobObjectExtendedLimitInformation, $buffer, [uint32]$size)) {
            throw "Unable to configure the Orbita development Job Object (Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error()))."
        }
        return $jobHandle
    }
    catch {
        [Orbita.Dev.JobNative]::CloseHandle($jobHandle) | Out-Null
        throw
    }
    finally {
        [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)
    }
}

function Stop-SessionChildTree {
    param($SessionChild)
    if ($null -eq $SessionChild) { return }
    try {
        # The npm root can exit before Cargo/Vite/WebView children.  The Job owns
        # only this launch tree, so terminating it remains safe even after that
        # root PID has gone away and cannot leave a later retry with stale Node.
        if ($SessionChild.JobHandle -ne [IntPtr]::Zero) {
            [Orbita.Dev.JobNative]::TerminateJobObject($SessionChild.JobHandle, 1) | Out-Null
        }
        if ($null -ne $SessionChild.Process) {
            & taskkill.exe /PID $SessionChild.Process.Id /T /F 2>$null | Out-Null
            $SessionChild.Process.WaitForExit(5000) | Out-Null
        }
    }
    catch {
        # The child can win the exit race; cleanup stays scoped even then.
    }
    finally {
        if ($null -ne $SessionChild.Process) {
            $SessionChild.Process.Dispose()
        }
        if ($SessionChild.JobHandle -ne [IntPtr]::Zero) {
            [Orbita.Dev.JobNative]::CloseHandle($SessionChild.JobHandle) | Out-Null
        }
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
    $jobHandle = New-SessionChildJob
    $process = $null
    try {
        $process = [System.Diagnostics.Process]::Start($startInfo)
        if (-not [Orbita.Dev.JobNative]::AssignProcessToJobObject($jobHandle, $process.Handle)) {
            throw "Unable to assign npm to the Orbita development Job Object (Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error()))."
        }
        return [pscustomobject]@{ Process = $process; JobHandle = $jobHandle }
    }
    catch {
        if ($null -ne $process) { $process.Dispose() }
        [Orbita.Dev.JobNative]::TerminateJobObject($jobHandle, 1) | Out-Null
        [Orbita.Dev.JobNative]::CloseHandle($jobHandle) | Out-Null
        throw
    }
}

try {
    # Resolve the toolchain only for the owner. A competing invocation must not
    # spend time running environment setup before it reports the active session.
    . "$PSScriptRoot\env.ps1"
    $consecutiveFailures = 0
    while ($true) {
        Write-Host "[dev.bat] Cleaning stale processes..."
        & "$PSScriptRoot\dev-clean.ps1"
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[dev.bat] Cleanup failed; no Tauri/Vite process was started."
            exit $LASTEXITCODE
        }

        $sessionChild = Start-SessionChild "$PSScriptRoot\..\apps\desktop"
        try {
            $sessionChild.Process.WaitForExit()
            $exitCode = $sessionChild.Process.ExitCode
        }
        finally {
            Stop-SessionChildTree $sessionChild
            $sessionChild = $null
        }

        if ($exitCode -eq 0) {
            exit 0
        }

        $consecutiveFailures++
        if ($consecutiveFailures -ge $maxConsecutiveFailures) {
            Write-Host "[dev.bat] Abnormal exit code=$exitCode; stopped after $consecutiveFailures consecutive failures. Fix the first error above, then run dev.bat again."
            exit $exitCode
        }

        $retryDelay = 5 * $consecutiveFailures
        Write-Host ""
        Write-Host "[dev.bat] Abnormal exit code=$exitCode; retrying in $retryDelay seconds ($consecutiveFailures/$maxConsecutiveFailures, Ctrl+C stops this session)."
        Start-Sleep -Seconds $retryDelay
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
