@echo off
chcp 65001 >nul
title EUDR Traceability - server (close this window to stop)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [!] Node.js not found. Install it from https://nodejs.org first.
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting EUDR traceability system...
echo   Keep this window open while using the site.
echo.

start "" node "eudr-web\serve.js"
timeout /t 2 /nobreak >nul
start "" http://localhost:8777

echo   Opened http://localhost:8777 in your browser.
echo   Close this window when you are done.
echo.
pause
