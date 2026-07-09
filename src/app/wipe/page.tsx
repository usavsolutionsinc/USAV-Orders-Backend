import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getCurrentUser } from '@/lib/auth/current-user';
import { DataWipeStation } from '@/components/wipe/DataWipeStation';

/**
 * /wipe — the data-wipe (secure-erase) station landing.
 *
 * A focused Station-archetype surface: scan a unit serial → record a secure
 * wipe / factory-reset before grading. Identity comes from the verified session
 * cookie (same pattern as /tech and /packer); the proxy already redirects
 * unauthenticated traffic, and the POST /api/serial-units/[id]/data-wipe route
 * enforces the `tech.data_wipe` permission server-side.
 */
export default async function WipePage() {
  const user = await getCurrentUser();
  if (!user) {
    const h = await headers();
    const path = h.get('x-pathname') || '/wipe';
    redirect(`/signin?next=${encodeURIComponent(path)}`);
  }

  return (
    <Suspense fallback={null}>
      <DataWipeStation staffId={String(user.staffId)} userName={user.name} />
    </Suspense>
  );
}
