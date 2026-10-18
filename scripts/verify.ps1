# Union Bot — Fast & Strict Pre-commit Verification Script
# Runs all unit tests, security scans, and engine checks. Exits nonzero on any failure.

$ErrorActionPreference = "Stop"

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host "UNION BOT COMPREHENSIVE VERIFICATION SUITE (P1 WAVE 2)" -ForegroundColor Cyan
Write-Host "========================================================`n" -ForegroundColor Cyan

# 1. Strict TypeScript Typecheck across Monorepo
Write-Host "--- 1. Strict TypeScript Typecheck across Monorepo ---" -ForegroundColor Yellow
pnpm typecheck
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[FATAL] TypeScript typecheck failed!" -ForegroundColor Red
    exit 1
}

# 2. Build Workspace UI bundle
Write-Host "`n--- 2. Building Workspace UI Production Bundle ---" -ForegroundColor Yellow
pnpm build
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[FATAL] Workspace UI build failed!" -ForegroundColor Red
    exit 1
}

# 3. Run TypeScript & Node Unit Tests (59 tests)
Write-Host "`n--- 3. Running TypeScript & Node Unit Tests (59 tests) ---" -ForegroundColor Yellow
pnpm test:ts
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[FATAL] TypeScript unit tests failed!" -ForegroundColor Red
    exit 1
}

# 4. Run Python Unit Tests (16 tests)
Write-Host "`n--- 4. Running Python Unit Tests (16 tests) ---" -ForegroundColor Yellow
pnpm test:py
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[FATAL] Python unit tests failed!" -ForegroundColor Red
    exit 1
}

# 5. Run Electron Automated GUI Smoke Test (Fail-closed assertions)
Write-Host "`n--- 5. Running Electron Automated GUI Smoke Test ---" -ForegroundColor Yellow
pnpm smoke:gui
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[FATAL] Electron GUI smoke test failed!" -ForegroundColor Red
    exit 1
}

# 6. Run Strict Secret Scan Audit (Exact SHA256 digest check)
Write-Host "`n--- 6. Running Strict Secret & Security Audit ---" -ForegroundColor Yellow
pnpm secret-scan
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[FATAL] Strict secret scanner check failed!" -ForegroundColor Red
    exit 1
}

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host "ALL VERIFICATION CHECKS PASSED (Typecheck + 75 Unit Tests + GUI Smoke + Strict Secret Scan)" -ForegroundColor Green
Write-Host "========================================================`n" -ForegroundColor Green
exit 0
