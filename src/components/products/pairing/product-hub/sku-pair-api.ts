/**
 * Pure network helper for manual pairing. Both manual-add forms (per-channel and
 * the standalone form) post a single inline-create accept entry to the same
 * atomic + audited path the Save button uses, then broadcast `sku-pairing-updated`.
 */
export interface ManualPairEntry {
  platform: string;
  platformItemId?: string | null;
  platformSku?: string | null;
  accountName?: string | null;
}

export async function manualAddPairing(skuCatalogId: number, entry: ManualPairEntry): Promise<void> {
  const res = await fetch('/api/sku-catalog/pair-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      skuCatalogId,
      accept: [{ ...entry, confidence: 100, reason: 'manual_add' }],
      reject: [],
      unpair: [],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.success) throw new Error(body?.error || `HTTP ${res.status}`);
  window.dispatchEvent(new CustomEvent('sku-pairing-updated'));
}
