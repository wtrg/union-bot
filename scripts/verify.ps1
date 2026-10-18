# Union Bot — Fast & Strict Pre-commit Verification Script
# Runs all unit tests, security scans, and engine checks. Exits nonzero on any failure.

$ErrorActionPreference = "Stop"

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host "UNION BOT COMPREHENSIVE VERIFICATION SUITE (P1 WAVE 2)" -ForegroundColor Cyan
Write-Host "========================================================`n" -ForegroundColor Cyan

# 1. Build Workspace UI bundle
Write-Host "--- 1. Building Workspace UI Production Bundle ---" -ForegroundColor Yellow
pnpm build
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[FATAL] Workspace UI build failed!" -ForegroundColor Red
    exit 1
}

# 2. Run TypeScript & Node Unit Tests (51 tests)
Write-Host "`n--- 2. Running TypeScript & Node Unit Tests (51 tests) ---" -ForegroundColor Yellow
pnpm test:ts
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[FATAL] TypeScript unit tests failed!" -ForegroundColor Red
    exit 1
}

# 3. Run Python Unit Tests (14 tests)
Write-Host "`n--- 3. Running Python Unit Tests (14 tests) ---" -ForegroundColor Yellow
pnpm test:py
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[FATAL] Python unit tests failed!" -ForegroundColor Red
    exit 1
}

# 4. Run Electron Automated GUI Smoke Test
Write-Host "`n--- 4. Running Electron Automated GUI Smoke Test ---" -ForegroundColor Yellow
pnpm smoke:gui
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[FATAL] Electron GUI smoke test failed!" -ForegroundColor Red
    exit 1
}

# 5. Run Strict Secret Scan Audit
Write-Host "`n--- 5. Running Strict Secret & Security Audit ---" -ForegroundColor Yellow
pnpm secret-scan
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[FATAL] Strict secret scanner check failed!" -ForegroundColor Red
    exit 1
}

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host "ALL VERIFICATION CHECKS PASSED (65 Unit Tests + GUI Smoke PASS / 0 Leaks)" -ForegroundColor Green
Write-Host "========================================================`n" -ForegroundColor Green
exit 0
