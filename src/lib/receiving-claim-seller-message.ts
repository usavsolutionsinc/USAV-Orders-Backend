import { sanitizeSellerMessage } from '@/lib/ai/seller-message-guard';
import { normalizeReceivingTicketEntityRefs } from '@/lib/support/tickets';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

export interface ClaimSellerMessageRow {
  id: number;
  receivingId: number;
  receivingLineId: number | null;
  zendeskTicketId: number | null;
  sellerMessage: string;
  subjectSnapshot: string | null;
  model: string | null;
  updatedAt: string;
}

/** Unfound cartons use synthetic line id `-receiving_id`; seller rows are carton-scoped (line null). */
export function normalizeClaimSellerMessageRefs(args: {
  receivingId: number;
  lineId?: number | null;
}): { receivingId: number; lineId: number | null } {
  const { receivingId, lineId } = normalizeReceivingTicketEntityRefs({
    receivingId: args.receivingId,
    lineId: args.lineId,
  });
  if (receivingId == null) throw new Error('receivingId is required');
  return { receivingId, lineId };
}

function mapRow(row: Record<string, unknown>): ClaimSellerMessageRow {
  return {
    id: Number(row.id),
    receivingId: Number(row.receiving_id),
    receivingLineId: row.receiving_line_id != null ? Number(row.receiving_line_id) : null,
    zendeskTicketId: row.zendesk_ticket_id != null ? Number(row.zendesk_ticket_id) : null,
    sellerMessage: String(row.seller_message ?? ''),
    subjectSnapshot: row.subject_snapshot != null ? String(row.subject_snapshot) : null,
    model: row.model != null ? String(row.model) : null,
    updatedAt: String(row.updated_at),
  };
}

