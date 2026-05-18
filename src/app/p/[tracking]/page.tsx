import { redirect } from 'next/navigation';
import { queryOne } from '@/lib/neon-client';

/**
 * /p/[tracking] — short-URL landing for a package / carrier tracking number.
 * Looks up shipping_tracking_numbers and forwards to the shipped detail page
 * if the order can be resolved. Falls back to /shipped browse.
 *
 * Phase 1 stub: redirect-only. Phase 5 may add an inline tracking-events
 * summary so the scanner sees latest carrier state without a second hop.
 */
export default async function PackageScanLandingPage({
  params,
}: {
  params: Promise<{ tracking: string }>;
}) {
  const { tracking } = await params;
  const cleaned = decodeURIComponent(tracking || '').trim();
  if (!cleaned) redirect('/shipped');

  try {
    // Resolve via normalized form so URL/QR variants all converge.
    const row = await queryOne<{ id: number }>`
      SELECT id FROM shipping_tracking_numbers
       WHERE tracking_number_normalized = UPPER(REGEXP_REPLACE(${cleaned}, '[^A-Za-z0-9]', '', 'g'))
       LIMIT 1
    `;
    if (row?.id) {
      redirect(`/shipped?tracking=${encodeURIComponent(cleaned)}`);
    }
  } catch {
    /* fall through */
  }
  redirect(`/shipped?tracking=${encodeURIComponent(cleaned)}`);
}
