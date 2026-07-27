@echo off
cd /d "%~dp0.."
powershell -ExecutionPolicy Bypass -Command ". .\scripts\env.ps1; Get-NetTCPConnection -LocalPort 1420 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }; Get-Process -Name orbita -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Set-Location orbita; npm run tauri dev"
