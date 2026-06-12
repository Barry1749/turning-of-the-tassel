@echo off
rem Double-click to open the ceremony control panel (Start / Stop buttons + the MC link).
rem -STA is required for the WinForms window; -ExecutionPolicy Bypass runs the script without
rem fiddling with the machine's PowerShell policy.
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0scripts\ceremony-gui.ps1"
