/**
 * Pipeline Module — Public API
 *
 * Import from '@/lib/pipeline' for clean access to pipeline functions.
 * The orchestrator is NOT exported here — it's a standalone entry point.
 */

// Config
export {
  REPO_PATH,
  MLX_BASE_URL,
  MLX_MODEL,
  CYCLE_INTERVAL_SEC,
  MAX_TASKS_PER_CYCLE,
  MAX_IMPLEMENTATIONS_PER_CYCLE,
  TRAINING_BASE_MODEL,
  MIN_TRAINING_SAMPLES,
} from './config';

// Types
export type {
  DiscoveredTask,
  TaskSource,
  Implementation,
  ValidationResult,
  ScoringResult,
  TrainingPairInput,
  CycleResult,
  PipelineStatus,
  PromotionResult,
} from './types';

// Core functions
export { discoverTasks } from './discover';
export { implementTask } from './agent';
export { validateChanges } from './validate';
export { scoreImplementation } from './scoring';
export { collectTrainingPair, collectFromCommit, collectFromChat } from './collect';
