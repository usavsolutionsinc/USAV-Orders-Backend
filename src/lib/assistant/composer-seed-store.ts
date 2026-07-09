'use client';

/**
 * Composer seed bus — lets the header Sparkles entry hand the current search
 * query into AssistantDockBody without prop-drilling through RightRailHost.
 * Mirrors composer-focus-store: bump a seq, dock applies draft (+ optional send).
 */

export interface ComposerSeedPayload {
  text: string;
  /** When true, dock submits immediately after seeding (identifier / retrieval). */
  autoSend: boolean;
}

let seq = 0;
let latest: ComposerSeedPayload | null = null;
const listeners = new Set<() => void>();

export function subscribeComposerSeed(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getComposerSeedSeq(): number {
  return seq;
}

export function getLatestComposerSeed(): ComposerSeedPayload | null {
  return latest;
}

/** Seed the assistant composer; optionally auto-send on the next dock tick. */
export function requestComposerSeed(payload: ComposerSeedPayload): void {
  const text = payload.text.trim();
  if (!text) return;
  latest = { text, autoSend: payload.autoSend };
  seq += 1;
  for (const listener of listeners) listener();
}
