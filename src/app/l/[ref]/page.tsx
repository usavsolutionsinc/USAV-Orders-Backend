import { redirect } from 'next/navigation';
import { queryOne } from '@/lib/neon-client';

/**
 * /l/[ref] — internal-URL landing for a bin/location. The ref segment may
 * be either a barcode or a location name; we accept both. Redirects to the
 * existing /sku-stock/location/{barcode} page when the location resolves.
 *
 * Part of Phase 1 of the inventory v2 plan (GS1 + internal short-URL scan
 * resolution). Phase 4+ will replace the redirect with a richer landing
 * that shows bin contents + allowed actions per role.
 */
export default async function LocationScanLandingPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = await params;
  const cleaned = decodeURIComponent(ref || '').trim();
  if (!cleaned) redirect('/sku-stock');

  try {
    const row = await queryOne<{ barcode: string | null }>`
      SELECT barcode FROM locations
       WHERE barcode = ${cleaned} OR name = ${cleaned}
       LIMIT 1
    `;
    const barcode = row?.barcode?.trim();
    if (barcode) {
      redirect(`/sku-stock/location/${encodeURIComponent(barcode)}`);
    }
  } catch {
    /* fall through */
  }
  redirect('/sku-stock');
}
