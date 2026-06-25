'use client';

/**
 * URL ⇄ state for the Operations sidebar's mode switcher.
 *
 * Keeps `?mode=` as the single source of truth so a refresh / deep-link is
 * preserved and the right pane can react to the same param. On a mode switch we
 * clear the mode-scoped params (search, selection, range…) so each mode opens
 * clean. Mirrors `useReceivingMode`.
 */

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  OPERATIONS_MODE_SCOPED_PARAMS,
  parseOperationsMode,
  type OperationsMode,
} from './operations-sidebar-shared';

export interface OperationsModeState {
  /** Active mode parsed from `?mode=` (defaults to `live`). */
  mode: OperationsMode;
  /** Swap `?mode=`, clearing mode-scoped params; `live` drops the param. */
  updateMode: (next: OperationsMode) => void;
}

export function useOperationsMode(): OperationsModeState {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = parseOperationsMode(searchParams.get('mode'));

  const updateMode = useCallback(
    (next: OperationsMode) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === 'live') params.delete('mode');
      else params.set('mode', next);
      for (const key of OPERATIONS_MODE_SCOPED_PARAMS) params.delete(key);
      const qs = params.toString();
      router.replace(qs ? `/operations?${qs}` : '/operations');
    },
    [router, searchParams],
  );

  return { mode, updateMode };
}
