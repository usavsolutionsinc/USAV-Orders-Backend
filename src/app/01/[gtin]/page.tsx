import { redirect } from 'next/navigation';
import pool from '@/lib/db';

/**
 * /01/[gtin] — GS1 Digital Link landing for a product class (no serial).
 * Looks up the GTIN in sku_catalog, then forwards to /sku-stock/{sku}.
 * If the GTIN is unknown we land on the generic SKU stock browser.
 */
export default async function GtinPage({
  params,
}: {
  params: Promise<{ gtin: string }>;
}) {
  const { gtin } = await params;
  const cleaned = decodeURIComponent(gtin || '').replace(/\D/g, '');
  if (!cleaned) redirect('/sku-stock');

  try {
    const r = await pool.query<{ sku: string | null }>(
      `SELECT sku FROM sku_catalog WHERE gtin = $1 LIMIT 1`,
      [cleaned],
    );
    const sku = r.rows[0]?.sku?.trim();
    if (sku) {
      redirect(`/sku-stock/${encodeURIComponent(sku)}`);
    }
  } catch {
    /* fall through to the generic browser */
  }
  redirect('/sku-stock');
}
