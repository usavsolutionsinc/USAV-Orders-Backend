import { redirect } from 'next/navigation';

/**
 * /s/[sku] — short-URL landing for a SKU. Forwards to /inventory/sku/{sku}.
 * The short form (/s/...) is encoded into printed SKU labels so the QR is
 * denser at the same scan reliability.
 */
export default async function SkuShortLandingPage({
  params,
}: {
  params: Promise<{ sku: string }>;
}) {
  const { sku } = await params;
  const cleaned = decodeURIComponent(sku || '').trim();
  if (!cleaned) redirect('/inventory');
  redirect(`/inventory/sku/${encodeURIComponent(cleaned)}`);
}
