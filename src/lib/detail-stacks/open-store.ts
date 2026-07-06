'use client';

/**
 * Active detail-stack store — opens a slide-over on the CURRENT page without
 * changing route or mode. Consumed by `GlobalDetailStackHost` (render) and
 * the assistant recents list (open).
 */

import type { DetailStackKind } from './registry';

export interface ActiveDetailStack {
  kind: DetailStackKind;
  id: string;
}

let active: ActiveDetailStack | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeActiveDetailStack(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getActiveDetailStack(): ActiveDetailStack | null {
  return active;
}

export function openDetailStack(stack: ActiveDetailStack): void {
  if (active?.kind === stack.kind && active.id === stack.id) {
    emit();
    return;
  }
  active = { kind: stack.kind, id: stack.id };
  emit();
}

export function closeDetailStack(): void {
  if (!active) return;
  active = null;
  emit();
}
