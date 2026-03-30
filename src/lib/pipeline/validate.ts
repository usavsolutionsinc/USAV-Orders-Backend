/**
 * Validation Module
 *
 * Autonomous quality gate: runs typecheck, lint, tests, and optionally
 * a full build against the current working tree. Returns a structured
 * result the scoring module uses to rate the implementation.
 *
 * Execution order is deliberate — cheapest/fastest checks run first,
 * and the pipeline bails early on type errors (most changes that fail
 * typecheck also fail everything else).
 */

import { execSync } from 'child_process';
import {
  TYPECHECK_TIMEOUT_MS,
  LINT_TIMEOUT_MS,
  TEST_TIMEOUT_MS,
  BUILD_TIMEOUT_MS,
  RUN_BUILD_CHECK,
} from './config';
import type { ValidationResult } from './types';

// ─── Helpers ─────────────────────────────────────────────────

interface ExecResult {
  success: boolean;
  output: string;
}

function runCommand(cmd: string, cwd: string, timeoutMs: number): ExecResult {
  try {
    const output = execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_OPTIONS: '--max-old-space-size=4096',
        // Disable color codes for clean log parsing
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
    });
    return { success: true, output: output.slice(-2000) };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const output = (err.stdout || '') + '\n' + (err.stderr || '');
    return { success: false, output: output.slice(-2000) };
  }
}

// ─── Validators ──────────────────────────────────────────────

function checkTypeScript(repoPath: string): Pick<ValidationResult, 'typecheckPass' | 'typecheckErrors'> {
  const result = runCommand('npx tsc --noEmit --pretty false 2>&1', repoPath, TYPECHECK_TIMEOUT_MS);
  return {
    typecheckPass: result.success,
    typecheckErrors: result.success ? '' : result.output,
  };
}

function checkLint(repoPath: string): Pick<ValidationResult, 'lintPass' | 'lintErrors'> {
  const result = runCommand('npx next lint --no-cache 2>&1', repoPath, LINT_TIMEOUT_MS);
  return {
    lintPass: result.success,
    lintErrors: result.success ? '' : result.output,
  };
}

function checkTests(repoPath: string): Pick<ValidationResult, 'testsPass' | 'testOutput'> {
  // Run all known test scripts. All must pass.
  const testCommands = [
    'npx tsx --test src/utils/dashboard-search-state.test.ts 2>&1',
  ];

  const outputs: string[] = [];
  let allPass = true;

  for (const cmd of testCommands) {
    const result = runCommand(cmd, repoPath, TEST_TIMEOUT_MS);
    outputs.push(result.output);
    if (!result.success) allPass = false;
  }

  return {
    testsPass: allPass,
    testOutput: allPass ? '' : outputs.join('\n---\n'),
  };
}

function checkBuild(repoPath: string): Pick<ValidationResult, 'buildPass' | 'buildErrors'> {
  if (!RUN_BUILD_CHECK) {
    return { buildPass: false, buildErrors: '(build check disabled)' };
  }

  const result = runCommand('npx next build 2>&1', repoPath, BUILD_TIMEOUT_MS);
  return {
    buildPass: result.success,
    buildErrors: result.success ? '' : result.output,
  };
}

// ─── Main Entry Point ────────────────────────────────────────

/**
 * Run the full validation suite against the current repo state.
 *
 * Execution is sequential and bails early on type errors:
 *   typecheck → lint → tests → build (optional)
 *
 * Returns a structured result with pass/fail for each stage.
 */
export async function validateChanges(repoPath: string): Promise<ValidationResult> {
  // Phase 1: TypeScript (fastest, catches most issues)
  const tsc = checkTypeScript(repoPath);

  // Bail early — no point running lint/tests if types are broken
  if (!tsc.typecheckPass) {
    return {
      ...tsc,
      lintPass: false,
      lintErrors: '(skipped — typecheck failed)',
      testsPass: false,
      testOutput: '(skipped — typecheck failed)',
      buildPass: false,
      buildErrors: '(skipped — typecheck failed)',
      allPassed: false,
    };
  }

  // Phase 2: ESLint
  const lint = checkLint(repoPath);

  // Phase 3: Tests
  const tests = checkTests(repoPath);

  // Phase 4: Build (optional, expensive)
  const build = checkBuild(repoPath);

  const allPassed = tsc.typecheckPass && lint.lintPass && tests.testsPass;

  return {
    ...tsc,
    ...lint,
    ...tests,
    ...build,
    allPassed,
  };
}
