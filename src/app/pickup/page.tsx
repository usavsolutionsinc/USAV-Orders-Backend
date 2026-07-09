import { ReceivingSurfacePage } from '@/components/receiving/ReceivingSurfacePage';
import { SurfaceGate } from '@/components/surfaces/SurfaceGate';

/**
 * `/pickup` — the Local Pickup operator surface (POs / orders collected in
 * person rather than shipped). A Workbench surface (list → select → edit), not a
 * scan bench. Bare `/pickup` derives the `pickup` mode path-first. Legacy
 * `/receiving?mode=pickup` redirects here (operator-surfaces refactor Phase 9).
 *
 * Wrapped in `SurfaceGate` (composition + flag → SurfaceRenderer, else the
 * legacy tree — the safe default).
 */
export default function PickupPage() {
  return (
    <SurfaceGate surfaceKey="pickup">
      <ReceivingSurfacePage mobileTitle="Local Pickup" />
    </SurfaceGate>
  );
}
