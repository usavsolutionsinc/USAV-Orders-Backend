/**
 * Pipeline Orchestrator
 *
 * The main autonomous loop that coordinates the self-improving cycle:
 *
 *   ┌──────────┐    ┌───────────┐    ┌──────────┐    ┌───────┐    ┌─────────┐
 *   │ Discover │───▶│ Implement │───▶│ Validate │───▶│ Score │───▶│ Collect │
 *   └──────────┘    └───────────┘    └──────────┘    └───────┘    └─────────┘
 *        ▲                                                              │
 *        └──────────────────── next cycle ──────────────────────────────┘
 *
 * Run as: npx tsx src/lib/pipeline/orchestrator.ts
 *
 * The orchestrator:
 *   1. Discovers actionable tasks (type errors, lint issues, TODOs, test failures)
 *   2. Deduplicates against previously attempted tasks in the DB
 *   3. Creates a git branch per task, sends to the LLM agent
 *   4. Validates the agent's output (typecheck, lint, tests)
 *   5. Scores and stores the result as a training pair
 *   6. Commits passing changes to the feature branch
 *   7. Cleans up failed branches
 *   8. Logs the cycle to pipeline_cycles for observability
 *   9. Sleeps and repeats
 */

import { execSync } from 'child_process';
import { eq, and, lt, sql } from 'drizzle-orm';
import { db } from '@/lib/drizzle/db';
import { pipelineTasks, pipelineCycles } from '@/lib/drizzle/schema';
import { discoverTasks } from './discover';
import { implementTask } from './agent';
import { validateChanges } from './validate';
import { scoreImplementation } from './scoring';
import { collectTrainingPair } from './collect';
import {
  REPO_PATH,
  CYCLE_INTERVAL_SEC,
  MAX_IMPLEMENTATIONS_PER_CYCLE,
  MAX_TASK_ATTEMPTS,
  BRANCH_PREFIX,
} from './config';
import type { CycleResult, DiscoveredTask } from './types';

// ─── Logging ─────────────────────────────────────────────────

const log = {
  info: (msg: string) => console.log(`[pipeline] ${new Date().toISOString()} ${msg}`),
  warn: (msg: string) => console.warn(`[pipeline] ${new Date().toISOString()} WARN ${msg}`),
  error: (msg: string) => console.error(`[pipeline] ${new Date().toISOString()} ERROR ${msg}`),
};

// ─── Git Helpers ─────────────────────────────────────────────

