@echo off
cd /d "%~dp0"
if "%~1"=="" (
  echo Usage: start-bot-account.bat ACCOUNT_ID
  echo Example: start-bot-account.bat majed
  pause
  exit /b 1
)
where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not in PATH.
  pause
  exit /b 1
)
echo Checking account: %~1
node -e "try{const a=require('./lib/whatsapp-accounts-store').getAccountById(process.argv[1]);console.log('OK:',a.label);}catch(e){console.error(e.message);process.exit(1)}" %~1
if errorlevel 1 (
  echo.
  echo Account %~1 not found. Run: node scripts/repair-wa-accounts.js
  pause
  exit /b 1
)
echo Starting account: %~1
node scripts/unlock-session.js %~1
ping -n 2 127.0.0.1 >nul
start "WA-BOT-%~1" cmd /k cd /d "%~dp0." ^& set WA_ACCOUNT_ID=%~1 ^& echo ===== WhatsApp BOT %~1 ===== ^& node bot.js
echo Opened window WA-BOT-%~1 - wait 30-60 sec for Chrome.
exit /b 0
