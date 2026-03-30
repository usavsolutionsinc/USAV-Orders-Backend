/**
 * Training Data Collector
 *
 * Extracts training pairs from pipeline implementations and stores them
 * in the training_samples table. Also provides a git-commit collector
 * that can be hooked into post-commit workflows.
 *
 * Both successful AND failed implementations are stored — the Jetson
 * trainer uses rating thresholds to select which samples to include
 * in each fine-tuning run.
 */

import { db } from '@/lib/drizzle/db';
import { trainingSamples } from '@/lib/drizzle/schema';
import type { TrainingPairInput } from './types';

// ─── Pipeline Collector ──────────────────────────────────────

/**
 * Store a training pair from a pipeline implementation cycle.
 * Called after every implement → validate → score pass, regardless
 * of whether the implementation passed validation.
 */
export async function collectTrainingPair(input: TrainingPairInput): Promise<number> {
  const { task, implementation, scoring, repo, branch, commitSha } = input;

  const [inserted] = await db.insert(trainingSamples).values({
    instruction: `${task.title}\n\n${task.description}`,
    inputContext: task.context || null,
    output: implementation.diff || implementation.reasoning,
    source: task.source,
    repo,
    filePaths: implementation.filesChanged,
    commitSha: commitSha || null,
    status: scoring.rating >= 3 ? 'rated' : 'raw',
    rating: scoring.rating,
    autoScore: String(scoring.autoScore),
    testsPass: input.validation.testsPass,
    ratedAt: scoring.rating >= 3 ? new Date() : null,
  }).returning({ id: trainingSamples.id });

  return inserted.id;
}

// ─── Git Commit Collector ────────────────────────────────────

/**
 * Extract a training pair from a git commit. Designed to be called
 * from a post-commit hook or a scheduled git-log scanner.
 *
 * This captures human-authored code changes (not just pipeline changes)
 * which provides diverse training data.
 */
export async function collectFromCommit(data: {
  message: string;
  diff: string;
  files: string[];
  repo: string;
  sha: string;
  testsPass?: boolean;
}): Promise<number> {
  // Auto-rate: commits with passing tests get a baseline rating of 3
  const rating = data.testsPass ? 3 : null;

  const [inserted] = await db.insert(trainingSamples).values({
    instruction: `Implement the following change: ${data.message}`,
    inputContext: null,
    output: data.diff,
    source: 'commit',
    repo: data.repo,
    filePaths: data.files,
    commitSha: data.sha,
    status: rating ? 'rated' : 'raw',
    rating,
    autoScore: data.testsPass ? '0.7' : '0.0',
    testsPass: data.testsPass ?? null,
    ratedAt: rating ? new Date() : null,
  }).returning({ id: trainingSamples.id });

  return inserted.id;
}

// ─── Chat Collector ──────────────────────────────────────────

/**
 * Collect a training pair from an interactive AI chat session.
 * Called when a user accepts or rates an AI response in the USAV chat UI.
 */
export async function collectFromChat(data: {
  userMessage: string;
  assistantResponse: string;
  accepted: boolean;
  repo?: string;
}): Promise<number> {
  const rating = data.accepted ? 4 : 1;

  const [inserted] = await db.insert(trainingSamples).values({
    instruction: data.userMessage,
    inputContext: null,
    output: data.assistantResponse,
    source: 'chat',
    repo: data.repo || null,
    filePaths: null,
    status: 'rated',
    rating,
    autoScore: data.accepted ? '0.8' : '0.2',
    testsPass: null,
    ratedAt: new Date(),
  }).returning({ id: trainingSamples.id });

  return inserted.id;
}
