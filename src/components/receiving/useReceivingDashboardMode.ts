'use client';

/**
 * Parses the `/receiving` right-pane mode from `?mode=`. History + Incoming are
 * table-only (they hide the workspace overlay even if one is open in state, so a
 * quick peek doesn't lose unfinished edits). Extracted from ReceivingDashboard;
 * behaviour is unchanged.
 */

import { useSearchParams } from 'next/navigation';

export interface ReceivingDashboardMode {
  mode: string;
  isPickupMode: boolean;
  isTriageMode: boolean;
  isHistoryMode: boolean;
  isIncomingMode: boolean;
  isTableOnlyMode: boolean;
}

export function useReceivingDashboardMode(): ReceivingDashboardMode {
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode') ?? 'receive';
  const isHistoryMode = mode === 'history';
  const isIncomingMode = mode === 'incoming';
  return {
    mode,
    isPickupMode: mode === 'pickup',
    isTriageMode: mode === 'triage',
    isHistoryMode,
    isIncomingMode,
    isTableOnlyMode: isHistoryMode || isIncomingMode,
  };
}
