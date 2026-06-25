'use client';

/**
 * Right-pane router for the Operations master page. Reads `?mode=` (the single
 * source of truth, owned by the sidebar's mode rail) and renders the matching
 * view. `live` keeps the existing floor dashboard untouched; the other three
 * are the new modes. The page wraps this in <Suspense> for `useSearchParams`.
 */

import { useOperationsMode } from '@/components/sidebar/operations/useOperationsMode';
import { OperationsDashboard } from '@/features/operations/components/OperationsDashboard';
import { OperationsAnalyticsView } from './OperationsAnalyticsView';
import { OperationsInsightsView } from './OperationsInsightsView';
import { OperationsHistoryView } from './OperationsHistoryView';

export function OperationsWorkspace() {
  const { mode } = useOperationsMode();

  if (mode === 'analytics') return <OperationsAnalyticsView />;
  if (mode === 'insights') return <OperationsInsightsView />;
  if (mode === 'history') return <OperationsHistoryView />;
  return <OperationsDashboard />;
}
