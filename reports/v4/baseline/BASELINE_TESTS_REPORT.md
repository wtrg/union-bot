# UNION BOT V4 — BASELINE TESTS REPORT (U00-005)

- **Date**: 2026-10-21T04:55:00+07:00
- **Base Commit**: `d4c87ea7705cf7276628f214297952b724b49686`
- **Environment**: Windows 10/11 x64, Node v24.17.0, Electron 33

## Test Execution Results

1. **Static Typecheck (`pnpm typecheck`)**:
   - Command: `tsc --noEmit && tsc --noEmit -p apps/workspace-ui/tsconfig.json`
   - Exit Code: **0 (PASS)**
   - Monorepo packages and React UI typecheck cleanly with zero errors.

2. **Frontend UI Production Build (`pnpm build`)**:
   - Command: `vite build`
   - Exit Code: **0 (PASS)**
   - Chunks: `dist/assets/index-ZY_NtPsB.js` (235 kB), `index-CKJuQJYg.css` (10 kB).

3. **Electron Desktop UAT Suite (`pnpm uat`)**:
   - Command: `node --test tests/e2e/desktop-p10-uat.test.js`
   - Exit Code: **0 (PASS)**
   - 28 assertions verified across native task execution, scratch artifact CAS creation, Codex verification pipeline, and anti-double-dispatch locks.

4. **Independent Portable Verification**:
   - Verified outside repo via `scripts/verify-portable-standalone.cjs` with stripped PATH.
   - Result: 14/14 checks passed, exit code 0.
