# Own the complete npm/Vitest tree. On Windows, closing a Job Object with this
# flag kills any Tinypool worker left behind when the outer test process is
# cancelled or exits unexpectedly. Keep this separate from dev-session: tests
# must never clean or interrupt a running Tauri development session.
if ($null -eq ("Orbita.Test.JobNative" -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace Orbita.Test {
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

    [DllImport("kernel32.dll", SetLastError = true)]
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

function New-TestJob {
    $job = [Orbita.Test.JobNative]::CreateJobObject([IntPtr]::Zero, $null)
    if ($job -eq [IntPtr]::Zero) {
        throw "Unable to create the Orbita test Job Object (Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error()))."
    }
    $limit = [Orbita.Test.ExtendedLimitInformation]::new()
    $limit.BasicLimitInformation.LimitFlags = [Orbita.Test.JobNative]::JobObjectLimitKillOnJobClose
    $size = [Runtime.InteropServices.Marshal]::SizeOf([type][Orbita.Test.ExtendedLimitInformation])
    $buffer = [Runtime.InteropServices.Marshal]::AllocHGlobal($size)
    try {
        [Runtime.InteropServices.Marshal]::StructureToPtr($limit, $buffer, $false)
        if (-not [Orbita.Test.JobNative]::SetInformationJobObject($job, [Orbita.Test.JobNative]::JobObjectExtendedLimitInformation, $buffer, [uint32]$size)) {
            throw "Unable to configure the Orbita test Job Object (Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error()))."
        }
        return $job
    }
    catch {
        [Orbita.Test.JobNative]::CloseHandle($job) | Out-Null
        throw
    }
    finally {
        [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)
    }
}

$job = [IntPtr]::Zero
$process = $null
try {
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = (Get-Command npm.cmd -CommandType Application -ErrorAction Stop).Source
    $startInfo.Arguments = "run test:run"
    $startInfo.WorkingDirectory = (Resolve-Path "$PSScriptRoot\..\orbita").Path
    $startInfo.UseShellExecute = $false
    $job = New-TestJob
    $process = [System.Diagnostics.Process]::Start($startInfo)
    if (-not [Orbita.Test.JobNative]::AssignProcessToJobObject($job, $process.Handle)) {
        throw "Unable to assign npm to the Orbita test Job Object (Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error()))."
    }
    $process.WaitForExit()
    exit $process.ExitCode
}
finally {
    if ($job -ne [IntPtr]::Zero) {
        [Orbita.Test.JobNative]::TerminateJobObject($job, 1) | Out-Null
    }
    if ($null -ne $process) { $process.Dispose() }
    if ($job -ne [IntPtr]::Zero) { [Orbita.Test.JobNative]::CloseHandle($job) | Out-Null }
}
