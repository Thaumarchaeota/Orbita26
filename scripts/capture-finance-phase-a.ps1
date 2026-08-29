param(
  [string]$OutDir = (Join-Path $PSScriptRoot "..\docs\plans\evidence\v0.0.17-finance-ui\phase-a"),
  [switch]$CaptureOnly,
  [switch]$OpenDetail
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Add-Type -ReferencedAssemblies System.Drawing @"
using System;
using System.Drawing;
using System.Runtime.InteropServices;

public static class WinCap {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public const int SW_RESTORE = 9;
  public const uint SWP_SHOWWINDOW = 0x0040;
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public static void SaveHwnd(IntPtr hwnd, string path) {
    ShowWindow(hwnd, SW_RESTORE);
    SetForegroundWindow(hwnd);
    System.Threading.Thread.Sleep(250);
    RECT r; GetWindowRect(hwnd, out r);
    int w = r.Right - r.Left; int h = r.Bottom - r.Top;
    using (var bmp = new Bitmap(w, h)) {
      using (var g = Graphics.FromImage(bmp)) {
        g.CopyFromScreen(r.Left, r.Top, 0, 0, new Size(w, h), CopyPixelOperation.SourceCopy);
      }
      bmp.Save(path, System.Drawing.Imaging.ImageFormat.Png);
    }
  }
  public static void SendDevChord() {
    const byte VK_CONTROL = 0x11;
    const byte VK_MENU = 0x12;
    const byte VK_F = 0x46;
    const uint KEYEVENTF_KEYUP = 0x0002;
    keybd_event(VK_CONTROL, 0, 0, UIntPtr.Zero);
    keybd_event(VK_MENU, 0, 0, UIntPtr.Zero);
    keybd_event(VK_F, 0, 0, UIntPtr.Zero);
    keybd_event(VK_F, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
  }
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WinClick {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public static void At(IntPtr hwnd, double rx, double ry) {
    RECT r; GetWindowRect(hwnd, out r);
    int x = r.Left + (int)((r.Right - r.Left) * rx);
    int y = r.Top + (int)((r.Bottom - r.Top) * ry);
    SetForegroundWindow(hwnd);
    SetCursorPos(x, y);
    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
  }
}
"@

function Get-OrbitaWindows {
  Get-Process orbita -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
}

function Assert-Responding($proc) {
  if (-not $proc.Responding) {
    throw "Orbita PID $($proc.Id) is not responding. Run scripts\dev-clean.ps1 and restart dev.bat before capture."
  }
}

function Click-Relative([IntPtr]$hwnd, [double]$rx, [double]$ry) {
  [WinClick]::At($hwnd, $rx, $ry)
  Start-Sleep -Milliseconds 400
}

function Resize-Orbita([IntPtr]$hwnd, [int]$width, [int]$height) {
  [WinCap]::SetWindowPos($hwnd, [IntPtr]::Zero, 100, 60, $width, $height, [WinCap]::SWP_SHOWWINDOW) | Out-Null
  Start-Sleep -Milliseconds 500
}

function Open-FinanceDetail {
  $main = (Get-OrbitaWindows | Select-Object -First 1)
  if (-not $main) { throw "No Orbita window found. Start apps\desktop\dev.bat first." }
  Assert-Responding $main
  [WinCap]::SetForegroundWindow($main.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 200
  [WinCap]::SendDevChord()
  Start-Sleep -Seconds 4
}

function Get-AdminWindow {
  $wins = @(Get-OrbitaWindows)
  if ($wins.Count -ge 2) { return $wins[-1] }
  return $wins[0]
}

function Capture-Scene([string]$name, [IntPtr]$hwnd) {
  $path = Join-Path $OutDir "$name.png"
  [WinCap]::SaveHwnd($hwnd, $path)
  Write-Host "saved $path"
}

if (-not $CaptureOnly -and -not $OpenDetail) {
  Write-Host @"
Manual Phase A capture (recommended):
1. apps\desktop\dev.bat running, no cargo rebuild in progress
2. Main window: Ctrl+Alt+F opens Insight Finance Detail (debug only)
3. Resize admin window; toggle sidebar / rail / drawer by hand
4. Save PNGs under: $OutDir
5. Optional: rerun with -OpenDetail for dev chord only, or -CaptureOnly after UI is ready

Do NOT run full auto loop while Orbita is rebuilding or unresponsive.
"@
  exit 0
}

if ($OpenDetail) {
  Open-FinanceDetail
  exit 0
}

$admin = Get-AdminWindow
if (-not $admin) { throw "No Orbita window for capture." }
Assert-Responding $admin
$hwnd = $admin.MainWindowHandle

foreach ($width in @(1440, 1280, 1024)) {
  Resize-Orbita $hwnd $width 900
  Assert-Responding $admin
  Capture-Scene "${width}-sidebar-expanded-rail-open" $hwnd
  Click-Relative $hwnd 0.04 0.05
  Capture-Scene "${width}-sidebar-collapsed-rail-open" $hwnd
  Click-Relative $hwnd 0.04 0.05
  if ($width -le 1180) {
    Capture-Scene "${width}-sidebar-expanded-drawer-closed" $hwnd
    Click-Relative $hwnd 0.94 0.08
    Capture-Scene "${width}-sidebar-expanded-drawer-open" $hwnd
    Click-Relative $hwnd 0.94 0.08
    Click-Relative $hwnd 0.04 0.05
    Capture-Scene "${width}-sidebar-collapsed-drawer-closed" $hwnd
    Click-Relative $hwnd 0.94 0.08
    Capture-Scene "${width}-sidebar-collapsed-drawer-open" $hwnd
    Click-Relative $hwnd 0.94 0.08
    Click-Relative $hwnd 0.04 0.05
  } else {
    Click-Relative $hwnd 0.94 0.08
    Capture-Scene "${width}-sidebar-expanded-rail-collapsed" $hwnd
    Click-Relative $hwnd 0.94 0.08
    Click-Relative $hwnd 0.04 0.05
    Click-Relative $hwnd 0.94 0.08
    Capture-Scene "${width}-sidebar-collapsed-rail-collapsed" $hwnd
    Click-Relative $hwnd 0.94 0.08
    Click-Relative $hwnd 0.04 0.05
  }
}

Write-Host "Phase A evidence written to $OutDir"
