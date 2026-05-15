import { redirect } from 'next/navigation';
import pool from '@/lib/db';

/**
 * /01/[gtin]/21/[serial] — GS1 Digital Link landing for a specific physical
 * unit. We trust the serial as canonical and forward directly to the
 * /m/u/{serial} mobile unit page; the gtin segment is informational only.
 */
export default async function GtinSerialPage({
  params,
}: {
  params: Promise<{ gtin: string; serial: string }>;
}) {
  const { serial } = await params;
  const cleaned = decodeURIComponent(serial || '').trim();
  if (!cleaned) redirect('/sku-stock');

  // Best-effort: confirm the serial exists before redirecting, so unknown
  // serials still land somewhere sensible instead of a 404.
  try {
    const r = await pool.query<{ id: number }>(
      `SELECT id FROM serial_units WHERE normalized_serial = UPPER(TRIM($1)) LIMIT 1`,
      [cleaned],
    );
    if (r.rows[0]?.id) {
      redirect(`/m/u/${encodeURIComponent(cleaned)}`);
    }
  } catch {
    /* swallow */
  }
  redirect(`/m/u/${encodeURIComponent(cleaned)}`);
}
