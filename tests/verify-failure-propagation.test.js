/**
 * @file verify-failure-propagation.test.js
 * @description Official R04 Test Vector: R04-G10.
 * Proves that failing tests and syntax errors executed via `node --test <file>`
 * return an authentic non-zero child process exit code, guaranteeing that
 * the test runner and verification pipeline never swallow failures.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import cp from 'node:child_process';

describe('Union Bot Phase P2 Gate R04: Test Failure Propagation (G10)', () => {
  it('R04-G10: Deliberately failing test executed via child process returns authentic non-zero exit code', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'union-bot-r04-g10-'));
    const failingTestFile = path.join(tmpDir, 'intentional_failure.test.cjs');

    try {
      // Write test file that throws an assertion error
      fs.writeFileSync(
        failingTestFile,
        `
        const { test } = require('node:test');
        const assert = require('node:assert/strict');

        test('intentional failing test for R04-G10', () => {
          assert.equal(1, 2, 'Intentional test failure to verify nonzero child exit');
        });
        `,
        'utf-8'
      );

      // Clean child env: strip parent node:test recursion guard
      const childEnv = { ...process.env };
      delete childEnv.NODE_TEST_CONTEXT;

      // Run child process directly
      const result = cp.spawnSync(process.execPath, ['--test', failingTestFile], {
        encoding: 'utf-8',
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Assert non-zero exit code (must be 1)
      assert.notEqual(result.status, 0, `Expected nonzero exit code, received: ${result.status}, stderr: ${result.stderr}`);
      assert.equal(result.status, 1, 'Node test runner must exit with code 1 upon assertion failure');

      const combinedOutput = `${result.stdout || ''}\n${result.stderr || ''}`;
      assert.match(combinedOutput, /intentional failing test for R04-G10/);
      assert.match(combinedOutput, /Intentional test failure/);
      assert.match(combinedOutput, /fail 1/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('R04-G10: Syntax error in test file cleanly produces non-zero child process exit code', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'union-bot-r04-g10-syntax-'));
    const syntaxErrorFile = path.join(tmpDir, 'syntax_error.test.cjs');

    try {
      // Write file with syntax error
      fs.writeFileSync(syntaxErrorFile, 'const invalid syntax {{{ = >', 'utf-8');

      const childEnv = { ...process.env };
      delete childEnv.NODE_TEST_CONTEXT;

      const result = cp.spawnSync(process.execPath, ['--test', syntaxErrorFile], {
        encoding: 'utf-8',
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      assert.notEqual(result.status, 0, `Syntax error must produce nonzero exit code, received: ${result.status}, stderr: ${result.stderr}`);
      assert.equal(result.status, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
