import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getCurrentUserBySid } from '@/lib/auth/current-user';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { resolveGs1 } from '@/lib/gs1/resolver';

/**
 * /414/[gln]/254/[code] — GS1 Digital Link landing for a warehouse
 * location. Encoded by gs1LocationUrl() and printed on every bin
 * sticker.
 *
 * Internal scans land on /inventory?bin={code}. Public scans bounce to
 * the storefront — a location code means nothing to a customer.
 */
export default async function LocationPage({
  params,
}: {
  params: Promise<{ gln: string; code: string }>;
}) {
  const { gln, code } = await params;
  const sid = (await cookies()).get(SESSION_COOKIE_NAME)?.value ?? null;
  const user = await getCurrentUserBySid(sid);
  const result = await resolveGs1(`/414/${gln}/254/${code}`, { isInternal: user !== null });
  redirect(result.redirect);
}
