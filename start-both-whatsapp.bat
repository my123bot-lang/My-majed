@echo off
cd /d "%~dp0"
if not exist package.json (
  echo ERROR: package.json not found in this folder.
  pause
  exit /b 1
)
where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed. Install from https://nodejs.org
  pause
  exit /b 1
)
echo.
echo ========================================
echo   DUAL WhatsApp - 0488 + Abdulrahman
echo   Two windows: WA-BOT-0488 and WA-BOT-wa_...
echo   Do NOT close bot windows. Wait for Chrome.
echo ========================================
echo.
node scripts/unlock-session.js
ping -n 3 127.0.0.1 >nul
call start-bot-account.bat 0488
echo Waiting 25 seconds for first Chrome to finish...
ping -n 26 127.0.0.1 >nul
call start-bot-account.bat wa_1780305984859
echo.
echo Done. You should see 2 bot windows + Chrome for each.
echo If Chrome does not open, read the last line in WA-BOT window.
echo.
pause
