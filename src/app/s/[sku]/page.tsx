import { redirect } from 'next/navigation';

/**
 * /s/[sku] — short-URL landing for a SKU. Always redirects to the existing
 * /sku-stock/{sku} page. The short form (/s/...) is encoded into printed
 * SKU labels so the QR is denser at the same scan reliability.
 */
export default async function SkuShortLandingPage({
  params,
}: {
  params: Promise<{ sku: string }>;
}) {
  const { sku } = await params;
  const cleaned = decodeURIComponent(sku || '').trim();
  if (!cleaned) redirect('/sku-stock');
  redirect(`/sku-stock/${encodeURIComponent(cleaned)}`);
}