async function assertReceivingEntity(
  orgId: OrgId,
  receivingId: number,
  lineId: number | null,
): Promise<void> {
  const recv = await tenantQuery(
    orgId,
    `SELECT id FROM receiving WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [receivingId, orgId],
  );
  if (!recv.rows.length) throw new Error('Receiving not found');

  if (lineId != null) {
    const line = await tenantQuery(
      orgId,
      `SELECT id FROM receiving_lines
        WHERE id = $1 AND receiving_id = $2 AND organization_id = $3
        LIMIT 1`,
      [lineId, receivingId, orgId],
    );
    if (!line.rows.length) throw new Error('Receiving line not found');
  }
}

export async function getClaimSellerMessage(opts: {
  orgId: OrgId;
  receivingId: number;
  lineId?: number | null;
}): Promise<ClaimSellerMessageRow | null> {
  const { receivingId, lineId } = normalizeClaimSellerMessageRefs(opts);
  await assertReceivingEntity(opts.orgId, receivingId, lineId);

  const res = await tenantQuery(
    opts.orgId,
    `SELECT id, receiving_id, receiving_line_id, zendesk_ticket_id,
            seller_message, subject_snapshot, model, updated_at
       FROM receiving_claim_seller_messages
      WHERE organization_id = $1
        AND receiving_id = $2
        AND receiving_line_id IS NOT DISTINCT FROM $3
      LIMIT 1`,
    [opts.orgId, receivingId, lineId],
  );
  const row = res.rows[0];
  return row ? mapRow(row as Record<string, unknown>) : null;
}

export async function getClaimSellerMessageById(opts: {
  orgId: OrgId;
  id: number;
}): Promise<ClaimSellerMessageRow | null> {
  const res = await tenantQuery(
    opts.orgId,
    `SELECT id, receiving_id, receiving_line_id, zendesk_ticket_id,
            seller_message, subject_snapshot, model, updated_at
       FROM receiving_claim_seller_messages
      WHERE organization_id = $1 AND id = $2
      LIMIT 1`,
    [opts.orgId, opts.id],
  );
  const row = res.rows[0];
  return row ? mapRow(row as Record<string, unknown>) : null;
}

function messagePayload(row: ClaimSellerMessageRow) {
  return {
    id: row.id,
    sellerMessage: row.sellerMessage,
    subjectSnapshot: row.subjectSnapshot,
    model: row.model,
    zendeskTicketId: row.zendeskTicketId,
    receivingId: row.receivingId,
    receivingLineId: row.receivingLineId,
    updatedAt: row.updatedAt,
  };
}

export { messagePayload as claimSellerMessagePayload };
export { parseZendeskTicketId, sellerDraftMatchesTicket } from '@/lib/receiving-claim-seller-ticket-match';

export async function deleteClaimSellerMessage(opts: {
  orgId: OrgId;
  receivingId: number;
  lineId?: number | null;
}): Promise<boolean> {
  const { receivingId, lineId } = normalizeClaimSellerMessageRefs(opts);
  await assertReceivingEntity(opts.orgId, receivingId, lineId);

  const res = await tenantQuery(
    opts.orgId,
    `DELETE FROM receiving_claim_seller_messages
      WHERE organization_id = $1
        AND receiving_id = $2
        AND receiving_line_id IS NOT DISTINCT FROM $3
      RETURNING id`,
    [opts.orgId, receivingId, lineId],
  );
  return res.rows.length > 0;
}

export async function upsertClaimSellerMessage(opts: {
  orgId: OrgId;
  receivingId: number;
  lineId?: number | null;
  sellerMessage: string;
  subjectSnapshot?: string | null;
  model?: string | null;
  zendeskTicketId?: number | null;
  staffId?: number | null;
}): Promise<ClaimSellerMessageRow> {
  const { receivingId, lineId } = normalizeClaimSellerMessageRefs(opts);
  const { message } = sanitizeSellerMessage(opts.sellerMessage);
  if (!message) throw new Error('Seller message is empty');

  await assertReceivingEntity(opts.orgId, receivingId, lineId);

  const stampTicketId = 'zendeskTicketId' in opts;
  const ticketIdValue = stampTicketId ? (opts.zendeskTicketId ?? null) : null;

  const res = await tenantQuery(
    opts.orgId,
    `INSERT INTO receiving_claim_seller_messages (
        organization_id, receiving_id, receiving_line_id, zendesk_ticket_id,
        seller_message, subject_snapshot, model, created_by, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (organization_id, receiving_id, entity_line_key)
      DO UPDATE SET
        seller_message = EXCLUDED.seller_message,
        subject_snapshot = COALESCE(EXCLUDED.subject_snapshot, receiving_claim_seller_messages.subject_snapshot),
        model = COALESCE(EXCLUDED.model, receiving_claim_seller_messages.model),
        zendesk_ticket_id = CASE
          WHEN $9 THEN EXCLUDED.zendesk_ticket_id
          ELSE receiving_claim_seller_messages.zendesk_ticket_id
        END,
        updated_at = NOW()
      RETURNING id, receiving_id, receiving_line_id, zendesk_ticket_id,
                seller_message, subject_snapshot, model, updated_at`,
    [
      opts.orgId,
      receivingId,
      lineId,
      ticketIdValue,
      message,
      opts.subjectSnapshot ?? null,
      opts.model ?? null,
      opts.staffId ?? null,
      stampTicketId,
    ],
  );

  const row = res.rows[0];
  if (!row) throw new Error('Failed to save seller message');
  return mapRow(row as Record<string, unknown>);
}

/** Attach zendesk ticket id after claim is filed (best-effort). */
export async function linkClaimSellerMessageTicket(opts: {
  orgId: OrgId;
  receivingId: number;
  lineId?: number | null;
  zendeskTicketId: number;
}): Promise<void> {
  const { receivingId, lineId } = normalizeClaimSellerMessageRefs(opts);
  try {
    await tenantQuery(
      opts.orgId,
      `UPDATE receiving_claim_seller_messages
          SET zendesk_ticket_id = $4, updated_at = NOW()
        WHERE organization_id = $1
          AND receiving_id = $2
          AND receiving_line_id IS NOT DISTINCT FROM $3`,
      [opts.orgId, receivingId, lineId, opts.zendeskTicketId],
    );
  } catch (err) {
    console.warn('[receiving-claim-seller-message] ticket link failed', err);
  }
}
