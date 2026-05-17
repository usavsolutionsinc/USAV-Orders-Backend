import { Suspense } from 'react';
import { TechPageContent } from '@/components/tech/TechPageContent';
import { getCurrentUser } from '@/lib/auth/current-user';

/**
 * /tech — the technician station landing.
 *
 * Identity comes from the session cookie (Phase D of the global-identity
 * migration). The legacy `?staffId=…` URL param is ignored for the operator
 * — staff switch happens via the FAB's SwitchStaffSheet, not the URL. The
 * `[id]` dynamic route still exists for deep links, but is no longer used
 * to change WHO is signed in.
 *
 * While AUTH_V2_ENABLED is off and no session exists, we fall back to staff
 * #1 so the page keeps rendering during rollout.
 */
export default async function TechPage() {
  const user = await getCurrentUser();
  const techId = user ? String(user.staffId) : '1';

  return (
    <Suspense fallback={null}>
      <TechPageContent techId={techId} />
    </Suspense>
  );
}
