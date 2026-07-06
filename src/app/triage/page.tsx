import { ReceivingSurfacePage } from '@/components/receiving/ReceivingSurfacePage';
import { SurfaceGate } from '@/components/surfaces/SurfaceGate';

/**
 * `/triage` — the Receiving/Triage operator surface (scan/identify before
 * unboxing). Shares the scan-bar + recent-rail sidebar body with Unbox; only
 * the right pane differs. Bare `/triage` derives the `triage` mode path-first.
 *
 * Wrapped in `SurfaceGate` (composition + flag → SurfaceRenderer, else the
 * legacy tree). Legacy `/receiving?mode=triage` redirects here.
 */
export default function TriagePage() {
  return (
    <SurfaceGate surfaceKey="triage">
      <ReceivingSurfacePage mobileTitle="Triage" surface="triage" />
    </SurfaceGate>
  );
}
