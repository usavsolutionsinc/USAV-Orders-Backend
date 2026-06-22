import {
  importZohoPurchaseOrderToReceiving,
  importZohoPurchaseReceiveToReceiving,
} from '@/lib/zoho-receiving-sync';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import type { NormalizedZohoEvent } from './types';

export interface HandlerResult {
  /** Short label for logs / debugging. */
  action: string;
  /** Extra context (counts, ids) — included verbatim in the response body. */
  detail?: Record<string, unknown>;
  /** When the handler didn't actually do anything (e.g., unknown event). */
  skipped?: boolean;
}

/**
 * Webhook dispatch table. Each handler runs *after* signature verification
 * and dedupe — so handlers can assume the event is real, in-order enough
 * for our purposes, and being processed exactly once.
 *
 * Handlers should be idempotent: Zoho may re-deliver the same event after
 * a non-2xx retry. Our dedupe table catches most of those, but a handler
 * that runs partially and then fails must be safe to re-run.
 */
export async function dispatchWebhookEvent(
  event: NormalizedZohoEvent,
  orgId: OrgId,
): Promise<HandlerResult> {
  switch (event.eventType) {
    case 'purchaseorder.created':
    case 'purchaseorder.updated':
      return handlePurchaseOrderUpsert(event, orgId);
    case 'purchaseorder.deleted':
      return handlePurchaseOrderDeleted(event, orgId);
    case 'purchasereceive.created':
      return handlePurchaseReceiveCreated(event, orgId);
    case 'purchasereceive.deleted':
      return handlePurchaseReceiveDeleted(event, orgId);
    case 'unknown':
    default:
      return {
        action: 'noop',
        skipped: true,
        detail: { rawEventType: event.rawEventType },
      };
  }
}

async function handlePurchaseOrderUpsert(
  event: NormalizedZohoEvent,
  orgId: OrgId,
): Promise<HandlerResult> {
  if (!event.objectId) {
    return { action: 'po.upsert.skipped', skipped: true, detail: { reason: 'no object id' } };
  }
  // The existing helper fetches the full PO from Zoho and writes
  // receiving/receiving_lines rows. Webhook → 1 Zoho call (the fetch) instead
  // of repeated `searchPurchaseOrdersByTracking` polls per scan.
  const result = await importZohoPurchaseOrderToReceiving(orgId, event.objectId);
  return {
    action: 'po.upserted',
    detail: { purchaseorder_id: event.objectId, result },
  };
}

async function handlePurchaseOrderDeleted(
  event: NormalizedZohoEvent,
  orgId: OrgId,
): Promise<HandlerResult> {
  if (!event.objectId) {
    return { action: 'po.delete.skipped', skipped: true, detail: { reason: 'no object id' } };
  }
  // Soft-detach: mark every receiving_line that referenced this PO so we
  // don't keep matching scans against a deleted Zoho record. We don't drop
  // the local row because warehouse scans / serials may still live there.
  // org-scoped so a deletion in one tenant's Zoho never touches another's lines.
  const res = await tenantQuery(
    orgId,
    `UPDATE receiving_lines
        SET zoho_sync_source = 'deleted',
            zoho_synced_at = NOW(),
            notes = COALESCE(notes, '') ||
                    CASE WHEN COALESCE(notes,'') = '' THEN '' ELSE E'\\n' END ||
                    '[zoho] PO ' || $1 || ' deleted in Zoho on ' || NOW()
      WHERE zoho_purchaseorder_id = $1
        AND organization_id = $2`,
    [event.objectId, orgId],
  );
  return {
    action: 'po.deleted',
    detail: { purchaseorder_id: event.objectId, rows_detached: res.rowCount ?? 0 },
  };
}

async function handlePurchaseReceiveCreated(
  event: NormalizedZohoEvent,
  orgId: OrgId,
): Promise<HandlerResult> {
  if (!event.objectId) {
    return { action: 'pr.create.skipped', skipped: true, detail: { reason: 'no object id' } };
  }
  // Mirror the new receive into our schema. The helper handles fetching the
  // full record from Zoho and writing the receiving / receiving_lines rows.
  const result = await importZohoPurchaseReceiveToReceiving({
    orgId,
    purchaseReceiveId: event.objectId,
  });
  return {
    action: 'pr.imported',
    detail: { purchase_receive_id: event.objectId, result },
  };
}

async function handlePurchaseReceiveDeleted(
  event: NormalizedZohoEvent,
  orgId: OrgId,
): Promise<HandlerResult> {
  if (!event.objectId) {
    return { action: 'pr.delete.skipped', skipped: true, detail: { reason: 'no object id' } };
  }
  // Detach local receiving row so it doesn't keep pretending it's tied to
  // a record Zoho no longer has. Same soft-delete shape as PO; org-scoped.
  const res = await tenantQuery(
    orgId,
    `UPDATE receiving
        SET zoho_purchase_receive_id = NULL,
            notes = COALESCE(notes, '') ||
                    CASE WHEN COALESCE(notes,'') = '' THEN '' ELSE E'\\n' END ||
                    '[zoho] Purchase receive ' || $1 || ' deleted in Zoho on ' || NOW()
      WHERE zoho_purchase_receive_id = $1
        AND organization_id = $2`,
    [event.objectId, orgId],
  );
  return {
    action: 'pr.deleted',
    detail: { purchase_receive_id: event.objectId, rows_detached: res.rowCount ?? 0 },
  };
}
