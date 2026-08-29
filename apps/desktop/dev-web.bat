@echo off
setlocal
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -Command ". .\..\..\scripts\env.ps1; npm run dev"
