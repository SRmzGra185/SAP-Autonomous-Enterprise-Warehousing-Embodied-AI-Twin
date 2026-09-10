@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0Launch-SOXTECH-Desktop.ps1"
set "SOXTECH_EXIT=%ERRORLEVEL%"

if not "%SOXTECH_EXIT%"=="0" (
  echo.
  echo SOXTECH could not start. The diagnostic log is:
  echo %~dp0.runtime\launcher.log
  echo.
  pause
)

exit /b %SOXTECH_EXIT%
