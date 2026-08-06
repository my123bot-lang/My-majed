@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo ========================================
echo   Switch WhatsApp to: Raed (0488)
echo ========================================
echo.
node scripts/set-active-wa.js 0488
if errorlevel 1 pause & exit /b 1
echo.
echo Starting bot (Chrome will open for 0488)...
echo Keep the black window OPEN.
echo.
call start-bot.bat
