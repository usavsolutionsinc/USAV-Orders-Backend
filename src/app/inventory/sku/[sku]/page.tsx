import { redirect } from 'next/navigation';

/**
 * Phase A copy of /sku-stock/[sku] kept this route alive during the rename.
 * The canonical home is now /inventory?sku={sku} (the new shell view), so we
 * redirect to consolidate the operator experience.
 */
export default async function InventorySkuRedirect({
    params,
}: {
    params: Promise<{ sku: string }>;
}) {
    const { sku: rawSku } = await params;
    const sku = decodeURIComponent(rawSku || '').trim();
    if (!sku) redirect('/inventory');
    redirect(`/inventory?sku=${encodeURIComponent(sku)}`);
}
