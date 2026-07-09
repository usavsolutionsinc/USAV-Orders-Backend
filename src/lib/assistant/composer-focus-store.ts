'use client';

/**
 * Composer focus bus — lets ⌘J, the header Sparkles entry, and the dock body
 * coordinate focusing the chat textarea without prop-drilling through RightRailHost.
 */

let seq = 0;
const listeners = new Set<() => void>();

export function subscribeComposerFocus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getComposerFocusSeq(): number {
  return seq;
}

/** Bump focus seq so `AssistantDockBody` focuses + places caret at end. */
export function requestComposerFocus(): void {
  seq += 1;
  for (const listener of listeners) listener();
}
