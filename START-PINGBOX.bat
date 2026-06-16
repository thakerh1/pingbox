@echo off
title Pingbox — Email Validation Server
color 1F
echo.
echo  ============================================
echo   PINGBOX — Email Validation Server
echo  ============================================
echo.
echo  Checking Node.js...
node --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
  color 4F
  echo.
  echo  [ERROR] Node.js is not installed!
  echo.
  echo  Please install it from: https://nodejs.org
  echo  Download the "LTS" version, install it like
  echo  any normal Windows app, then run this file again.
  echo.
  pause
  exit /b 1
)

echo  Node.js found! Starting server...
echo.
echo  Keep this window open while using Pingbox.
echo  Open index.html in your browser to get started.
echo.
echo  Press Ctrl+C to stop the server when done.
echo  ============================================
echo.
node "%~dp0server.js"
pause
