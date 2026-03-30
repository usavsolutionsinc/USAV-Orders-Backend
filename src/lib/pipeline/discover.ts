/**
 * Task Discovery
 *
 * Scans the codebase for actionable issues and returns them as structured
 * tasks for the agent to implement. Runs once per pipeline cycle.
 *
 * Discovery sources (in priority order):
 *   1. TypeScript type errors      (priority 1)
 *   2. Failing tests               (priority 1)
 *   3. ESLint violations           (priority 2)
 *   4. TODO/FIXME/HACK comments    (priority 3)
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MAX_TASKS_PER_CYCLE, TYPECHECK_TIMEOUT_MS, LINT_TIMEOUT_MS, TEST_TIMEOUT_MS } from './config';
import type { DiscoveredTask, TaskSource } from './types';

// ─── Helpers ─────────────────────────────────────────────────

/** Simple deterministic hash → short base-36 string for dedup. */
function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36).slice(0, 12);
}

/**
 * Read ±15 lines around a target line in a file.
 * Returns empty string if the file can't be read (e.g. deleted/binary).
 */
function readContext(repoPath: string, relPath: string, lineNum: number): string {
  try {
    const content = readFileSync(join(repoPath, relPath), 'utf-8');
    const lines = content.split('\n');
    const start = Math.max(0, lineNum - 16);
    const end = Math.min(lines.length, lineNum + 15);
    return lines
      .slice(start, end)
      .map((l, i) => `${start + i + 1}: ${l}`)
      .join('\n');
  } catch {
    return '';
  }
}

/** Run a shell command, returning stdout or null on failure. */
function exec(cmd: string, cwd: string, timeoutMs: number): string | null {
  try {
    return execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string };
    return err.stdout || err.stderr || null;
  }
}

// ─── TypeScript Errors ───────────────────────────────────────

interface TscError {
  file: string;
  line: number;
  message: string;
}

function parseTscOutput(raw: string): TscError[] {
  const errors: TscError[] = [];
  // tsc output format: src/lib/foo.ts(42,5): error TS2345: ...
  const pattern = /^(.+?)\((\d+),\d+\):\s*error\s+TS\d+:\s*(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    errors.push({
      file: match[1].trim(),
      line: parseInt(match[2], 10),
      message: match[3].trim(),
    });
  }
  return errors;
}

function discoverTypeErrors(repoPath: string): DiscoveredTask[] {
  const output = exec('npx tsc --noEmit --pretty false 2>&1', repoPath, TYPECHECK_TIMEOUT_MS);
  if (!output) return [];

  const errors = parseTscOutput(output);
  // Deduplicate by file (one task per file, not per error)
  const byFile = new Map<string, TscError[]>();
  for (const err of errors) {
    const list = byFile.get(err.file) || [];
    list.push(err);
    byFile.set(err.file, list);
  }

  const tasks: DiscoveredTask[] = [];
  for (const [file, fileErrors] of byFile) {
    const first = fileErrors[0];
    const description = fileErrors.length === 1
      ? first.message
      : `${fileErrors.length} TypeScript errors:\n${fileErrors.map(e => `  line ${e.line}: ${e.message}`).join('\n')}`;

    tasks.push({
      hash: hashString(`tsc:${file}:${fileErrors.map(e => e.line).join(',')}`),
      title: `Fix TypeScript error${fileErrors.length > 1 ? 's' : ''} in ${file}`,
      source: 'typecheck',
      description,
      filePaths: [file],
      context: readContext(repoPath, file, first.line),
      priority: 1,
    });
  }
  return tasks;
}

// ─── Test Failures ───────────────────────────────────────────

interface TestScript {
  name: string;
  command: string;
  testFile: string;
}

/** All test commands from package.json that the pipeline can validate against. */
const TEST_SCRIPTS: TestScript[] = [
  {
    name: 'dashboard-state',
    command: 'npx tsx --test src/utils/dashboard-search-state.test.ts 2>&1',
    testFile: 'src/utils/dashboard-search-state.test.ts',
  },
];

