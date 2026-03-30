/**
 * Pipeline Configuration
 *
 * Central config for the self-improving pipeline. All tunables live here
 * so the orchestrator, agent, and validator share a single source of truth.
 *
 * Env vars override defaults for deployment flexibility (Mac vs CI vs Jetson).
 */

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envStr(key: string, fallback: string): string {
  return process.env[key]?.trim() || fallback;
}

// ─── Paths ───────────────────────────────────────────────────

/** Absolute path to the repo the pipeline improves. */
export const REPO_PATH = envStr(
  'PIPELINE_REPO_PATH',
  '/Users/icecube/repos/USAV-Orders-Backend',
);

/** Directory for exported LoRA adapters (shared between Mac + Jetson). */
export const ADAPTER_DIR = envStr(
  'PIPELINE_ADAPTER_DIR',
  '/Users/icecube/models/adapters',
);

// ─── Inference ───────────────────────────────────────────────

/** OpenAI-compatible endpoint for the local MLX LM server. */
export const MLX_BASE_URL = envStr(
  'MLX_BASE_URL',
  'http://127.0.0.1:8085/v1',
);

/** Model name sent in the chat completion request. */
export const MLX_MODEL = envStr('MLX_MODEL', 'default');

/** Max tokens the agent can generate per task. */
export const AGENT_MAX_TOKENS = envInt('PIPELINE_AGENT_MAX_TOKENS', 4096);

/** Temperature for code generation — low for deterministic fixes. */
export const AGENT_TEMPERATURE = 0.15;

// ─── Orchestrator ────────────────────────────────────────────

/** Seconds between discovery cycles. */
export const CYCLE_INTERVAL_SEC = envInt('PIPELINE_CYCLE_SEC', 600);

/** Max tasks to discover per cycle (prevents runaway on dirty repos). */
export const MAX_TASKS_PER_CYCLE = envInt('PIPELINE_MAX_TASKS', 8);

/** Max tasks to implement per cycle (each takes ~1-3 min). */
export const MAX_IMPLEMENTATIONS_PER_CYCLE = envInt('PIPELINE_MAX_IMPL', 5);

/** Max attempts per task before marking it as skipped. */
export const MAX_TASK_ATTEMPTS = envInt('PIPELINE_MAX_ATTEMPTS', 3);

/** Branch prefix for pipeline-generated changes. */
export const BRANCH_PREFIX = 'pipeline/';

// ─── Validation ──────────────────────────────────────────────

/** Timeout (ms) for `tsc --noEmit`. */
export const TYPECHECK_TIMEOUT_MS = envInt('PIPELINE_TSC_TIMEOUT', 60_000);

/** Timeout (ms) for `next lint`. */
export const LINT_TIMEOUT_MS = envInt('PIPELINE_LINT_TIMEOUT', 60_000);

/** Timeout (ms) for running tests. */
export const TEST_TIMEOUT_MS = envInt('PIPELINE_TEST_TIMEOUT', 30_000);

/** Timeout (ms) for `next build` (optional, expensive). */
export const BUILD_TIMEOUT_MS = envInt('PIPELINE_BUILD_TIMEOUT', 180_000);

/** Whether to run the full build as part of validation. */
export const RUN_BUILD_CHECK = process.env.PIPELINE_RUN_BUILD === 'true';

// ─── Training (Jetson) ──────────────────────────────────────

/** Minimum rated samples before the Jetson triggers a training run. */
export const MIN_TRAINING_SAMPLES = envInt('PIPELINE_MIN_SAMPLES', 20);

/** Base model for QLoRA fine-tuning (must fit in Jetson 8GB). */
export const TRAINING_BASE_MODEL = envStr(
  'PIPELINE_BASE_MODEL',
  'Qwen/Qwen2.5-Coder-3B',
);

/** Minimum sample rating to include in training data. */
export const TRAINING_RATING_THRESHOLD = envInt('PIPELINE_RATING_THRESHOLD', 2);

/** Identifier for the Jetson device (logged in training_runs). */
export const JETSON_DEVICE_ID = envStr('JETSON_DEVICE_ID', 'jetson-orin-nano');

// ─── Scoring ─────────────────────────────────────────────────

/** Weight breakdown for auto-scoring validation results. */
export const SCORE_WEIGHTS = {
  typecheck: 0.30,
  lint: 0.20,
  tests: 0.30,
  build: 0.20,
} as const;

/** Rating thresholds derived from validation outcomes. */
export const RATING_MAP = {
  allPass: 4,
  testsAndTypecheck: 3,
  typecheckOnly: 2,
  allFail: 1,
} as const;
