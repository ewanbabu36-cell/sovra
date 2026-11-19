@echo off
title Sovra One-Click Live Launcher
color 0b

echo ============================================================
echo           SOVRA ONE-CLICK SYSTEM LAUNCHER
echo ============================================================
echo.

cd /d "%~dp0"

echo [1/3] Checking if Sovra Dev Server is running on port 3001...
netstat -ano | findstr :3001 | findstr LISTENING >nul
if %ERRORLEVEL% equ 0 (
    echo       ✅ Dev Server is already running.
) else (
    echo       🚀 Starting Sovra Dev Server in new terminal...
    start "Sovra Dev Server (Port 3001)" cmd /k "cd /d %~dp0 && npm run dev"
    timeout /t 3 /nobreak >nul
)

echo [2/3] Checking ngrok Tunnel...
tasklist /fi "imagename eq ngrok.exe" | findstr /i "ngrok.exe" >nul
if %ERRORLEVEL% equ 0 (
    echo       ✅ ngrok is already running.
) else (
    echo       🚀 Starting ngrok tunnel...
    start "Sovra ngrok Tunnel" cmd /k "cd /d %~dp0 && .\scripts\ngrok.exe http 3001"
    timeout /t 3 /nobreak >nul
)

echo.
echo ============================================================
echo  🌐 YOUR SOVRA NGROK LIVE URL:
echo     👉 https://reflector-grafting-clergyman.ngrok-free.dev
echo.
echo  Opening in your default browser...
echo ============================================================
echo.

start https://reflector-grafting-clergyman.ngrok-free.dev

timeout /t 5
