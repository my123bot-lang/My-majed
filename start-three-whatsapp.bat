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
echo   THREE WhatsApp - Raed + Abdulrahman + Majed
echo   Three bot windows + Chrome for each
echo   Do NOT close bot windows. Wait for Chrome.
echo ========================================
echo.
echo [1/5] Repair accounts + unlock sessions...
node scripts/repair-wa-accounts.js
if errorlevel 1 (
  echo ERROR: Could not load WhatsApp accounts.
  pause
  exit /b 1
)
node scripts/unlock-session.js
ping -n 3 127.0.0.1 >nul
echo.
echo [2/5] Starting Raed (0488)...
call start-bot-account.bat 0488
if errorlevel 1 (
  echo ERROR: Failed to start 0488
  pause
  exit /b 1
)
echo Waiting 25 seconds for first Chrome...
ping -n 26 127.0.0.1 >nul
echo.
echo [3/5] Starting Abdulrahman...
call start-bot-account.bat wa_1780305984859
if errorlevel 1 (
  echo ERROR: Failed to start wa_1780305984859
  pause
  exit /b 1
)
echo Waiting 25 seconds for second Chrome...
ping -n 26 127.0.0.1 >nul
echo.
echo [4/5] Starting Majed...
call start-bot-account.bat majed
if errorlevel 1 (
  echo ERROR: Failed to start majed
  pause
  exit /b 1
)
echo.
echo [5/5] Done. You should see 3 windows: WA-BOT-0488, WA-BOT-wa_..., WA-BOT-majed
echo Wait 30-60 sec per window for Chrome + WhatsApp ready.
echo.
pause
