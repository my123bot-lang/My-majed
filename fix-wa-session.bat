@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo Fix WhatsApp session (account 0488 or active)
echo Close Chrome first if open...
echo.
taskkill /F /IM chrome.exe 2>nul
timeout /t 3 /nobreak >nul
node scripts/kill-bot.js
node scripts/reset-wa-session.js 0488
if errorlevel 1 node scripts/reset-wa-session.js
echo.
echo Starting bot - scan QR in admin panel
echo Admin: start-admin.bat then http://127.0.0.1:3000
echo.
node bot.js
pause
