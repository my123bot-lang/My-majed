@echo off
cd /d "%~dp0"
echo Fix WhatsApp session (majed or active)
echo.
call npm run unlock
echo.
echo Resetting LocalAuth session folder...
node scripts/reset-wa-session.js majed
echo.
echo Done. Run start-majed.bat and scan QR again if needed.
pause
