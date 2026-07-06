import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { TechPageContent } from '@/components/tech/TechPageContent';
import { SurfaceGate } from '@/components/surfaces/SurfaceGate';
import { getCurrentUser } from '@/lib/auth/current-user';

/**
 * Shared Testing-surface page shell — mounted by BOTH `/tech` (legacy) and
 * `/test` (the first-class Test surface, Studio-driven operator surfaces refactor
 * Phase 8). The URL names the operator's job ("Testing"); the legacy `/tech`
 * (incl. `?view=testing` / `?view=testing-history`) redirects here via the proxy.
 *
 * Wrapped in `SurfaceGate surfaceKey="test"`: when the org has published a
 * composition AND enabled the `surface_composed_render` flag, the data-driven
 * `SurfaceRenderer` renders; otherwise the proven legacy `TechPageContent`
 * renders unchanged (the `'legacy'` escape hatch — the safe default).
 *
 * Identity comes from the verified session cookie. Staff switching happens via
 * the FAB's SwitchStaffSheet, not the URL. The proxy already redirects
 * unauthenticated traffic; this redirect is belt-and-suspenders for the
 * (theoretical) case of a stale cookie that passes proxy but fails server
 * resolution.
 */
export async function TechSurfacePage({
  fallbackPath = '/test',
}: {
  /** Path used to build the `?next=` on the belt-and-suspenders signin redirect. */
  fallbackPath?: string;
}) {
  const user = await getCurrentUser();
  if (!user) {
    const h = await headers();
    const path = h.get('x-pathname') || fallbackPath;
    redirect(`/signin?next=${encodeURIComponent(path)}`);
  }

  return (
    <Suspense fallback={null}>
      <SurfaceGate surfaceKey="test">
        <TechPageContent techId={String(user.staffId)} />
      </SurfaceGate>
    </Suspense>
  );
}
