@echo off
setlocal

cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\dev-session.ps1"
exit /b %ERRORLEVEL%
