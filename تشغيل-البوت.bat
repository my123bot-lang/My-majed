@echo off
cd /d "%~dp0"
if not exist package.json (
  echo ERROR: package.json not found.
  echo Run this file from the whatsapp_direct_bot folder.
  pause
  exit /b 1
)
taskkill /F /IM node.exe 2>nul
timeout /t 2 /nobreak >nul
call npm run unlock
echo.
echo Starting WhatsApp bot - do not close this window.
echo.
call npm start
echo.
echo Bot stopped. Check messages above.
pause
