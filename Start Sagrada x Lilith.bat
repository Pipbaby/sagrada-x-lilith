@echo off
rem Starts Sagrada x Lilith on this computer and opens it in your browser.
rem Close this window to stop it. Your music folder is only ever read.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Sagrada x Lilith needs Node.js 20 or newer, which is free.
  echo Install the LTS version from https://nodejs.org, then double-click this file again.
  start "" https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules (
  echo First start: installing the parts it needs. This takes a minute, once.
  call npm install --no-audit --no-fund
  if errorlevel 1 ( pause & exit /b 1 )
)
node server.mjs --open
pause
