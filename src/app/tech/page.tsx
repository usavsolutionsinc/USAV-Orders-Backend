import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { TechPageContent } from '@/components/tech/TechPageContent';
import { getCurrentUser } from '@/lib/auth/current-user';

/**
 * /tech — the technician station landing.
 *
 * Identity comes from the verified session cookie. Staff switching happens
 * via the FAB's SwitchStaffSheet, not the URL. The proxy already redirects
 * unauthenticated traffic; this redirect is belt-and-suspenders for the
 * (theoretical) case of a stale cookie that passes proxy but fails server
 * resolution.
 */
export default async function TechPage() {
  const user = await getCurrentUser();
  if (!user) {
    const h = await headers();
    const path = h.get('x-pathname') || '/tech';
    redirect(`/signin?next=${encodeURIComponent(path)}`);
  }

  return (
    <Suspense fallback={null}>
      <TechPageContent techId={String(user.staffId)} />
    </Suspense>
  );
}
