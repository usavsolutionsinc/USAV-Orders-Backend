/**
 * Warranty ↔ RMA / repair_service linkage (Phase 5).
 *
 * Closes the relational loop instead of duplicating entities:
 *   - A physical return links the claim to a first-class RMA
 *     (rma_authorizations, INBOUND_FROM_CUSTOMER) via warranty_claims.rma_id.
 *   - A repair handoff creates a repair_service ticket and links it via
 *     warranty_claims.repair_service_id, advancing APPROVED → IN_REPAIR.
 *
 * Each linkage writes a warranty_claim_events row; the GLOBAL audit + inbox
 * notification stay at the route layer.
 */

import type { PoolClient } from 'pg';
import pool from '@/lib/db';
import { createAuthorization, findByNumber, type RmaAuthorizationRow } from '@/lib/rma/authorizations';
import type { OrgId } from '@/lib/tenancy/constants';
import { getClaim } from './claims';
import type { WarrantyClaimDetail } from './types';

interface ClaimCore {
  id: number;
  status: string;
  orderId: number | null;
  customerId: number | null;
  serialNumber: string | null;
  sku: string | null;
  productTitle: string | null;
  sourceSystem: string | null;
  sourceOrderId: string | null;
  sourceTrackingNumber: string | null;
  rmaId: number | null;
  repairServiceId: number | null;
}

async function loadClaimCore(
  client: PoolClient,
  claimId: number,
  orgId?: OrgId | null,
): Promise<ClaimCore | null> {
  // warranty_claims carries organization_id — when org-scoped, filter on it so a
  // claim id from another tenant simply isn't found (404 at the call sites).
  const { rows } = await client.query<{
    id: number;
    status: string;
    order_id: number | null;
    customer_id: number | null;
    serial_number: string | null;
    sku: string | null;
    product_title: string | null;
    source_system: string | null;
    source_order_id: string | null;
    source_tracking_number: string | null;
    rma_id: number | null;
    repair_service_id: number | null;
  }>(
    orgId
      ? `SELECT id, status, order_id, customer_id, serial_number, sku, product_title,
            source_system, source_order_id, source_tracking_number, rma_id, repair_service_id
       FROM warranty_claims WHERE id = $1 AND organization_id = $2 FOR UPDATE`
      : `SELECT id, status, order_id, customer_id, serial_number, sku, product_title,
            source_system, source_order_id, source_tracking_number, rma_id, repair_service_id
       FROM warranty_claims WHERE id = $1 FOR UPDATE`,
    orgId ? [claimId, orgId] : [claimId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: Number(r.id),
    status: r.status,
    orderId: r.order_id == null ? null : Number(r.order_id),
    customerId: r.customer_id == null ? null : Number(r.customer_id),
    serialNumber: r.serial_number,
    sku: r.sku,
    productTitle: r.product_title,
    sourceSystem: r.source_system,
    sourceOrderId: r.source_order_id,
    sourceTrackingNumber: r.source_tracking_number,
    rmaId: r.rma_id == null ? null : Number(r.rma_id),
    repairServiceId: r.repair_service_id == null ? null : Number(r.repair_service_id),
  };
}

async function insertEvent(
  client: PoolClient,
  claimId: number,
  eventType: string,
  payload: Record<string, unknown>,
  actorStaffId: number | null,
): Promise<void> {
  await client.query(
    // organization_id is derived from the parent claim so the row is org-stamped
    // even on the raw (non-GUC) pool — warranty_claim_events.organization_id is
    // NOT NULL with a loud-fail GUC default, so omitting it here previously
    // inserted NULL and violated the constraint on every linkage write.
    `INSERT INTO warranty_claim_events (claim_id, event_type, payload, actor_staff_id, organization_id)
     VALUES ($1, $2, $3::jsonb, $4,
       (SELECT organization_id FROM warranty_claims WHERE id = $1))`,
    [claimId, eventType, JSON.stringify(payload), actorStaffId],
  );
}

// ─── Issue / link an RMA ─────────────────────────────────────────────────────

export type RmaLinkResult =
  | { ok: true; claim: WarrantyClaimDetail; rma: RmaAuthorizationRow }
  | { ok: false; status: 404 | 409 | 500; error: string };

export async function issueRmaForClaim(
  claimId: number,
  args: {
    createdByStaffId: number;
    expectedCarrier?: string | null;
    expiresAt?: string | null;
    notes?: string | null;
  },
  /**
   * Optional tenant scope. When present every warranty_claims read/write is
   * org-filtered (a cross-tenant claim id 404s) and the RMA insert + getClaim
   * are org-threaded. Omitted = legacy raw-pool behavior, byte-identical for
   * session-less callers.
   */
  orgId?: OrgId | null,
): Promise<RmaLinkResult> {
  const client = await pool.connect();
  let rma: RmaAuthorizationRow | null = null;
  try {
    await client.query('BEGIN');
    const claim = await loadClaimCore(client, claimId, orgId);
    if (!claim) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, error: 'claim not found' };
    }
    if (claim.rmaId) {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, error: 'claim already has an RMA' };
    }

    // createAuthorization manages its own connection + per-year number; call it
    // outside this transaction, then link the result in.
    await client.query('COMMIT');

    const created = await createAuthorization(
      {
        direction: 'INBOUND_FROM_CUSTOMER',
        orderId: claim.orderId,
        customerId: claim.customerId,
        expectedCarrier: args.expectedCarrier ?? null,
        expiresAt: args.expiresAt ?? null,
        createdByStaffId: args.createdByStaffId,
        notes: args.notes ?? `Warranty claim ${claimId}`,
      },
      orgId ?? null,
    );
    if (!created.ok) return { ok: false, status: 500, error: created.error };
    rma = created.rma;

    await client.query('BEGIN');
    // Re-check the claim wasn't linked concurrently.
    const recheck = await loadClaimCore(client, claimId, orgId);
    if (!recheck) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, error: 'claim not found' };
    }
    if (recheck.rmaId) {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, error: 'claim already has an RMA' };
    }
    await client.query(
      orgId
        ? `UPDATE warranty_claims SET rma_id = $2, updated_at = NOW() WHERE id = $1 AND organization_id = $3`
        : `UPDATE warranty_claims SET rma_id = $2, updated_at = NOW() WHERE id = $1`,
      orgId ? [claimId, rma.id, orgId] : [claimId, rma.id],
    );
    await insertEvent(
      client,
      claimId,
      'RMA_LINKED',
      { rmaId: rma.id, rmaNumber: rma.rmaNumber, issued: true },
      args.createdByStaffId,
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const message = err instanceof Error ? err.message : 'issue RMA failed';
    return { ok: false, status: 500, error: message };
  } finally {
    client.release();
  }

  const claim = await getClaim(claimId, orgId ?? undefined);
  if (!claim || !rma) return { ok: false, status: 500, error: 'claim vanished after RMA link' };
  return { ok: true, claim, rma };
}

