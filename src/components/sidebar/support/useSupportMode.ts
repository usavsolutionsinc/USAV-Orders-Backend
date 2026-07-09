'use client';

/**
 * URL ⇄ state for the /support sidebar's mode switcher.
 *
 * Keeps `?mode=` as the single source of truth so a refresh / deep-link is
 * preserved and the page body can react to the same param. On a mode switch we
 * clear the mode-scoped params (selection, search, filters…) so each mode opens
 * clean. Mirrors `useOperationsMode`.
 */

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  SUPPORT_MODE_SCOPED_PARAMS,
  parseSupportMode,
  type SupportMode,
} from './support-sidebar-shared';

export interface SupportModeState {
  /** Active mode parsed from `?mode=` (defaults to `tickets`). */
  mode: SupportMode;
  /** Swap `?mode=`, clearing mode-scoped params; `tickets` drops the param. */
  updateMode: (next: SupportMode) => void;
}

export function useSupportMode(): SupportModeState {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = parseSupportMode(searchParams.get('mode'));

  const updateMode = useCallback(
    (next: SupportMode) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === 'tickets') params.delete('mode');
      else params.set('mode', next);
      for (const key of SUPPORT_MODE_SCOPED_PARAMS) params.delete(key);
      const qs = params.toString();
      router.replace(qs ? `/support?${qs}` : '/support');
    },
    [router, searchParams],
  );

  return { mode, updateMode };
}
