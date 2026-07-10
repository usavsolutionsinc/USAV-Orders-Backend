import { ReceivingSurfacePage } from '@/components/receiving/ReceivingSurfacePage';
import { SurfaceGate } from '@/components/surfaces/SurfaceGate';

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
 * Forensic Operations History lives at `/operations?mode=history` and is a
 * separate surface — this page always renders the receiving-lines unbox trail
 * (`view=activity`). Phones are UA-rewritten to `/m/receiving` in the proxy
 * before reaching here.
 *
 * Wrapped in `SurfaceGate` (composition + flag → SurfaceRenderer, else the
 * legacy tree — the safe default).
 */
export default function ReceivingHistoryPage() {
  return (
    <SurfaceGate surfaceKey="history">
      <ReceivingSurfacePage mobileTitle="History" />
    </SurfaceGate>
  );
}