export async function linkRmaByNumber(
  claimId: number,
  rmaNumber: string,
  actorStaffId: number | null,
  /** Optional tenant scope — org-filters every warranty_claims read/write. */
  orgId?: OrgId | null,
): Promise<RmaLinkResult> {
  const rma = await findByNumber(rmaNumber, orgId ?? null);
  if (!rma) return { ok: false, status: 404, error: 'RMA not found' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claim = await loadClaimCore(client, claimId, orgId);
    if (!claim) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, error: 'claim not found' };
    }
    if (claim.rmaId) {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, error: 'claim already has an RMA' };
    }
    await client.query(
      orgId
        ? `UPDATE warranty_claims SET rma_id = $2, updated_at = NOW() WHERE id = $1 AND organization_id = $3`
        : `UPDATE warranty_claims SET rma_id = $2, updated_at = NOW() WHERE id = $1`,
      orgId ? [claimId, rma.id, orgId] : [claimId, rma.id],
    );
    await insertEvent(
      client,
      claimId,
      'RMA_LINKED',
      { rmaId: rma.id, rmaNumber: rma.rmaNumber, issued: false },
      actorStaffId,
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const message = err instanceof Error ? err.message : 'link RMA failed';
    return { ok: false, status: 500, error: message };
  } finally {
    client.release();
  }

  const claim = await getClaim(claimId, orgId ?? undefined);
  if (!claim) return { ok: false, status: 404, error: 'claim not found' };
  return { ok: true, claim, rma };
}

// ─── Repair handoff ──────────────────────────────────────────────────────────

export type RepairHandoffResult =
  | { ok: true; claim: WarrantyClaimDetail; repairServiceId: number }
  | { ok: false; status: 404 | 409 | 500; error: string };

/**
 * Create a repair_service ticket from the claim and link it. Allowed from
 * APPROVED (advances → IN_REPAIR) or IN_REPAIR. The ticket reuses repair_service's
 * own status default ('Pending Repair'); display code is RS-<id> when there is no
 * ticket_number.
 */
