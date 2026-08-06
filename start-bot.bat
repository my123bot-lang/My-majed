@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist package.json (
  echo ERROR: package.json not found in this folder.
  pause
  exit /b 1
)
where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not in PATH.
  echo Install from https://nodejs.org then try again.
  pause
  exit /b 1
)
echo Folder: %CD%
echo.
node scripts/kill-bot.js
taskkill /F /IM chrome.exe 2>nul
timeout /t 2 /nobreak >nul
node scripts/unlock-session.js
timeout /t 1 /nobreak >nul
echo.
echo ========================================
echo   WhatsApp BOT - Majed
echo   Chrome stays open for QR - do NOT close window
echo ========================================
echo.
node bot.js majed
set EXITCODE=%ERRORLEVEL%
echo.
if %EXITCODE% NEQ 0 (
  echo Bot exited with error code %EXITCODE%
) else (
  echo Bot stopped.
)
pause
exit /b %EXITCODE%
