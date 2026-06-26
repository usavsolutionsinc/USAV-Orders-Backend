'use client';

/**
 * Parses the `/receiving` right-pane mode from `?mode=`. History + Incoming are
 * table-only (they hide the workspace overlay even if one is open in state, so a
 * quick peek doesn't lose unfinished edits). Extracted from ReceivingDashboard;
 * behaviour is unchanged.
 */

import { useSearchParams } from 'next/navigation';
import type { IncomingView } from '@/components/receiving/EmailTriagePanel';

export interface ReceivingDashboardMode {
  mode: string;
  isPickupMode: boolean;
  isTriageMode: boolean;
  isHistoryMode: boolean;
  isIncomingMode: boolean;
  isTableOnlyMode: boolean;
  /** Incoming right-pane sub-view from `?incview=` (`pos` default | `email`). */
  incomingView: IncomingView;
}

export function useReceivingDashboardMode(): ReceivingDashboardMode {
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode') ?? 'receive';
  const isHistoryMode = mode === 'history';
  const isIncomingMode = mode === 'incoming';
  const incomingView: IncomingView = searchParams.get('incview') === 'email' ? 'email' : 'pos';
  return {
    mode,
    isPickupMode: mode === 'pickup',
    isTriageMode: mode === 'triage',
    isHistoryMode,
    isIncomingMode,
    isTableOnlyMode: isHistoryMode || isIncomingMode,
    incomingView,
  };
}
