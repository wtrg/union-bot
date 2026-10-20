@echo off
chcp 65001 >nul
title Union Bot - Ứng dụng Desktop Multi-Agent

echo ======================================================================
echo    UNION BOT — WORKSPACE DESKTOP MULTI-AGENT COLLABORATION (0đ)
echo ======================================================================
echo.
echo [1/3] Đang kiểm tra môi trường chạy Portable...

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [LỖI] Không tìm thấy Node.js trong PATH. Vui lòng cài đặt Node.js LTS (>= 22.0.0).
    pause
    exit /b 1
)

echo [2/3] Khởi tạo thư mục làm việc và scratch...
if not exist "scratch" mkdir "scratch"

echo [3/3] Khởi chạy ứng dụng Union Bot Desktop...
echo.
echo ======================================================================
echo  Ứng dụng đang mở. Để dừng ứng dụng, đóng cửa sổ hoặc nhấn Ctrl+C.
echo ======================================================================
echo.

node apps/desktop/scripts/launch.js %*

if %ERRORLEVEL% neq 0 (
    echo.
    echo [THÔNG BÁO] Ứng dụng đã thoát với mã: %ERRORLEVEL%
    pause
)
