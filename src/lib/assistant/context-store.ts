/**
 * Assistant context registry — the module-scope store behind
 * useAssistantContext (plan §-2 "Context injection is a registry hook, not
 * prop-drilling"). Modeled on src/lib/scan-hotkey/store.ts: pure module, a
 * LIFO registration stack (last-registered wins), a listener Set, and
 * useSyncExternalStore-compatible subscribe/get.
 *
 * Pages/regions register { page, station, selection, mode }; per-page SKILL
 * FRAGMENTS (prompt text the server injects into the system prompt) register
 * through the same stack. Both ride every /api/assistant/chat request.
 *
 * Pure module: no React, no DB — unit-testable and safe anywhere.
 */

export interface AssistantPageContext {
  /** Route/page identity, e.g. 'operations', 'studio', 'packer-station'. */
  page: string;
  /** Station identity when the page is a bench, e.g. 'PACKING'. */
  station?: string | null;
  /** Durable selection on the page (id + kind), e.g. { kind: 'receiving', id: 42 }. */
  selection?: { kind: string; id: string | number } | null;
  /** Current URL mode/view param, e.g. 'analytics'. */
  mode?: string | null;
  /**
   * Skill fragment: prompt text teaching the assistant this page's vocabulary
   * and jobs. Injected server-side into the system prompt for this request.
   */
  skill?: string | null;
}

interface RegisteredContext {
  id: number;
  ctx: AssistantPageContext;
}

const stack: RegisteredContext[] = [];
const listeners = new Set<() => void>();
let nextId = 1;
/** Cached snapshot — useSyncExternalStore requires referential stability. */
let snapshot: AssistantPageContext | null = null;

function emit(): void {
  snapshot = stack.length > 0 ? stack[stack.length - 1].ctx : null;
  listeners.forEach((l) => l());
}

/** Last-registered-wins; returns the unregister fn (call on unmount). */
export function registerAssistantContext(ctx: AssistantPageContext): () => void {
  const entry: RegisteredContext = { id: nextId++, ctx };
  stack.push(entry);
  emit();
  return () => {
    const idx = stack.findIndex((e) => e.id === entry.id);
    if (idx >= 0) stack.splice(idx, 1);
    emit();
  };
}

export function getAssistantContext(): AssistantPageContext | null {
  return snapshot;
}

export function subscribeAssistantContext(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
