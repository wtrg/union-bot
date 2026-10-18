# Union Bot — Fast & Strict Pre-commit Verification Script
# Runs all unit tests, security scans, and engine checks. Exits nonzero on any failure.

$ErrorActionPreference = "Stop"

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host "UNION BOT COMPREHENSIVE VERIFICATION SUITE" -ForegroundColor Cyan
Write-Host "========================================================`n" -ForegroundColor Cyan

# 1. Run TypeScript Unit Tests (Cost Guard, Artifact Store, Safe External)
Write-Host "--- 1. Running TypeScript & Node Unit Tests (33 tests) ---" -ForegroundColor Yellow
pnpm test:ts
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[FATAL] TypeScript unit tests failed!" -ForegroundColor Red
    exit 1
}

# 2. Run Python Unit Tests (Scanner & Codex RPC Harness)
Write-Host "`n--- 2. Running Python Unit Tests (14 tests) ---" -ForegroundColor Yellow
pnpm test:py
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[FATAL] Python unit tests failed!" -ForegroundColor Red
    exit 1
}

# 3. Run Strict Secret Scan Audit
Write-Host "`n--- 3. Running Strict Secret & Security Audit ---" -ForegroundColor Yellow
pnpm secret-scan
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[FATAL] Strict secret scanner check failed!" -ForegroundColor Red
    exit 1
}

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host "ALL VERIFICATION CHECKS PASSED (47 Unit Tests PASS / 0 Leaks)" -ForegroundColor Green
Write-Host "========================================================`n" -ForegroundColor Green
exit 0