function git(cmd: string): string {
  return execSync(`git ${cmd}`, {
    cwd: REPO_PATH,
    encoding: 'utf-8',
    timeout: 15_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function gitSafe(cmd: string): string | null {
  try {
    return git(cmd);
  } catch {
    return null;
  }
}

function currentBranch(): string {
  return git('rev-parse --abbrev-ref HEAD');
}

function ensureCleanWorkingTree(): boolean {
  const status = git('status --porcelain');
  if (status) {
    log.warn('Working tree is dirty, stashing changes');
    gitSafe('stash push -m "pipeline-autostash"');
    return true;
  }
  return false;
}

function checkoutMain(): void {
  git('checkout main');
}

// ─── Task Persistence ────────────────────────────────────────

/**
 * Upsert discovered tasks into the DB and filter out ones that have
 * been attempted too many times or are already resolved.
 */
async function persistAndFilterTasks(discovered: DiscoveredTask[]): Promise<DiscoveredTask[]> {
  const actionable: DiscoveredTask[] = [];

  for (const task of discovered) {
    // Check if this task already exists
    const existing = await db.query.pipelineTasks.findFirst({
      where: eq(pipelineTasks.taskHash, task.hash),
    });

    if (existing) {
      // Skip if resolved or maxed out on attempts
      if (existing.status === 'resolved' || existing.attempts >= MAX_TASK_ATTEMPTS) {
        continue;
      }
      actionable.push(task);
    } else {
      // Insert new task
      await db.insert(pipelineTasks).values({
        taskHash: task.hash,
        title: task.title,
        source: task.source,
        description: task.description,
        filePaths: task.filePaths,
        context: task.context || null,
        priority: task.priority,
        status: 'pending',
      });
      actionable.push(task);
    }
  }

  return actionable;
}

/**
 * Mark a task as attempted (increment attempts, update timestamp).
 */
async function markAttempted(hash: string): Promise<void> {
  await db.update(pipelineTasks)
    .set({
      attempts: sql`${pipelineTasks.attempts} + 1`,
      lastAttemptAt: new Date(),
      status: 'in_progress',
    })
    .where(eq(pipelineTasks.taskHash, hash));
}

/**
 * Mark a task as resolved with the result branch and rating.
 */
async function markResolved(hash: string, branch: string, rating: number): Promise<void> {
  await db.update(pipelineTasks)
    .set({
      status: 'resolved',
      resolvedAt: new Date(),
      resultBranch: branch,
      resultRating: rating,
    })
    .where(eq(pipelineTasks.taskHash, hash));
}

/**
 * Mark a task as failed (status back to pending for retry or skip).
 */
async function markFailed(hash: string, attempts: number): Promise<void> {
  const status = attempts >= MAX_TASK_ATTEMPTS ? 'skipped' : 'pending';
  await db.update(pipelineTasks)
    .set({ status })
    .where(eq(pipelineTasks.taskHash, hash));
}

// ─── Single Task Execution ───────────────────────────────────

async function executeTask(task: DiscoveredTask): Promise<{
  passed: boolean;
  sampleCollected: boolean;
}> {
  const branchName = `${BRANCH_PREFIX}${task.source}-${task.hash}`;
  let stashed = false;

  try {
    // Ensure we start from a clean main
    stashed = ensureCleanWorkingTree();
    checkoutMain();

    // Create or reset the feature branch
    gitSafe(`branch -D ${branchName}`);
    git(`checkout -b ${branchName}`);

    await markAttempted(task.hash);
    log.info(`  implementing: ${task.title}`);

    // Phase: Implement
    const implementation = await implementTask(task, REPO_PATH);

    if (!implementation.parsed || implementation.filesChanged.length === 0) {
      log.info(`  no changes produced — skipping`);
      await markFailed(task.hash, MAX_TASK_ATTEMPTS); // don't retry no-op
      checkoutMain();
      gitSafe(`branch -D ${branchName}`);
      return { passed: false, sampleCollected: false };
    }

    // Phase: Validate
    log.info(`  validating ${implementation.filesChanged.length} changed files...`);
    const validation = await validateChanges(REPO_PATH);

    // Phase: Score
    const scoring = scoreImplementation(validation);
    log.info(`  ${scoring.rationale}`);

    // Phase: Collect training pair (always, pass or fail)
    let commitSha: string | undefined;

    if (validation.allPassed) {
      // Commit the passing changes
      git('add -A');
      const commitMsg = `pipeline(${task.source}): ${task.title}`;
      git(`commit -m "${commitMsg.replace(/"/g, '\\"')}"`);
      commitSha = git('rev-parse --short HEAD');
      log.info(`  PASS — committed ${commitSha} on ${branchName}`);
      await markResolved(task.hash, branchName, scoring.rating);
    } else {
      // Discard failed changes
      gitSafe('checkout -- .');
      gitSafe('clean -fd');
      log.info(`  FAIL — changes discarded, training pair stored`);

      // Look up current attempt count
      const record = await db.query.pipelineTasks.findFirst({
        where: eq(pipelineTasks.taskHash, task.hash),
      });
      await markFailed(task.hash, record?.attempts ?? MAX_TASK_ATTEMPTS);
    }

    await collectTrainingPair({
      task,
      implementation,
      validation,
      scoring,
      repo: 'USAV-Orders-Backend',
      branch: validation.allPassed ? branchName : undefined,
      commitSha,
    });

    return { passed: validation.allPassed, sampleCollected: true };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`  task execution failed: ${message}`);
    return { passed: false, sampleCollected: false };

  } finally {
    // Always return to main
    const branch = currentBranch();
    if (branch !== 'main') {
      gitSafe('checkout -- .');
      checkoutMain();
    }
    // Clean up failed branches (keep passing ones)
    if (stashed) {
      gitSafe('stash pop');
    }
  }
}

// ─── Cycle Execution ─────────────────────────────────────────

async function runCycle(): Promise<CycleResult> {
  const startTime = Date.now();
  log.info('=== Cycle starting ===');

  // Create cycle record
  const [cycle] = await db.insert(pipelineCycles).values({
    startedAt: new Date(),
  }).returning({ id: pipelineCycles.id });
  const cycleId = cycle.id;

  // Phase 1: Discover
  log.info('discovering tasks...');
  const discovered = await discoverTasks(REPO_PATH);
  log.info(`found ${discovered.length} raw tasks`);

  // Phase 2: Filter against DB (dedup, skip exhausted tasks)
  const actionable = await persistAndFilterTasks(discovered);
  log.info(`${actionable.length} actionable tasks after filtering`);

  const toImplement = actionable.slice(0, MAX_IMPLEMENTATIONS_PER_CYCLE);

  // Phase 3: Execute tasks sequentially
  let passed = 0;
  let failed = 0;
  let samples = 0;

  for (const task of toImplement) {
    log.info(`[${passed + failed + 1}/${toImplement.length}] ${task.title}`);
    const result = await executeTask(task);
    if (result.passed) passed++;
    else failed++;
    if (result.sampleCollected) samples++;
  }

  // Update cycle record
  const durationSeconds = Math.round((Date.now() - startTime) / 1000);
  await db.update(pipelineCycles)
    .set({
      tasksDiscovered: discovered.length,
      tasksAttempted: toImplement.length,
      tasksPassed: passed,
      tasksFailed: failed,
      samplesCollected: samples,
      durationSeconds,
      completedAt: new Date(),
    })
    .where(eq(pipelineCycles.id, cycleId));

  const result: CycleResult = {
    cycleId,
    tasksDiscovered: discovered.length,
    tasksAttempted: toImplement.length,
    tasksPassed: passed,
    tasksFailed: failed,
    samplesCollected: samples,
    durationSeconds,
  };

  log.info(`=== Cycle ${cycleId} complete: ${passed} passed, ${failed} failed, ${samples} samples, ${durationSeconds}s ===`);
  return result;
}

// ─── Main Loop ───────────────────────────────────────────────

async function main(): Promise<void> {
  log.info('Pipeline orchestrator starting');
  log.info(`Repo: ${REPO_PATH}`);
  log.info(`Cycle interval: ${CYCLE_INTERVAL_SEC}s`);
  log.info(`Max tasks per cycle: ${MAX_IMPLEMENTATIONS_PER_CYCLE}`);

  // Verify we're on main and the repo is accessible
  try {
    const branch = currentBranch();
    if (branch !== 'main') {
      log.warn(`On branch "${branch}", switching to main`);
      checkoutMain();
    }
  } catch (err) {
    log.error(`Cannot access repo at ${REPO_PATH}: ${err}`);
    process.exit(1);
  }

  // Run first cycle immediately
  try {
    await runCycle();
  } catch (err) {
    log.error(`Cycle failed: ${err instanceof Error ? err.message : err}`);
  }

  // Then run on interval
  setInterval(async () => {
    try {
      await runCycle();
    } catch (err) {
      log.error(`Cycle failed: ${err instanceof Error ? err.message : err}`);
    }
  }, CYCLE_INTERVAL_SEC * 1000);
}

// Run when executed directly (not imported)
main().catch((err) => {
  log.error(`Fatal: ${err}`);
  process.exit(1);
});
