@echo off
setlocal

cd /d "%~dp0.."



:loop

echo [dev.bat] 清理旧进程...

powershell -ExecutionPolicy Bypass -File ".\scripts\dev-clean.ps1"

if errorlevel 1 (

  echo [dev.bat] 清理失败，请手动结束占用 1420 的进程后重试

  pause

  goto :end

)

cd orbita

call npm run tauri dev

set RC=%ERRORLEVEL%

cd ..

if %RC% equ 0 goto :end

echo.

echo [dev.bat] 异常退出 code=%RC% ，5 秒后自动重启（Ctrl+C 终止）

timeout /t 5 /nobreak >nul

goto loop



:end

