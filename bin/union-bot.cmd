@echo off
setlocal
chcp 65001 >nul

if exist "%~dp0..\apps\desktop\scripts\launch.js" (
    cd /d "%~dp0.."
) else if exist "D:\WORK-TEAM\apps\desktop\scripts\launch.js" (
    cd /d "D:\WORK-TEAM"
) else (
    echo [LOI] Khong tim thay thu muc Union Bot Workspace!
    exit /b 1
)

echo [Union Bot] Dang khoi dong Union Bot Desktop...
node apps/desktop/scripts/launch.js %*
