@echo off
chcp 65001 >nul
title Union Bot - Local Workspace Runner (Desktop Multi-Agent)

echo ======================================================================
echo    UNION BOT — WORKSPACE DESKTOP MULTI-AGENT COLLABORATION (0đ)
echo    Chế độ: Local Workspace Runner (Chạy trực tiếp không cần installer)
echo ======================================================================
echo.
echo [1/3] Đang kiểm tra môi trường thực thi...

set "NODE_CMD="
if exist "bin\node.exe" (
    set "NODE_CMD=bin\node.exe"
    echo [OK] Đã tìm thấy Node.js cục bộ: bin\node.exe
) else (
    where node >nul 2>&1
    if %ERRORLEVEL% equ 0 (
        set "NODE_CMD=node"
        echo [OK] Đã tìm thấy Node.js từ môi trường PATH
    ) else (
        echo [LỖI] Không tìm thấy Node.js.
        echo Để chạy ứng dụng ở chế độ Workspace Runner, vui lòng cài đặt Node.js LTS (>= 22.0.0).
        echo Đối với bản phát hành đóng gói độc lập P11, toàn bộ runtime sẽ được nhúng trong gói standalone.
        pause
        exit /b 1
    )
)

echo [2/3] Khởi tạo thư mục làm việc và vùng cô lập scratch...
if not exist "scratch" mkdir "scratch"

echo [3/3] Khởi chạy ứng dụng Union Bot Desktop...
echo.
echo ======================================================================
echo  Ứng dụng đang mở. Để dừng ứng dụng, đóng cửa sổ hoặc nhấn Ctrl+C.
echo ======================================================================
echo.

%NODE_CMD% apps/desktop/scripts/launch.js %*

if %ERRORLEVEL% neq 0 (
    echo.
    echo [THÔNG BÁO] Ứng dụng đã thoát với mã: %ERRORLEVEL%
    pause
)
