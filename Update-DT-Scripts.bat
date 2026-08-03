@echo off
setlocal EnableExtensions
REM Public entrypoint for Windows. Downloads updater from the mirror and runs it.
set "BASE_URL=https://raw.githubusercontent.com/xamartinsa/design-terminal-indesign-scripts/main"
set "PS1=%TEMP%\Update-DT-Scripts.ps1"

curl.exe -fsSL "%BASE_URL%/Update-DT-Scripts.ps1" -o "%PS1%"
if errorlevel 1 (
  echo Failed to download updater from %BASE_URL%
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -BaseUrl "%BASE_URL%"
set "ERR=%ERRORLEVEL%"
del /q "%PS1%" >nul 2>&1
if not "%ERR%"=="0" (
  echo.
  echo Update failed.
  pause
  exit /b %ERR%
)
echo.
pause
