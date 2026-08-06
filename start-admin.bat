@echo off
cd /d "%~dp0"
if not exist package.json (
  echo ERROR: package.json not found.
  pause
  exit /b 1
)
where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not in PATH.
  pause
  exit /b 1
)
node scripts/kill-admin-port.js
timeout /t 2 /nobreak >nul
echo.
echo ========================================
echo   ADMIN PANEL - keep window OPEN
echo   URL: http://127.0.0.1:3000
echo ========================================
echo.
node server.js
pause
