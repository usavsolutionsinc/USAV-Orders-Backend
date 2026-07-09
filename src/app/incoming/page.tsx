import { ReceivingSurfacePage } from '@/components/receiving/ReceivingSurfacePage';
import { SurfaceGate } from '@/components/surfaces/SurfaceGate';

/**
 * `/incoming` — the Incoming operator surface (POs Zoho says are issued but not
 * yet received locally; attach-tracking worklist). A Workbench surface (list →
 * select → edit), not a scan bench. Bare `/incoming` derives the `incoming` mode
 * path-first. Legacy `/receiving?mode=incoming` redirects here.
 *
 * Wrapped in `SurfaceGate` (composition + flag → SurfaceRenderer, else the
 * legacy tree).
 */
export default function IncomingPage() {
  return (
    <SurfaceGate surfaceKey="incoming">
      <ReceivingSurfacePage mobileTitle="Incoming" />
    </SurfaceGate>
  );
}
