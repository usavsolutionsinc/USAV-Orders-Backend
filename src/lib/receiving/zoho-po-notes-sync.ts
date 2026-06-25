import { getPurchaseOrderById, updatePurchaseOrder } from '@/lib/zoho';

export type PoHeaderNotesZohoSkip = 'no_zoho_link' | 'po_not_editable';

export interface SyncPoHeaderNotesResult {
  ok: boolean;
  skipped?: PoHeaderNotesZohoSkip;
  patched?: boolean;
  error?: string;
}

/**
 * Push carton-level Zoho PO header notes (`receiving.zoho_notes`) to the linked
 * Zoho PO `notes` field. Full replace — manual edits own the whole blob.
 * Never throws; failures are returned for the route to map.
 */
export async function syncPoHeaderNotesToZoho(params: {
  zohoPoId: string | null | undefined;
  notes: string | null;
}): Promise<SyncPoHeaderNotesResult> {
  const zohoPoId = String(params.zohoPoId ?? '').trim();
  if (!zohoPoId) return { ok: true, skipped: 'no_zoho_link' };

  let existing: Awaited<ReturnType<typeof getPurchaseOrderById>>;
  try {
    existing = await getPurchaseOrderById(zohoPoId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fetch_failed';
    console.warn('[zoho-po-notes-sync] fetch failed', zohoPoId, message);
    return { ok: false, error: message };
  }

  const po = existing.purchaseorder;
  if (!po) return { ok: true, skipped: 'no_zoho_link' };

  const raw = String(po.status ?? '').trim();
  const normalized = raw.toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'cancelled' || normalized === 'void') {
    return { ok: true, skipped: 'po_not_editable' };
  }

  const nextNotes = params.notes == null ? '' : params.notes.trim();
  try {
    await updatePurchaseOrder(zohoPoId, { notes: nextNotes });
    return { ok: true, patched: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'update_failed';
    console.warn('[zoho-po-notes-sync] updatePurchaseOrder failed', zohoPoId, message);
    return { ok: false, error: message };
  }
}
