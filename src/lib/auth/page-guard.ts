/**
 * Server-only helper for page.tsx / layout.tsx files.
 *
 *   const user = await requirePermission('receiving.view');
 *   // user.staffId, user.role, user.permissions
 *
 * If the user is unauthenticated → redirect to /signin?next=…
 * If the user is authenticated but lacks the permission → /not-authorized
 *
 * Enforcement is unconditional. The proxy already requires a session cookie
 * for non-public paths; this helper additionally requires `perm` for pages
 * that opt in. The `opts.enforce` field is accepted for backwards-compat
 * but ignored — there is no shadow mode.
 */

import 'server-only';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getCurrentUser, type CurrentUser } from './current-user';
import type { PermissionString } from './permissions';
import { audit } from './audit';

export interface PageGuardOpts {
  /** @deprecated kept for callsite compatibility; enforcement is always on. */
  enforce?: boolean;
}

/**
 * Returns the current user if they have the permission; redirects otherwise.
 *
 * Unauthenticated → `/signin?next=<current path>`
 * Authenticated but lacks `perm` → `/not-authorized`
 */
export async function requirePermission(
  perm: PermissionString,
  _opts: PageGuardOpts = {},
): Promise<CurrentUser> {
  const user = await getCurrentUser();

  if (!user) {
    const h = await headers();
    const path = h.get('x-pathname') || '/';
    redirect(`/signin?next=${encodeURIComponent(path)}`);
  }

  if (!user.permissions.has(perm)) {
    await audit({
      staffId: user.staffId,
      event: 'permission.denied',
      result: 'denied',
      sid: user.session.sid,
      detail: { permission: perm, page: true },
    });
    redirect('/not-authorized');
  }

  return user;
}
