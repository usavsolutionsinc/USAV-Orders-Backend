import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getCurrentUserBySid } from '@/lib/auth/current-user';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { resolveGs1 } from '@/lib/gs1/resolver';

/**
 * /01/[gtin] — GS1 Digital Link landing for a product class (no serial).
 *
 * Public: 302 to the storefront. Internal: hit the shared resolver, which
 * looks up the SKU and lands on /products/{sku}. Falls back to /inventory
 * when the GTIN isn't registered.
 *
 * Auth detection mirrors withAuth: read the session cookie, look up the
 * row in staff_sessions, treat absence as anonymous. The page itself is
 * listed in `PUBLIC_PATHS` so the edge proxy doesn't bounce anon traffic
 * to /signin before we get here.
 */
export default async function GtinPage({
  params,
}: {
  params: Promise<{ gtin: string }>;
}) {
  const { gtin } = await params;
  const sid = (await cookies()).get(SESSION_COOKIE_NAME)?.value ?? null;
  const user = await getCurrentUserBySid(sid);
  const result = await resolveGs1(`/01/${gtin}`, { isInternal: user !== null, orgId: user?.organizationId });
  redirect(result.redirect);
}
