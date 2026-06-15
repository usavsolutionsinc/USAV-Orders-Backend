/**
 * Warranty staff notifications (Phase 4).
 *
 * Pushes an Ably inbox event (channel `inbox:{staffId}`, event `warranty_claim`)
 * to the person who LOGGED a claim whenever it moves through its lifecycle, so
 * they see progress live in the header Activity inbox. Customer-facing email is
 * intentionally out of scope for now (deferred).
 *
 * Always best-effort: a notification failure must never break the mutation that
 * triggered it. Each send also appends a NOTIFICATION_SENT row to the claim
 * timeline so the audit story is complete.
 */

import pool from '@/lib/db';
import { publishWarrantyClaimNotification } from '@/lib/realtime/publish';
import type { WarrantyClaimDetail } from './types';

export type WarrantyNotifyEvent =
  | 'submitted'
  | 'approved'
  | 'denied'
  | 'in_repair'
  | 'repair_logged'
  | 'repaired'
  | 'closed'
  | 'expired';

type NotifiableClaim = Pick<
  WarrantyClaimDetail,
  'id' | 'claimNumber' | 'status' | 'productTitle' | 'serialNumber' | 'createdByStaffId'
>;

/**
 * Notify the claim's logger of a status change. Skips the actor (they just did
 * it) and no-ops when there's no distinct recipient.
 */
export async function notifyWarrantyTransition(args: {
  /** Owning tenant (from ctx.organizationId) — namespaces the inbox channel. */
  organizationId: string;
  claim: NotifiableClaim;
  event: WarrantyNotifyEvent;
  actorStaffId: number | null;
}): Promise<void> {
  try {
    const creator = args.claim.createdByStaffId;
    if (!creator || creator === args.actorStaffId) return;

    const title = args.claim.productTitle || args.claim.serialNumber || args.claim.claimNumber;
    await publishWarrantyClaimNotification({
      organizationId: args.organizationId,
      staffIds: [creator],
      claimId: args.claim.id,
      claimNumber: args.claim.claimNumber,
      status: args.claim.status,
      event: args.event,
      title,
      actorStaffId: args.actorStaffId,
      source: 'warranty-logger',
    });

    await pool.query(
      // organization_id is derived from the parent claim so the row is org-stamped
      // even on the raw (non-GUC) pool — warranty_claim_events.organization_id is
      // NOT NULL with a loud-fail GUC default.
      `INSERT INTO warranty_claim_events (claim_id, event_type, payload, actor_staff_id, organization_id)
       VALUES ($1, 'NOTIFICATION_SENT', $2::jsonb, $3,
         (SELECT organization_id FROM warranty_claims WHERE id = $1))`,
      [args.claim.id, JSON.stringify({ event: args.event, recipients: [creator], channel: 'inbox' }), args.actorStaffId],
    );
  } catch (err) {
    console.warn('[warranty.notify] transition notification failed:', err);
  }
}

/**
 * Bulk variant for the cron expiry sweep — notify each lapsed claim's logger.
 * Best-effort; partial failures are swallowed.
 */
export async function notifyWarrantyExpired(
  claims: Array<{ organizationId: string; id: number; claimNumber: string; createdByStaffId: number | null; title: string | null }>,
): Promise<void> {
  await Promise.all(
    claims.map(async (c) => {
      try {
        if (!c.createdByStaffId) return;
        await publishWarrantyClaimNotification({
          organizationId: c.organizationId,
          staffIds: [c.createdByStaffId],
          claimId: c.id,
          claimNumber: c.claimNumber,
          status: 'EXPIRED',
          event: 'expired',
          title: c.title,
          actorStaffId: null,
          source: 'warranty-logger.cron',
        });
        await pool.query(
          // organization_id is derived from the parent claim so the row is org-stamped
          // even on the raw (non-GUC) pool — warranty_claim_events.organization_id is
          // NOT NULL with a loud-fail GUC default.
          `INSERT INTO warranty_claim_events (claim_id, event_type, payload, actor_staff_id, organization_id)
           VALUES ($1, 'NOTIFICATION_SENT', $2::jsonb, NULL,
             (SELECT organization_id FROM warranty_claims WHERE id = $1))`,
          [c.id, JSON.stringify({ event: 'expired', recipients: [c.createdByStaffId], channel: 'inbox' })],
        );
      } catch (err) {
        console.warn(`[warranty.notify] expiry notification failed for claim ${c.id}:`, err);
      }
    }),
  );
}
