'use client';

/**
 * Parses the receiving right-pane mode. The graduated surface routes (`/unbox`,
 * `/triage`) carry no `?mode=` — being on the route IS the mode — so the mode is
 * derived path-first, then from `?mode=` for the legacy `/receiving` page.
 * History + Incoming are table-only (they hide the workspace overlay even if one
 * is open in state, so a quick peek doesn't lose unfinished edits).
 */

import { useSearchParams, usePathname } from 'next/navigation';
import type { IncomingView } from '@/components/receiving/EmailTriagePanel';
import {
  UNBOX_SURFACE_ROUTE,
  TRIAGE_SURFACE_ROUTE,
  INCOMING_SURFACE_ROUTE,
  PICKUP_SURFACE_ROUTE,
  HISTORY_SURFACE_ROUTE,
} from '@/lib/receiving/surface-path';

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
  const pathname = usePathname() ?? '';
  // Graduated surface routes are path-based; the legacy page reads `?mode=`.
  const mode = pathname.startsWith(HISTORY_SURFACE_ROUTE)
    ? 'history'
    : pathname.startsWith(UNBOX_SURFACE_ROUTE)
      ? 'receive'
      : pathname.startsWith(TRIAGE_SURFACE_ROUTE)
        ? 'triage'
        : pathname.startsWith(INCOMING_SURFACE_ROUTE)
          ? 'incoming'
          : pathname.startsWith(PICKUP_SURFACE_ROUTE)
            ? 'pickup'
            : searchParams.get('mode') ?? 'receive';
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
