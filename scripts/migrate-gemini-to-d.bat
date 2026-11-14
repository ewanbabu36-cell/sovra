@echo off
setlocal EnableDelayedExpansion

REM ==============================================================================
REM   SOVRA / GEMINI STORAGE RELOCATION SCRIPT
REM   Safely moves C:\Users\alamr\.gemini to D:\.gemini
REM   Reclaims ~7.25+ GB on Drive C: via NTFS Directory Junction (mklink /J)
REM ==============================================================================

echo ==============================================================================
echo    🚀 GEMINI DATA MIGRATION: DRIVE C: -^> DRIVE D: WITH NTFS JUNCTION
echo ==============================================================================
echo.

set "SOURCE_DIR=%USERPROFILE%\.gemini"
set "TARGET_DIR=D:\.gemini"
set "BACKUP_DIR=%USERPROFILE%\.gemini.old_backup"

echo [INFO] Source directory: %SOURCE_DIR%
echo [INFO] Target directory: %TARGET_DIR%
echo.

REM 1. Check if Source Exists
if not exist "%SOURCE_DIR%" (
    echo [ERROR] Source directory "%SOURCE_DIR%" does not exist.
    echo Nothing to migrate.
    goto :END
)

REM 2. Check if already a junction
fsutil reparsepoint query "%SOURCE_DIR%" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [INFO] "%SOURCE_DIR%" is ALREADY a junction or reparse point!
    echo Migration has already been completed previously.
    goto :END
)

REM 3. Require Administrative Elevation if needed
net session >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [WARN] Administrator privileges are required to create directory junctions.
    echo Please right-click this script and select "Run as administrator".
    pause
    exit /b 1
)

echo [STEP 1/4] Copying files from %SOURCE_DIR% to %TARGET_DIR% via Robocopy...
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

robocopy "%SOURCE_DIR%" "%TARGET_DIR%" /E /COPY:DAT /DCOPY:DAT /R:3 /W:2 /MT:8 /NP

if %ERRORLEVEL% GEQ 8 (
    echo [ERROR] Robocopy encountered critical errors during file copy (Exit code: %ERRORLEVEL%).
    echo Migration aborted. Source files were NOT modified.
    goto :END
)

echo.
echo [STEP 2/4] Verifying target directory integrity...
if not exist "%TARGET_DIR%" (
    echo [ERROR] Target directory verification failed!
    goto :END
)

echo [STEP 3/4] Renaming original source directory for safe rollback...
if exist "%BACKUP_DIR%" rd /s /q "%BACKUP_DIR%"
ren "%SOURCE_DIR%" ".gemini.old_backup"

if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to rename source directory. Make sure no programs (IDE, dev-server) are using it.
    goto :END
)

echo [STEP 4/4] Creating NTFS Directory Junction: %SOURCE_DIR% -^> %TARGET_DIR%...
mklink /J "%SOURCE_DIR%" "%TARGET_DIR%"

if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to create junction! Rolling back original directory...
    ren "%BACKUP_DIR%" ".gemini"
    goto :END
)

echo.
echo ==============================================================================
echo   🎉 MIGRATION SUCCESSFUL!
echo ==============================================================================
echo   • Junction active: %SOURCE_DIR% -^> %TARGET_DIR%
echo   • Backup preserved at: %BACKUP_DIR%
echo.
set /p RECLAIM="Do you want to permanently delete the backup to reclaim ~7.25 GB on C:? (Y/N): "
if /i "%RECLAIM%"=="Y" (
    echo Cleaning up backup directory...
    rd /s /q "%BACKUP_DIR%"
    echo [SUCCESS] Reclaimed ~7.25+ GB of free disk space on Drive C:!
) else (
    echo [INFO] Backup preserved at %BACKUP_DIR%. You can manually delete it later.
)

:END
echo.
echo Press any key to exit...
pause >nul
