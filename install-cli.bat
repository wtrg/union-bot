@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

echo ======================================================================
echo    UNION BOT - CAI DAT LENH CMD TOAN CUC
echo ======================================================================
echo.

set "TARGET_DIR=%USERPROFILE%\.local\bin"
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

echo [1/2] Dang sao chep tap lenh vao: %TARGET_DIR% ...
copy /Y "bin\union-bot.cmd" "%TARGET_DIR%\" >nul
copy /Y "bin\unionbot.cmd" "%TARGET_DIR%\" >nul
copy /Y "bin\union.cmd" "%TARGET_DIR%\" >nul
copy /Y "bin\union-bot.ps1" "%TARGET_DIR%\" >nul
copy /Y "bin\unionbot.ps1" "%TARGET_DIR%\" >nul
copy /Y "bin\union.ps1" "%TARGET_DIR%\" >nul

echo [OK] Da sao chep thanh cong!
echo.
echo [2/2] Kiem tra bien moi truong PATH...
where union-bot >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] Lenh 'union-bot' da san sang su dung!
) else (
    echo [THONG BAO] Thu muc %TARGET_DIR% chua co trong PATH.
    echo Dang bo sung vao PATH nguoi dung...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ';%TARGET_DIR%', 'User')"
    echo [OK] Da cap nhat PATH thanh cong.
)

echo.
echo ======================================================================
echo  CAI DAT HOAN TAT!
echo  Tu bay gio ban co the mo cmd / terminal bat ky va go:
echo     union-bot
echo     hoac: unionbot
echo     hoac: union
echo  de khoi dong ung dung ngay lap tuc!
echo ======================================================================
pause
