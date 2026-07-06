import { redirect } from 'next/navigation';
import { ReceivingSurfacePage } from '@/components/receiving/ReceivingSurfacePage';
import { SurfaceGate } from '@/components/surfaces/SurfaceGate';
import { isOperationsHistoryBrowseEnabled } from '@/lib/operations/operations-history-flags';

/**
 * `/receiving/history` — the Receiving History operator surface (read-only trail
 * of received cartons / lines). A Monitor surface (observe, no durable
 * selection). Bare `/receiving/history` derives the `history` mode path-first;
 * its own `?q=`/`?field=`/`?scope=` search params ride along. Legacy
 * `/receiving?mode=history` redirects here (operator-surfaces refactor Phase 9).
 *
 * Nested under `/receiving` (its registry-declared canonical route) rather than
 * a top-level `/history`, so the URL reads as "receiving's history". The bare
 * `/receiving` → `/unbox` redirect is exact-path only, so this sub-route is
 * unaffected.
 *
 * Operations History consolidation (plan §5, Decision D4 Option A): once the
 * browse feed is on (`NEXT_PUBLIC_OPERATIONS_HISTORY_BROWSE`), `/receiving/history`
 * becomes an operator SHORTCUT into the single Operations History filter engine,
 * pre-scoped to the RECEIVING preset (same target as the `/audit-log/receiving`
 * redirect). Flag OFF ⇒ the legacy receiving-history surface renders unchanged.
 * (Phones are UA-rewritten to `/m/receiving` in the proxy before reaching here.)
 *
 * Wrapped in `SurfaceGate` (composition + flag → SurfaceRenderer, else the
 * legacy tree — the safe default).
 */
export default function ReceivingHistoryPage() {
  if (isOperationsHistoryBrowseEnabled()) {
    redirect('/operations?mode=history&stations=RECEIVING&sources=sal,inventory&view=sys:receiving-audit');
  }
  return (
    <SurfaceGate surfaceKey="history">
      <ReceivingSurfacePage mobileTitle="History" />
    </SurfaceGate>
  );
}
