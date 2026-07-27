@echo off
cd /d "%~dp0.."
powershell -ExecutionPolicy Bypass -Command ". .\scripts\env.ps1; Set-Location orbita; npm run dev"
