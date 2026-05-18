import { redirect } from 'next/navigation';
import { headers } from 'next/headers';

/**
 * /q/[payload] — generic short-URL landing. Used when a printed QR carries
 * an opaque token that the warehouse scanner UI knows how to interpret but
 * a public browser does not.
 *
 * Behavior: forward the payload to the scanner UI as ?scan=... so the
 * deep-link can resolve client-side and route the user to the correct
 * screen. For non-scanner browsers, lands on the dashboard.
 *
 * Phase 1 stub. Phase 4+ may resolve the payload server-side via
 * /api/scan/resolve and redirect directly.
 */
export default async function GenericScanLandingPage({
  params,
}: {
  params: Promise<{ payload: string }>;
}) {
  const { payload } = await params;
  const cleaned = decodeURIComponent(payload || '').trim();
  if (!cleaned) redirect('/');

  // Prefer a mobile-scanner deep link when the user-agent looks mobile.
  const ua = (await headers()).get('user-agent') ?? '';
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua);
  const target = isMobile
    ? `/m/signin?scan=${encodeURIComponent(cleaned)}`
    : `/dashboard?scan=${encodeURIComponent(cleaned)}`;
  redirect(target);
}
