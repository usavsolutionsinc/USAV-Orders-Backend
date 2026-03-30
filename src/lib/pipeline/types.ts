/**
 * Pipeline Type Definitions
 *
 * Shared interfaces for every stage of the self-improving loop:
 * discover → implement → validate → score → collect.
 */

// ─── Discovery ───────────────────────────────────────────────

export type TaskSource = 'typecheck' | 'lint' | 'test_failure' | 'todo_comment' | 'manual';

export interface DiscoveredTask {
  /** Deterministic hash for dedup (based on file + location + message). */
  hash: string;
  title: string;
  source: TaskSource;
  description: string;
  /** Relative paths from repo root. */
  filePaths: string[];
  /** Code snippet around the issue (±15 lines). */
  context: string;
  /** 1 = highest priority (test failures, type errors), 3 = lowest (TODOs). */
  priority: number;
}

// ─── Agent ───────────────────────────────────────────────────

export interface AgentFileChange {
  path: string;
  content: string;
}

export interface AgentResponse {
  files: AgentFileChange[];
  reasoning: string;
}

export interface Implementation {
  filesChanged: string[];
  /** Full git diff of the changes. */
  diff: string;
  reasoning: string;
  /** Raw model output before parsing. */
  rawOutput: string;
  /** Whether the agent produced a parseable response. */
  parsed: boolean;
}

// ─── Validation ──────────────────────────────────────────────

export interface ValidationResult {
  typecheckPass: boolean;
  typecheckErrors: string;
  lintPass: boolean;
  lintErrors: string;
  testsPass: boolean;
  testOutput: string;
  buildPass: boolean;
  buildErrors: string;
  /** True only when typecheck + lint + tests all pass. */
  allPassed: boolean;
}

// ─── Scoring ─────────────────────────────────────────────────

export interface ScoringResult {
  /** 1-5 integer rating derived from validation outcome. */
  rating: number;
  /** 0.0-1.0 weighted score from individual check weights. */
  autoScore: number;
  /** Human-readable explanation of why this score was given. */
  rationale: string;
}

// ─── Collection ──────────────────────────────────────────────

export interface TrainingPairInput {
  task: DiscoveredTask;
  implementation: Implementation;
  validation: ValidationResult;
  scoring: ScoringResult;
  repo: string;
  branch?: string;
  commitSha?: string;
}

// ─── Orchestrator ────────────────────────────────────────────

export interface CycleResult {
  cycleId: number;
  tasksDiscovered: number;
  tasksAttempted: number;
  tasksPassed: number;
  tasksFailed: number;
  samplesCollected: number;
  durationSeconds: number;
}

export type PipelineStatus = 'idle' | 'discovering' | 'implementing' | 'validating' | 'collecting';

// ─── Model Promotion ─────────────────────────────────────────

export interface PromotionResult {
  promoted: boolean;
  version?: string;
  previousVersion?: string;
  reason: string;
}