function discoverTestFailures(repoPath: string): DiscoveredTask[] {
  const tasks: DiscoveredTask[] = [];

  for (const script of TEST_SCRIPTS) {
    try {
      execSync(script.command, {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: TEST_TIMEOUT_MS,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // Test passed — no task needed
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string };
      const output = (err.stdout || err.stderr || '').slice(-800);
      tasks.push({
        hash: hashString(`test:${script.name}`),
        title: `Fix failing test: ${script.name}`,
        source: 'test_failure',
        description: `Test "${script.name}" is failing.\n\nOutput:\n${output}`,
        filePaths: [script.testFile],
        context: readContext(repoPath, script.testFile, 1),
        priority: 1,
      });
    }
  }
  return tasks;
}

// ─── ESLint Violations ───────────────────────────────────────

interface LintIssue {
  file: string;
  line: number;
  rule: string;
  message: string;
}

function parseLintOutput(raw: string): LintIssue[] {
  const issues: LintIssue[] = [];
  // next lint output: "./src/lib/foo.ts  42:5  Warning  message  rule-name"
  const lines = raw.split('\n');
  let currentFile = '';
  for (const line of lines) {
    const fileMatch = line.match(/^\.\/(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      continue;
    }
    if (!currentFile) continue;
    const issueMatch = line.match(/^\s*(\d+):(\d+)\s+(?:Warning|Error)\s+(.+?)\s{2,}(.+)$/);
    if (issueMatch) {
      issues.push({
        file: currentFile,
        line: parseInt(issueMatch[1], 10),
        rule: issueMatch[4].trim(),
        message: issueMatch[3].trim(),
      });
    }
  }
  return issues;
}

function discoverLintIssues(repoPath: string): DiscoveredTask[] {
  const output = exec('npx next lint --no-cache 2>&1', repoPath, LINT_TIMEOUT_MS);
  if (!output) return [];

  const issues = parseLintOutput(output);
  if (issues.length === 0) return [];

  // Group by file
  const byFile = new Map<string, LintIssue[]>();
  for (const issue of issues) {
    const list = byFile.get(issue.file) || [];
    list.push(issue);
    byFile.set(issue.file, list);
  }

  const tasks: DiscoveredTask[] = [];
  for (const [file, fileIssues] of byFile) {
    const first = fileIssues[0];
    const description = fileIssues.length === 1
      ? `${first.rule}: ${first.message}`
      : `${fileIssues.length} lint issues:\n${fileIssues.map(i => `  line ${i.line} [${i.rule}]: ${i.message}`).join('\n')}`;

    tasks.push({
      hash: hashString(`lint:${file}:${fileIssues.map(i => i.rule).join(',')}`),
      title: `Fix lint issue${fileIssues.length > 1 ? 's' : ''} in ${file}`,
      source: 'lint',
      description,
      filePaths: [file],
      context: readContext(repoPath, file, first.line),
      priority: 2,
    });
  }
  return tasks;
}

// ─── TODO / FIXME / HACK Comments ───────────────────────────

function discoverTodoComments(repoPath: string): DiscoveredTask[] {
  const output = exec(
    'grep -rn "TODO\\|FIXME\\|HACK\\|XXX" src/ --include="*.ts" --include="*.tsx" 2>/dev/null || true',
    repoPath,
    10_000,
  );
  if (!output?.trim()) return [];

  const tasks: DiscoveredTask[] = [];
  for (const line of output.split('\n').filter(Boolean)) {
    // Format: src/lib/foo.ts:42:  // TODO: implement retry
    const match = line.match(/^(.+?):(\d+):\s*(.+)$/);
    if (!match) continue;

    const [, file, lineStr, rest] = match;
    const lineNum = parseInt(lineStr, 10);
    const comment = rest.replace(/^\s*\/\/\s*/, '').trim();

    tasks.push({
      hash: hashString(`todo:${file}:${lineNum}:${comment.slice(0, 40)}`),
      title: `Resolve: ${comment.slice(0, 80)}`,
      source: 'todo_comment',
      description: `${file}:${lineNum}\n\n${comment}`,
      filePaths: [file],
      context: readContext(repoPath, file, lineNum),
      priority: 3,
    });
  }
  return tasks;
}

// ─── Main Entry Point ────────────────────────────────────────

/**
 * Run all discovery sources and return a prioritized, deduplicated task list.
 * Capped at MAX_TASKS_PER_CYCLE to prevent runaway cycles.
 */
export async function discoverTasks(repoPath: string): Promise<DiscoveredTask[]> {
  const allTasks: DiscoveredTask[] = [];

  // Run in priority order so higher-priority tasks get slots first
  allTasks.push(...discoverTypeErrors(repoPath));
  allTasks.push(...discoverTestFailures(repoPath));
  allTasks.push(...discoverLintIssues(repoPath));
  allTasks.push(...discoverTodoComments(repoPath));

  // Deduplicate by hash
  const seen = new Set<string>();
  const unique = allTasks.filter((t) => {
    if (seen.has(t.hash)) return false;
    seen.add(t.hash);
    return true;
  });

  // Sort by priority (1 first) then return capped
  unique.sort((a, b) => a.priority - b.priority);
  return unique.slice(0, MAX_TASKS_PER_CYCLE);
}
