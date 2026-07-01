import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getCurrentUserBySid } from '@/lib/auth/current-user';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { resolveGs1 } from '@/lib/gs1/resolver';

/**
 * /01/[gtin]/21/[serial] — GS1 Digital Link landing for a unique unit.
 *
 * Internal scans land on /serial/{serial} (the canonical unit page —
 * proxy.ts also rewrites /m/u/* here). Public scans bounce to the
 * storefront. The shared resolver handles both branches; this page
 * just supplies the cookie-derived auth state.
 */
export default async function GtinSerialPage({
  params,
}: {
  params: Promise<{ gtin: string; serial: string }>;
}) {
  const { gtin, serial } = await params;
  const sid = (await cookies()).get(SESSION_COOKIE_NAME)?.value ?? null;
  const user = await getCurrentUserBySid(sid);
  const result = await resolveGs1(`/01/${gtin}/21/${serial}`, { isInternal: user !== null, orgId: user?.organizationId });
  redirect(result.redirect);
}
