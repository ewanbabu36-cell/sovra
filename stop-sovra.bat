@echo off
title Stop Sovra Services
color 0c

echo ============================================================
echo           STOPPING SOVRA SERVICES & TUNNELS
echo ============================================================
echo.

echo Stopping ngrok tunnel...
taskkill /f /im ngrok.exe >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo ✅ ngrok stopped.
) else (
    echo ℹ️ ngrok was not running.
)

echo Stopping Node dev server on port 3001...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3001 ^| findstr LISTENING') do (
    taskkill /f /pid %%a >nul 2>&1
    echo ✅ Terminated dev server process %%a on port 3001.
)

echo.
echo ============================================================
echo  All Sovra services stopped successfully.
echo ============================================================
pause
