'use client';

/**
 * operations-search-status — a minimal module-scoped signal for "is the
 * operations browse fetch in flight?".
 *
 * Why a module store, not a context: the header search control is registered
 * by the operations sidebar (usePageHeaderSearch in OperationsSidebarPanel),
 * but the fetch loading lives in <SearchResultsSurface> mounted in the right
 * pane (OperationsResultsView). Those two sit in different subtrees with no
 * shared provider, so a tiny external store (useSyncExternalStore) is the
 * least-invasive bridge — the same pattern as scan-hotkey/store.ts. It lets
 * the header pill's trailing spinner reflect the operations fetch state
 * (docs/global-header-search-best-in-class-plan.md §17 — the isSearching gap).
 */

import { useSyncExternalStore } from 'react';

let searching = false;
const listeners = new Set<() => void>();

export function setOperationsSearchBusy(next: boolean): void {
  if (searching === next) return;
  searching = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reactively read whether an operations browse fetch is in flight. */
export function useOperationsSearchBusy(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => searching,
    () => false, // SSR: never "searching" on the server render
  );
}
