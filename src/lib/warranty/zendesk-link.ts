/**
 * Warranty ↔ Zendesk — server-side linking. Persists the claim → ticket
 * mapping (warranty_claims.zendesk_ticket_id for cheap display/joins, plus the
 * universal ticket_links row the support workspace resolves) and appends the
 * matching warranty_claim_events rows.
 *
 * Sync model: read-time fetch, no webhook. The Zendesk thread stays the source
 * of truth for the conversation — the popover pulls comments live whenever it
 * opens (GET /api/warranty/claims/[id]/zendesk/comments), so there is nothing
 * to keep in sync in the background. This matches the tracking-live-sync
 * decision (polling over paid/managed webhooks) and avoids exposing + wiring a
 * Zendesk webhook target for marginal freshness gains.
 */

import pool from '@/lib/db';
import { linkTicket } from '@/lib/zendesk-links';

/** Append a warranty_claim_events row outside the mutations.ts transaction helpers. */
export async function recordClaimZendeskEvent(args: {
  claimId: number;
  eventType: 'ZENDESK_TICKET_CREATED' | 'ZENDESK_REPLY' | 'ZENDESK_STATUS';
  payload?: Record<string, unknown>;
  actorStaffId: number | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO warranty_claim_events (claim_id, event_type, payload, actor_staff_id)
     VALUES ($1, $2, $3::jsonb, $4)`,
    [args.claimId, args.eventType, JSON.stringify(args.payload ?? {}), args.actorStaffId],
  );
}

/**
 * Stamp a freshly created Zendesk ticket onto its claim. The column write is
 * authoritative (it gates "already linked" checks); the ticket_links upsert and
 * the timeline event are best-effort — the ticket already exists in Zendesk, so
 * a mapping hiccup must not turn the creation into an error.
 */
export async function recordClaimTicketLink(args: {
  claimId: number;
  zendeskTicketId: number;
  organizationId: string;
  actorStaffId: number | null;
}): Promise<void> {
  await pool.query(
    `UPDATE warranty_claims
        SET zendesk_ticket_id = $2, updated_at = NOW()
      WHERE id = $1`,
    [args.claimId, args.zendeskTicketId],
  );

  try {
    await linkTicket({
      orgId: args.organizationId,
      zendeskTicketId: args.zendeskTicketId,
      entityType: 'WARRANTY_CLAIM',
      entityId: args.claimId,
      staffId: args.actorStaffId,
    });
  } catch (err) {
    console.warn('[warranty.zendesk] ticket_links upsert failed', err);
  }

  try {
    await recordClaimZendeskEvent({
      claimId: args.claimId,
      eventType: 'ZENDESK_TICKET_CREATED',
      payload: { zendeskTicketId: args.zendeskTicketId },
      actorStaffId: args.actorStaffId,
    });
  } catch (err) {
    console.warn('[warranty.zendesk] timeline event insert failed', err);
  }
}
