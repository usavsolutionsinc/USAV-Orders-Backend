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

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
  TYPECHECK_TIMEOUT_MS,
  LINT_TIMEOUT_MS,
  TEST_TIMEOUT_MS,
  BUILD_TIMEOUT_MS,
  RUN_BUILD_CHECK,
} from './config';
import type { ValidationResult } from './types';

const execAsync = promisify(exec);

// ─── Helpers ─────────────────────────────────────────────────

interface ExecResult {
  success: boolean;
  output: string;
}

async function runCommand(cmd: string, cwd: string, timeoutMs: number): Promise<ExecResult> {
  try {
    const { stdout } = await execAsync(cmd, {
      cwd,
      encoding: 'utf-8',
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        NODE_OPTIONS: '--max-old-space-size=4096',
        // Disable color codes for clean log parsing
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
    });
    return { success: true, output: stdout.slice(-2000) };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const output = (err.stdout || '') + '\n' + (err.stderr || '');
    return { success: false, output: output.slice(-2000) };
  }
}

// ─── Validators ──────────────────────────────────────────────

async function checkTypeScript(repoPath: string): Promise<Pick<ValidationResult, 'typecheckPass' | 'typecheckErrors'>> {
  const result = await runCommand('npx tsc --noEmit --pretty false 2>&1', repoPath, TYPECHECK_TIMEOUT_MS);
  return {
    typecheckPass: result.success,
    typecheckErrors: result.success ? '' : result.output,
  };
}

async function checkLint(repoPath: string): Promise<Pick<ValidationResult, 'lintPass' | 'lintErrors'>> {
  const result = await runCommand('npx next lint --no-cache 2>&1', repoPath, LINT_TIMEOUT_MS);
  return {
    lintPass: result.success,
    lintErrors: result.success ? '' : result.output,
  };
}

async function checkTests(repoPath: string): Promise<Pick<ValidationResult, 'testsPass' | 'testOutput'>> {
  // Run all known test scripts. All must pass.
  const testCommands = [
    'npx tsx --test src/utils/dashboard-search-state.test.ts 2>&1',
  ];

  const outputs: string[] = [];
  let allPass = true;

  for (const cmd of testCommands) {
    const result = await runCommand(cmd, repoPath, TEST_TIMEOUT_MS);
    outputs.push(result.output);
    if (!result.success) allPass = false;
  }

  return {
    testsPass: allPass,
    testOutput: allPass ? '' : outputs.join('\n---\n'),
  };
}

async function checkBuild(repoPath: string): Promise<Pick<ValidationResult, 'buildPass' | 'buildErrors'>> {
  if (!RUN_BUILD_CHECK) {
    return { buildPass: false, buildErrors: '(build check disabled)' };
  }

  const result = await runCommand('npx next build 2>&1', repoPath, BUILD_TIMEOUT_MS);
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
  const tsc = await checkTypeScript(repoPath);

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

  // Phases 2-4 are independent of one another, so run them concurrently:
  //   ESLint, tests, and the optional (expensive) build.
  const [lint, tests, build] = await Promise.all([
    checkLint(repoPath),
    checkTests(repoPath),
    checkBuild(repoPath),
  ]);

  const allPassed = tsc.typecheckPass && lint.lintPass && tests.testsPass;

  return {
    ...tsc,
    ...lint,
    ...tests,
    ...build,
    allPassed,
  };
}