export async function handoffToRepair(
  claimId: number,
  args: { issue?: string | null; notes?: string | null; createdByStaffId: number | null },
  /**
   * Optional tenant scope — org-filters the claim precheck (cross-tenant claim
   * 404s) and the warranty_claims UPDATE. The repair_service /
   * warranty_claim_events inserts already org-derive via subquery on the parent
   * claim, so they stay correct either way. Omitted = legacy behavior.
   */
  orgId?: OrgId | null,
): Promise<RepairHandoffResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claim = await loadClaimCore(client, claimId, orgId);
    if (!claim) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, error: 'claim not found' };
    }
    if (claim.repairServiceId) {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, error: 'claim already has a repair ticket' };
    }
    if (claim.status !== 'APPROVED' && claim.status !== 'IN_REPAIR') {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, error: `claim is ${claim.status}; repair handoff needs APPROVED or IN_REPAIR` };
    }

    const inserted = await client.query<{ id: number }>(
      // organization_id is derived from the warranty claim this handoff is for so
      // the row is org-stamped even on the raw (non-GUC) pool — repair_service.
      // organization_id is NOT NULL with a loud-fail GUC default, so omitting it
      // here previously inserted NULL and violated the constraint.
      `INSERT INTO repair_service (
         product_title, serial_number, issue, notes, source_system,
         source_order_id, source_tracking_number, source_sku, intake_channel, customer_id,
         organization_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'warranty_logger', $9,
         (SELECT organization_id FROM warranty_claims WHERE id = $10))
       RETURNING id`,
      [
        claim.productTitle,
        claim.serialNumber,
        args.issue ?? null,
        args.notes ?? `From warranty claim ${claimId}`,
        claim.sourceSystem,
        claim.sourceOrderId,
        claim.sourceTrackingNumber,
        claim.sku,
        claim.customerId,
        claimId,
      ],
    );
    const repairServiceId = Number(inserted.rows[0].id);

    const advanced = claim.status === 'APPROVED';
    await client.query(
      orgId
        ? `UPDATE warranty_claims
          SET repair_service_id = $2,
              status = $3,
              updated_at = NOW()
        WHERE id = $1 AND organization_id = $4`
        : `UPDATE warranty_claims
          SET repair_service_id = $2,
              status = $3,
              updated_at = NOW()
        WHERE id = $1`,
      orgId
        ? [claimId, repairServiceId, advanced ? 'IN_REPAIR' : claim.status, orgId]
        : [claimId, repairServiceId, advanced ? 'IN_REPAIR' : claim.status],
    );
    await insertEvent(
      client,
      claimId,
      'REPAIR_HANDOFF',
      { repairServiceId, advancedToInRepair: advanced },
      args.createdByStaffId,
    );
    if (advanced) {
      await client.query(
        `INSERT INTO warranty_claim_events (claim_id, event_type, from_status, to_status, payload, actor_staff_id, organization_id)
         VALUES ($1, 'STATUS_CHANGE', 'APPROVED', 'IN_REPAIR', '{"via":"repair_handoff"}'::jsonb, $2,
           (SELECT organization_id FROM warranty_claims WHERE id = $1))`,
        [claimId, args.createdByStaffId],
      );
    }
    await client.query('COMMIT');

    const detail = await getClaim(claimId, orgId ?? undefined);
    if (!detail) return { ok: false, status: 500, error: 'claim vanished after handoff' };
    return { ok: true, claim: detail, repairServiceId };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const message = err instanceof Error ? err.message : 'repair handoff failed';
    return { ok: false, status: 500, error: message };
  } finally {
    client.release();
  }
}

// ─── Reverses ────────────────────────────────────────────────────────────────

export type RmaUnlinkResult =
  | { ok: true; claim: WarrantyClaimDetail }
  | { ok: false; status: 404 | 409 | 500; error: string };

/**
 * Reverse of {@link issueRmaForClaim} / {@link linkRmaByNumber}: detach the RMA
 * from a claim (clear warranty_claims.rma_id + RMA_UNLINKED event). The
 * rma_authorizations row is LEFT intact — it can be cancelled on its own; this
 * only severs the claim's reference (mirrors "the ticket stays in Zendesk").
 * Refuses (409) when no RMA is linked, so re-linking a different RMA becomes
 * possible (the forward 409s while one is attached).
 */
