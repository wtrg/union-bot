@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
title Union Bot - Local Workspace Desktop

echo ======================================================================
echo    UNION BOT - MULTI-AI COLLABORATION DESKTOP WORKSPACE
echo    Che do: Local Workspace Runner
echo ======================================================================
echo.
echo [1/3] Kiem tra moi truong Node.js...

set "NODE_CMD="
if exist "bin\node.exe" (
    set "NODE_CMD=bin\node.exe"
    goto :found_node
)

where node >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set "NODE_CMD=node"
    goto :found_node
)

echo [LOI] Khong tim thay Node.js tren may!
echo Vui long cai dat Node.js LTS (>= 22.0.0) de khoi dong ung dung.
pause
exit /b 1

:found_node
echo [OK] Su dung Node.js: %NODE_CMD%
echo [2/3] Khoi tao thu muc scratch...
if not exist "scratch" mkdir "scratch"

echo [3/3] Dang mo ung dung Union Bot Desktop...
echo.
echo ======================================================================
echo  Ung dung dang chay. Dong cua so hoac nhan Ctrl+C de thoat.
echo ======================================================================
echo.

"%NODE_CMD%" apps/desktop/scripts/launch.js %*
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [THONG BAO] Ung dung da thoat voi ma: %ERRORLEVEL%
    pause
)
