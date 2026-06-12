@echo off
rem Double-click to stop and remove the ceremony containers (same as the Stop button).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ceremony.ps1" stop
echo.
pause
