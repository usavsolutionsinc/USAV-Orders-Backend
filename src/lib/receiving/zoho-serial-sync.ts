import pool from '@/lib/db';
import {
  assertPurchaseOrderLineItemsEditable,
  buildPurchaseOrderLineItemsForDescriptionPut,
  getPurchaseOrderById,
  updatePurchaseOrder,
} from '@/lib/zoho';
import { formatPSTTimestamp } from '@/utils/date';

interface SyncParams {
  receivingLineId: number;
  serial: string;
  staffId: number | null;
  /** Optional carton-level extras to include in the PO notes line. */
  notes?: string | null;
  zendeskTicket?: string | null;
}

interface SyncResult {
  ok: boolean;
  skipped?: 'no_zoho_link' | 'no_line_item_id' | 'po_not_editable';
  patched?: { description: boolean; notes: boolean };
  error?: string;
}

interface ReceivingLineZohoContext {
  zoho_purchaseorder_id: string | null;
  zoho_line_item_id: string | null;
}

async function loadLineZohoContext(
  receivingLineId: number,
): Promise<ReceivingLineZohoContext | null> {
  const r = await pool.query<ReceivingLineZohoContext>(
    `SELECT zoho_purchaseorder_id, zoho_line_item_id
       FROM receiving_lines
      WHERE id = $1
      LIMIT 1`,
    [receivingLineId],
  );
  return r.rows[0] ?? null;
}

async function loadStaffName(staffId: number | null): Promise<string> {
  if (staffId == null) return 'Receiving';
  try {
    const r = await pool.query<{ name: string | null }>(
      `SELECT name FROM staff WHERE id = $1 LIMIT 1`,
      [staffId],
    );
    return r.rows[0]?.name?.trim() || `Staff #${staffId}`;
  } catch {
    return `Staff #${staffId}`;
  }
}

/**
 * Build a one-line PO-notes entry for a single serial scan. Format mirrors
 * `mark-received-po`'s header note style so both surfaces leave a readable
 * audit trail in Zoho:
 *
 *   "{Staff Name} {PST timestamp} · SN: {serial}"          (plain)
 *   "{Staff Name} {PST timestamp} · Zendesk: TK · SN: {serial}"
 *   "{Staff Name} {PST timestamp} · SN: {serial} | Notes: {note}"
 */
function buildNotesEntry(args: {
  staffName: string;
  serial: string;
  notes?: string | null;
  zendeskTicket?: string | null;
}): string {
  const head: string[] = [`${args.staffName} ${formatPSTTimestamp()}`];
  if (args.zendeskTicket?.trim()) head.push(`Zendesk: ${args.zendeskTicket.trim()}`);
  const tail: string[] = [`SN: ${args.serial}`];
  if (args.notes?.trim()) tail.push(`Notes: ${args.notes.trim()}`);
  return `${head.join(' · ')} · ${tail.join(' | ')}`;
}

/**
 * Push a single serial to Zoho — appends it both to the matching PO line
 * item's description AND to the PO's header notes. Idempotent on both
 * surfaces: `buildPurchaseOrderLineItemsForDescriptionPut` skips lines whose
 * description already contains the serial, and the notes-builder no-ops
 * when an identical line is already present.
 *
 * Designed for fire-and-forget use from the scan-serial route's `after()`
 * block. Never throws — failures are logged and returned in the result.
 *
 * Skipped (no-op) when:
 *   - receiving_lines row has no zoho_purchaseorder_id (unmatched carton)
 *   - receiving_lines row has no zoho_line_item_id (orphaned line)
 *   - Zoho PO status is not editable (DRAFT only — closed POs can't be patched)
 */
export async function syncSerialToZohoPo(params: SyncParams): Promise<SyncResult> {
  const serial = params.serial.trim();
  if (!serial) return { ok: true, skipped: 'no_line_item_id' };

  const ctx = await loadLineZohoContext(params.receivingLineId);
  if (!ctx) return { ok: true, skipped: 'no_zoho_link' };
  const zohoPoId = (ctx.zoho_purchaseorder_id || '').trim();
  const lineItemId = (ctx.zoho_line_item_id || '').trim();
  if (!zohoPoId) return { ok: true, skipped: 'no_zoho_link' };
  if (!lineItemId) return { ok: true, skipped: 'no_line_item_id' };

  let staffName: string;
  let existing: Awaited<ReturnType<typeof getPurchaseOrderById>>;
  try {
    [staffName, existing] = await Promise.all([
      loadStaffName(params.staffId),
      getPurchaseOrderById(zohoPoId),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fetch_failed';
    console.warn('[zoho-serial-sync] fetch failed', zohoPoId, message);
    return { ok: false, error: message };
  }

  // Status guard — same check mark-received-po uses before description PUTs.
  // Closed / received / billed POs can't be patched line-by-line in Zoho;
  // bail cleanly so we don't surface confusing 4xx in the background log.
  try {
    assertPurchaseOrderLineItemsEditable(existing);
  } catch {
    return { ok: true, skipped: 'po_not_editable' };
  }

  const po = existing.purchaseorder;
  if (!po) return { ok: true, skipped: 'no_zoho_link' };

  // 1. Description patch — `buildPurchaseOrderLineItemsForDescriptionPut`
  //    rebuilds every line_item payload but only mutates description for
  //    the one(s) in `lineItemIdToSerialNote`. Internal merge helper is
  //    idempotent on already-present serials.
  const lineItemsPatch = buildPurchaseOrderLineItemsForDescriptionPut(po, {
    [lineItemId]: serial,
  });

  // 2. Notes patch — prepend a new audit line unless it's already there.
  const currentNotes = String(po.notes || '');
  const newLine = buildNotesEntry({
    staffName,
    serial,
    notes: params.notes ?? null,
    zendeskTicket: params.zendeskTicket ?? null,
  });
  // Cheap idempotency: skip if a line with the same staff + serial pair is
  // already in notes (handles the "scan twice within one minute" rescan).
  const dupeSignature = `· SN: ${serial}`;
  const sameAuthorLine = currentNotes
    .split('\n')
    .find((l) => l.includes(staffName) && l.includes(dupeSignature));
  const shouldAppendNotes = !sameAuthorLine;
  const nextNotes = shouldAppendNotes
    ? (currentNotes ? `${newLine}\n${currentNotes}` : newLine)
    : currentNotes;

  const patch: Record<string, unknown> = {};
  if (lineItemsPatch.length > 0) patch.line_items = lineItemsPatch;
  if (shouldAppendNotes) patch.notes = nextNotes;

  if (Object.keys(patch).length === 0) {
    // Nothing actually changed (serial already in description AND notes).
    return { ok: true, patched: { description: false, notes: false } };
  }

  try {
    await updatePurchaseOrder(zohoPoId, patch);
    return {
      ok: true,
      patched: {
        description: lineItemsPatch.length > 0,
        notes: shouldAppendNotes,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'update_failed';
    console.warn('[zoho-serial-sync] updatePurchaseOrder failed', zohoPoId, message);
    return { ok: false, error: message };
  }
}