export async function unlinkRma(
  claimId: number,
  actorStaffId: number | null,
  /** Optional tenant scope — org-filters every warranty_claims read/write. */
  orgId?: OrgId | null,
): Promise<RmaUnlinkResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claim = await loadClaimCore(client, claimId, orgId);
    if (!claim) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, error: 'claim not found' };
    }
    if (!claim.rmaId) {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, error: 'claim has no linked RMA' };
    }
    await client.query(
      orgId
        ? `UPDATE warranty_claims SET rma_id = NULL, updated_at = NOW() WHERE id = $1 AND organization_id = $2`
        : `UPDATE warranty_claims SET rma_id = NULL, updated_at = NOW() WHERE id = $1`,
      orgId ? [claimId, orgId] : [claimId],
    );
    await insertEvent(client, claimId, 'RMA_UNLINKED', { rmaId: claim.rmaId }, actorStaffId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return { ok: false, status: 500, error: err instanceof Error ? err.message : 'unlink RMA failed' };
  } finally {
    client.release();
  }
  const claim = await getClaim(claimId, orgId ?? undefined);
  if (!claim) return { ok: false, status: 404, error: 'claim not found' };
  return { ok: true, claim };
}

export type RepairDetachResult =
  | { ok: true; claim: WarrantyClaimDetail; revertedToApproved: boolean }
  | { ok: false; status: 404 | 409 | 500; error: string };

/**
 * Reverse of {@link handoffToRepair}: detach the repair ticket from a claim
 * (clear repair_service_id) and, when the handoff advanced the claim to
 * IN_REPAIR, revert it to APPROVED. The repair_service ticket itself is LEFT
 * intact — cancel it separately via DELETE /api/repair-service/[id] if needed
 * (mirrors "the ticket stays in Zendesk"). Refuses (409) when no repair ticket
 * is linked, or when the claim has progressed beyond IN_REPAIR
 * (REPAIRED/CLOSED) where a clean revert is no longer safe.
 */
export async function detachRepairHandoff(
  claimId: number,
  actorStaffId: number | null,
  /** Optional tenant scope — org-filters the claim precheck + warranty_claims UPDATE. */
  orgId?: OrgId | null,
): Promise<RepairDetachResult> {
  const client = await pool.connect();
  let revertedToApproved = false;
  try {
    await client.query('BEGIN');
    const claim = await loadClaimCore(client, claimId, orgId);
    if (!claim) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, error: 'claim not found' };
    }
    if (!claim.repairServiceId) {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, error: 'claim has no linked repair ticket' };
    }
    // Only IN_REPAIR (what the handoff produces) or APPROVED (a handoff from
    // IN_REPAIR that didn't advance) can be cleanly detached. A REPAIRED/CLOSED
    // claim has moved on — refuse rather than rewrite history.
    if (claim.status !== 'IN_REPAIR' && claim.status !== 'APPROVED') {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, error: `claim is ${claim.status}; cannot detach a repair past IN_REPAIR` };
    }
    revertedToApproved = claim.status === 'IN_REPAIR';
    const nextStatus = revertedToApproved ? 'APPROVED' : claim.status;
    await client.query(
      orgId
        ? `UPDATE warranty_claims SET repair_service_id = NULL, status = $2, updated_at = NOW() WHERE id = $1 AND organization_id = $3`
        : `UPDATE warranty_claims SET repair_service_id = NULL, status = $2, updated_at = NOW() WHERE id = $1`,
      orgId ? [claimId, nextStatus, orgId] : [claimId, nextStatus],
    );
    await insertEvent(client, claimId, 'REPAIR_DETACH', { repairServiceId: claim.repairServiceId, revertedToApproved }, actorStaffId);
    if (revertedToApproved) {
      await client.query(
        `INSERT INTO warranty_claim_events (claim_id, event_type, from_status, to_status, payload, actor_staff_id, organization_id)
         VALUES ($1, 'STATUS_CHANGE', 'IN_REPAIR', 'APPROVED', '{"via":"repair_detach"}'::jsonb, $2,
           (SELECT organization_id FROM warranty_claims WHERE id = $1))`,
        [claimId, actorStaffId],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return { ok: false, status: 500, error: err instanceof Error ? err.message : 'repair detach failed' };
  } finally {
    client.release();
  }
  const detail = await getClaim(claimId, orgId ?? undefined);
  if (!detail) return { ok: false, status: 500, error: 'claim vanished after detach' };
  return { ok: true, claim: detail, revertedToApproved };
}
