'use client';

/**
 * Right-pane router for the Operations master page. Reads `?mode=` (the single
 * source of truth, owned by the sidebar's mode rail) and renders the matching
 * view. `live` keeps the existing floor dashboard untouched; the other modes
 * include signals (entity_signals timeline + browse).
 */

import { useOperationsMode } from '@/components/sidebar/operations/useOperationsMode';
import { useAssistantContext } from '@/hooks/useAssistantContext';
import { OPERATIONS_SKILL } from '@/lib/assistant/page-skills';
import { OperationsDashboard } from '@/features/operations/components/OperationsDashboard';
import { OperationsAnalyticsView } from './OperationsAnalyticsView';
import { OperationsInsightsView } from './OperationsInsightsView';
import { OperationsHistoryView } from './OperationsHistoryView';
import { SignalsWorkspace } from '@/features/signals/SignalsWorkspace';

export function OperationsWorkspace() {
  const { mode } = useOperationsMode();
  // Global-assistant context: KPI/benchmark skill fragment (plan §-2.2).
  useAssistantContext({ page: 'operations', mode, skill: OPERATIONS_SKILL });

  if (mode === 'analytics') return <OperationsAnalyticsView />;
  if (mode === 'insights') return <OperationsInsightsView />;
  if (mode === 'history') return <OperationsHistoryView />;
  if (mode === 'signals') return <SignalsWorkspace />;
  return <OperationsDashboard />;
}
