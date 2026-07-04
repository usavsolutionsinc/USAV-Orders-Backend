'use client';

/**
 * useAssistantContext — pages/regions register { page, station, selection,
 * mode, skill } for the global assistant (plan §-2.2). Same
 * last-registered-wins registry-hook pattern as useRegisterScanTarget; the
 * store lives in src/lib/assistant/context-store.ts.
 *
 * The registered context (+ the page's skill fragment) rides every
 * /api/assistant/chat request and is injected into the system prompt
 * server-side. Registration is layout-effect-scoped: unmount restores the
 * previous page's context automatically.
 */

import { useEffect, useSyncExternalStore } from 'react';
import {
  getAssistantContext,
  registerAssistantContext,
  subscribeAssistantContext,
  type AssistantPageContext,
} from '@/lib/assistant/context-store';

/** Register this page's context while mounted. Re-registers when values change. */
export function useAssistantContext(ctx: AssistantPageContext, enabled = true): void {
  const { page, station, mode, skill } = ctx;
  const selectionKind = ctx.selection?.kind ?? null;
  const selectionId = ctx.selection?.id ?? null;

  useEffect(() => {
    if (!enabled) return undefined;
    return registerAssistantContext({
      page,
      station: station ?? null,
      mode: mode ?? null,
      skill: skill ?? null,
      selection: selectionKind != null && selectionId != null ? { kind: selectionKind, id: selectionId } : null,
    });
  }, [enabled, page, station, mode, skill, selectionKind, selectionId]);
}

/** Read the currently-active page context (the dock sends it with each turn). */
export function useActiveAssistantContext(): AssistantPageContext | null {
  return useSyncExternalStore(subscribeAssistantContext, getAssistantContext, () => null);
}
