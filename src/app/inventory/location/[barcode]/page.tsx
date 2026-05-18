import { redirect } from 'next/navigation';

/**
 * Phase A copy of /sku-stock/location/[barcode] kept this route alive during
 * the rename. The canonical home is now /inventory?bin={barcode} (the new
 * shell view).
 */
export default async function InventoryLocationRedirect({
    params,
}: {
    params: Promise<{ barcode: string }>;
}) {
    const { barcode: rawBarcode } = await params;
    const barcode = decodeURIComponent(rawBarcode || '').trim();
    if (!barcode) redirect('/inventory');
    redirect(`/inventory?bin=${encodeURIComponent(barcode)}`);
}
