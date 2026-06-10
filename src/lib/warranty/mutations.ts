/**
 * Warranty claims — write domain module (Phase 2).
 *
 * Create + lifecycle verbs + repair-attempt logging. Each write also appends a
 * row to `warranty_claim_events` (the per-claim timeline). The GLOBAL audit log
 * is written at the route layer via recordAudit (it needs ctx + request
 * headers), keeping attribution server-trusted.
 *
 * Status machine (guarded, never a free-form UPDATE):
 *   LOGGED → SUBMITTED → APPROVED → IN_REPAIR → REPAIRED → CLOSED
 *                      ↘ DENIED → CLOSED
 *   (EXPIRED is set by the Phase 3 cron; CLOSED is terminal.)
 */

import type { PoolClient } from 'pg';
import pool from '@/lib/db';
import { computeWarranty } from './clock';
import { resolveWarrantyDays } from './term';
import { getClaim } from './claims';
import { REPAIR_ALLOWED_FROM, WARRANTY_LIFECYCLE, repairNextStatus } from './transitions';
import type { WarrantyClaimDetail, WarrantyClaimStatus } from './types';

// ─── Claim-number generation (per-year, RMA-number precedent) ────────────────

async function nextClaimNumber(client: PoolClient): Promise<string> {
  const year = new Date().getFullYear();
  const { rows } = await client.query<{ next_seq: number }>(
    `SELECT COALESCE(MAX(
              (regexp_replace(claim_number, '^WC-\\d{4}-', ''))::int
            ), 0) + 1 AS next_seq
       FROM warranty_claims
      WHERE claim_number LIKE $1`,
    [`WC-${year}-%`],
  );
  const seq = rows[0]?.next_seq ?? 1;
  return `WC-${year}-${String(seq).padStart(5, '0')}`;
}

async function insertEvent(
  client: PoolClient,
  args: {
    claimId: number;
    eventType: string;
    fromStatus?: WarrantyClaimStatus | null;
    toStatus?: WarrantyClaimStatus | null;
    payload?: Record<string, unknown>;
    actorStaffId: number | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO warranty_claim_events
       (claim_id, event_type, from_status, to_status, payload, actor_staff_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [
      args.claimId,
      args.eventType,
      args.fromStatus ?? null,
      args.toStatus ?? null,
      JSON.stringify(args.payload ?? {}),
      args.actorStaffId,
    ],
  );
}

// ─── Clock-input + denormalized-field resolution from an order ───────────────

interface ResolvedClaimContext {
  customerId: number | null;
  sku: string | null;
  productTitle: string | null;
  sourceOrderId: string | null;
  sourceSystem: string | null;
  trackingNumber: string | null;
  deliveredAt: string | null;
  packedScannedAt: string | null;
}

/**
 * Best-effort: pull the customer, SKU, carrier delivered date, and packed scan
 * date for an order so a claim can stamp its clock at log time. Defensive — any
 * failure (e.g. STN managed outside this schema) just yields nulls and the
 * clock falls back to "unknown" until the tracking cron backfills it.
 */
export async function resolveClaimContext(orderId: number): Promise<ResolvedClaimContext | null> {
  try {
    const { rows } = await pool.query<{
      customer_id: number | null;
      sku: string | null;
      product_title: string | null;
      source_order_id: string | null;
      source_system: string | null;
      tracking_number: string | null;
      delivered_at: string | null;
      packed_scanned_at: string | null;
    }>(
      `SELECT
         o.customer_id,
         o.sku,
         o.product_title,
         o.order_id          AS source_order_id,
         o.account_source    AS source_system,
         stn.tracking_number_raw AS tracking_number,
         CASE WHEN stn.is_delivered THEN stn.latest_event_at::text END AS delivered_at,
         pl.packed_at::text  AS packed_scanned_at
       FROM orders o
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
       LEFT JOIN LATERAL (
         SELECT pl.created_at AS packed_at
         FROM packer_logs pl
         WHERE pl.shipment_id IS NOT NULL
           AND pl.shipment_id = o.shipment_id
           AND pl.tracking_type = 'ORDERS'
         ORDER BY pl.created_at DESC NULLS LAST, pl.id DESC
         LIMIT 1
       ) pl ON true
       WHERE o.id = $1
       LIMIT 1`,
      [orderId],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      customerId: r.customer_id == null ? null : Number(r.customer_id),
      sku: r.sku,
      productTitle: r.product_title,
      sourceOrderId: r.source_order_id,
      sourceSystem: r.source_system,
      trackingNumber: r.tracking_number,
      deliveredAt: r.delivered_at,
      packedScannedAt: r.packed_scanned_at,
    };
  } catch (err) {
    console.warn('[warranty] resolveClaimContext failed:', err);
    return null;
  }
}

// ─── Create ──────────────────────────────────────────────────────────────────

export interface CreateClaimInput {
  serialUnitId?: number | null;
  serialNumber?: string | null;
  orderId?: number | null;
  sku?: string | null;
  productTitle?: string | null;
  customerId?: number | null;
  sourceSystem?: string | null;
  sourceOrderId?: string | null;
  sourceTrackingNumber?: string | null;
  purchaseProofUrl?: string | null;
  purchaseProofAttachmentId?: string | null;
  purchasedAt?: string | null;
  deliveredAt?: string | null;
  packedScannedAt?: string | null;
  notes?: string | null;
  createdByStaffId: number;
  organizationId: string | null;
}

export type CreateClaimResult =
  | { ok: true; claim: WarrantyClaimDetail }
  | { ok: false; status: 400 | 500; error: string };

function firstNonNull<T>(...vals: (T | null | undefined)[]): T | null {
  for (const v of vals) if (v != null && v !== '') return v;
  return null;
}

export async function createClaim(input: CreateClaimInput): Promise<CreateClaimResult> {
  const ctx = input.orderId ? await resolveClaimContext(input.orderId) : null;

  // Explicit input wins over order-resolved values.
  const sku = firstNonNull(input.sku, ctx?.sku);
  const productTitle = firstNonNull(input.productTitle, ctx?.productTitle);
  const customerId = firstNonNull(input.customerId, ctx?.customerId);
  const sourceOrderId = firstNonNull(input.sourceOrderId, ctx?.sourceOrderId);
  const sourceSystem = firstNonNull(input.sourceSystem, ctx?.sourceSystem);
  const sourceTrackingNumber = firstNonNull(input.sourceTrackingNumber, ctx?.trackingNumber);
  const deliveredAt = firstNonNull(input.deliveredAt, ctx?.deliveredAt);
  const packedScannedAt = firstNonNull(input.packedScannedAt, ctx?.packedScannedAt);

  if (!input.serialNumber && !input.serialUnitId && !input.orderId && !sku) {
    return { ok: false, status: 400, error: 'a serial, order, or SKU is required to log a claim' };
  }

  const warrantyDays = await resolveWarrantyDays(input.organizationId);
  const clock = computeWarranty({ deliveredAt, packedScannedAt, warrantyDays });

  const client = await pool.connect();
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const claimNumber = await nextClaimNumber(client);
      try {
        await client.query('BEGIN');
        const { rows } = await client.query<{ id: number }>(
          `INSERT INTO warranty_claims (
             claim_number, serial_unit_id, serial_number, order_id, sku, product_title,
             customer_id, source_system, source_order_id, source_tracking_number,
             purchase_proof_url, purchase_proof_attachment_id, purchased_at,
             delivered_at, packed_scanned_at, warranty_starts_at, warranty_expires_at,
             clock_basis, warranty_days, notes, created_by_staff_id
           ) VALUES (
             $1, $2, $3, $4, $5, $6,
             $7, $8, $9, $10,
             $11, $12, $13,
             $14, $15, $16, $17,
             $18, $19, $20, $21
           )
           RETURNING id`,
          [
            claimNumber,
            input.serialUnitId ?? null,
            input.serialNumber ?? null,
            input.orderId ?? null,
            sku,
            productTitle,
            customerId,
            sourceSystem,
            sourceOrderId,
            sourceTrackingNumber,
            input.purchaseProofUrl ?? null,
            input.purchaseProofAttachmentId ?? null,
            input.purchasedAt ?? null,
            deliveredAt,
            packedScannedAt,
            clock.startsAt ? clock.startsAt.toISOString() : null,
            clock.expiresAt ? clock.expiresAt.toISOString() : null,
            clock.basis,
            warrantyDays,
            input.notes ?? null,
            input.createdByStaffId,
          ],
        );
        const id = Number(rows[0].id);
        await insertEvent(client, {
          claimId: id,
          eventType: 'STATUS_CHANGE',
          fromStatus: null,
          toStatus: 'LOGGED',
          payload: { clockBasis: clock.basis, warrantyDays },
          actorStaffId: input.createdByStaffId,
        });
        await client.query('COMMIT');

        const claim = await getClaim(id);
        if (!claim) return { ok: false, status: 500, error: 'claim vanished after insert' };
        return { ok: true, claim };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        const message = err instanceof Error ? err.message : '';
        if (/duplicate key value/i.test(message) && attempt < 2) continue;
        return { ok: false, status: 500, error: message || 'create claim failed' };
      }
    }
    return { ok: false, status: 500, error: 'failed to generate a unique claim number' };
  } finally {
    client.release();
  }
}

// ─── Metadata edit (PATCH) ───────────────────────────────────────────────────

export interface UpdateClaimMetaInput {
  serialNumber?: string | null;
  sku?: string | null;
  productTitle?: string | null;
  customerId?: number | null;
  sourceTrackingNumber?: string | null;
  purchaseProofUrl?: string | null;
  purchaseProofAttachmentId?: string | null;
  purchasedAt?: string | null;
  notes?: string | null;
}

export type UpdateClaimMetaResult =
  | { ok: true; claim: WarrantyClaimDetail }
  | { ok: false; status: 404 | 400; error: string };

const META_COLUMN_MAP: Record<keyof UpdateClaimMetaInput, string> = {
  serialNumber: 'serial_number',
  sku: 'sku',
  productTitle: 'product_title',
  customerId: 'customer_id',
  sourceTrackingNumber: 'source_tracking_number',
  purchaseProofUrl: 'purchase_proof_url',
  purchaseProofAttachmentId: 'purchase_proof_attachment_id',
  purchasedAt: 'purchased_at',
  notes: 'notes',
};

export async function updateClaimMeta(
  claimId: number,
  fields: UpdateClaimMetaInput,
  actorStaffId: number | null,
): Promise<UpdateClaimMetaResult> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, col] of Object.entries(META_COLUMN_MAP) as [keyof UpdateClaimMetaInput, string][]) {
    if (key in fields && fields[key] !== undefined) {
      values.push(fields[key]);
      sets.push(`${col} = $${values.length}`);
    }
  }
  if (sets.length === 0) return { ok: false, status: 400, error: 'no editable fields provided' };

  values.push(claimId);
  const { rowCount } = await pool.query(
    `UPDATE warranty_claims SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${values.length}`,
    values,
  );
  if (rowCount === 0) return { ok: false, status: 404, error: 'claim not found' };

  const client = await pool.connect();
  try {
    await insertEvent(client, {
      claimId,
      eventType: 'NOTE',
      payload: { fields: Object.keys(fields) },
      actorStaffId,
    });
  } finally {
    client.release();
  }

  const claim = await getClaim(claimId);
  if (!claim) return { ok: false, status: 404, error: 'claim not found' };
  return { ok: true, claim };
}

// ─── Soft delete ─────────────────────────────────────────────────────────────

export interface SoftDeleteClaimsResult {
  deleted: { id: number; claimNumber: string }[];
  /** Ids that didn't match a live claim (unknown or already deleted). */
  notFound: number[];
}

/**
 * Soft-delete claims (deleted_at tombstone). Claims carry an event/audit trail
 * and FK out to RMA / repair, so rows are never hard-dropped — every read
 * filters `deleted_at IS NULL` instead. Set-based so the bulk endpoint is one
 * UPDATE regardless of batch size; the single DELETE route passes one id.
 */
export async function softDeleteClaims(
  ids: number[],
  actorStaffId: number | null,
): Promise<SoftDeleteClaimsResult> {
  const unique = [...new Set(ids)].filter((n) => Number.isFinite(n) && n > 0);
  if (unique.length === 0) return { deleted: [], notFound: [] };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: number; claim_number: string }>(
      `UPDATE warranty_claims
          SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = ANY($1::bigint[])
          AND deleted_at IS NULL
        RETURNING id, claim_number`,
      [unique],
    );
    if (rows.length > 0) {
      await client.query(
        `INSERT INTO warranty_claim_events (claim_id, event_type, payload, actor_staff_id)
         SELECT t.id, 'DELETED', '{}'::jsonb, $2
           FROM unnest($1::bigint[]) AS t(id)`,
        [rows.map((r) => Number(r.id)), actorStaffId],
      );
    }
    await client.query('COMMIT');

    const deletedIds = new Set(rows.map((r) => Number(r.id)));
    return {
      deleted: rows.map((r) => ({ id: Number(r.id), claimNumber: r.claim_number })),
      notFound: unique.filter((id) => !deletedIds.has(id)),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ─── Lifecycle transitions ───────────────────────────────────────────────────

export type TransitionResult =
  | { ok: true; claim: WarrantyClaimDetail }
  | { ok: false; status: 404 | 409 | 400; error: string };

interface TransitionOptions {
  allowedFrom: WarrantyClaimStatus[];
  to: WarrantyClaimStatus;
  actorStaffId: number | null;
  /** Extra columns to set in the same UPDATE (e.g. denial fields). */
  extraSet?: { col: string; value: unknown }[];
  eventPayload?: Record<string, unknown>;
}

async function transition(claimId: number, opts: TransitionOptions): Promise<TransitionResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{ status: WarrantyClaimStatus }>(
      `SELECT status FROM warranty_claims WHERE id = $1 FOR UPDATE`,
      [claimId],
    );
    if (current.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, error: 'claim not found' };
    }
    const from = current.rows[0].status;
    if (!opts.allowedFrom.includes(from)) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        status: 409,
        error: `claim is ${from}; cannot move to ${opts.to}`,
      };
    }

    const sets = ['status = $2', 'updated_at = NOW()'];
    const values: unknown[] = [claimId, opts.to];
    for (const e of opts.extraSet ?? []) {
      values.push(e.value);
      sets.push(`${e.col} = $${values.length}`);
    }
    await client.query(`UPDATE warranty_claims SET ${sets.join(', ')} WHERE id = $1`, values);
    await insertEvent(client, {
      claimId,
      eventType: 'STATUS_CHANGE',
      fromStatus: from,
      toStatus: opts.to,
      payload: opts.eventPayload,
      actorStaffId: opts.actorStaffId,
    });
    await client.query('COMMIT');

    const claim = await getClaim(claimId);
    if (!claim) return { ok: false, status: 404, error: 'claim not found' };
    return { ok: true, claim };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export function submitClaim(claimId: number, actorStaffId: number | null): Promise<TransitionResult> {
  return transition(claimId, { allowedFrom: WARRANTY_LIFECYCLE.submit.from, to: WARRANTY_LIFECYCLE.submit.to, actorStaffId });
}

export function approveClaim(claimId: number, actorStaffId: number | null): Promise<TransitionResult> {
  return transition(claimId, { allowedFrom: WARRANTY_LIFECYCLE.approve.from, to: WARRANTY_LIFECYCLE.approve.to, actorStaffId });
}

export function denyClaim(
  claimId: number,
  args: { reasonCode: string; denialNotes?: string | null; actorStaffId: number | null },
): Promise<TransitionResult> {
  return transition(claimId, {
    allowedFrom: WARRANTY_LIFECYCLE.deny.from,
    to: WARRANTY_LIFECYCLE.deny.to,
    actorStaffId: args.actorStaffId,
    extraSet: [
      { col: 'denial_reason_code', value: args.reasonCode },
      { col: 'denial_notes', value: args.denialNotes ?? null },
    ],
    eventPayload: { reasonCode: args.reasonCode },
  });
}

export function closeClaim(claimId: number, actorStaffId: number | null): Promise<TransitionResult> {
  return transition(claimId, {
    allowedFrom: WARRANTY_LIFECYCLE.close.from,
    to: WARRANTY_LIFECYCLE.close.to,
    actorStaffId,
  });
}

// ─── Repair attempts ─────────────────────────────────────────────────────────

export interface RepairAttemptInput {
  technicianStaffId?: number | null;
  diagnosis?: string | null;
  partsUsed?: Array<{ sku?: string; qty?: number; cost?: number }>;
  outcome?: 'FIXED' | 'NOT_FIXABLE' | 'PENDING_PARTS' | 'RTV' | null;
  laborMinutes?: number | null;
  costParts?: number | null;
  costLabor?: number | null;
  photoAttachmentIds?: string[];
  notes?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export type LogRepairResult =
  | { ok: true; attemptId: number; claim: WarrantyClaimDetail }
  | { ok: false; status: 404 | 409 | 500; error: string };

/**
 * Log a repair attempt. Auto-advances the claim: APPROVED/IN_REPAIR are the only
 * states a repair can be logged from; the first attempt moves APPROVED → IN_REPAIR,
 * and an outcome of FIXED moves IN_REPAIR → REPAIRED.
 */
export async function logRepairAttempt(
  claimId: number,
  input: RepairAttemptInput,
  actorStaffId: number | null,
): Promise<LogRepairResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query<{ status: WarrantyClaimStatus }>(
      `SELECT status FROM warranty_claims WHERE id = $1 FOR UPDATE`,
      [claimId],
    );
    if (cur.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, error: 'claim not found' };
    }
    const status = cur.rows[0].status;
    if (!REPAIR_ALLOWED_FROM.includes(status)) {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, error: `claim is ${status}; repairs allowed only when APPROVED or IN_REPAIR` };
    }

    const seq = await client.query<{ next_no: number }>(
      `SELECT COALESCE(MAX(attempt_no), 0) + 1 AS next_no FROM warranty_repair_attempts WHERE claim_id = $1`,
      [claimId],
    );
    const attemptNo = Number(seq.rows[0].next_no);

    const inserted = await client.query<{ id: number }>(
      `INSERT INTO warranty_repair_attempts (
         claim_id, attempt_no, technician_staff_id, diagnosis, parts_used, outcome,
         labor_minutes, cost_parts, cost_labor, photo_attachment_ids, notes,
         started_at, completed_at
       ) VALUES (
         $1, $2, $3, $4, $5::jsonb, $6,
         $7, $8, $9, $10::jsonb, $11,
         $12, $13
       ) RETURNING id`,
      [
        claimId,
        attemptNo,
        input.technicianStaffId ?? null,
        input.diagnosis ?? null,
        JSON.stringify(input.partsUsed ?? []),
        input.outcome ?? null,
        input.laborMinutes ?? null,
        input.costParts ?? null,
        input.costLabor ?? null,
        JSON.stringify(input.photoAttachmentIds ?? []),
        input.notes ?? null,
        input.startedAt ?? null,
        input.completedAt ?? null,
      ],
    );
    const attemptId = Number(inserted.rows[0].id);

    // Auto status advance.
    const nextStatus = repairNextStatus(input.outcome);
    if (nextStatus !== status) {
      await client.query(`UPDATE warranty_claims SET status = $2, updated_at = NOW() WHERE id = $1`, [
        claimId,
        nextStatus,
      ]);
      await insertEvent(client, {
        claimId,
        eventType: 'STATUS_CHANGE',
        fromStatus: status,
        toStatus: nextStatus,
        payload: { via: 'repair', attemptNo },
        actorStaffId,
      });
    }

    await insertEvent(client, {
      claimId,
      eventType: 'REPAIR_LOGGED',
      payload: { attemptNo, outcome: input.outcome ?? null },
      actorStaffId,
    });
    await client.query('COMMIT');

    const claim = await getClaim(claimId);
    if (!claim) return { ok: false, status: 500, error: 'claim vanished after repair insert' };
    return { ok: true, attemptId, claim };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const message = err instanceof Error ? err.message : 'log repair failed';
    return { ok: false, status: 500, error: message };
  } finally {
    client.release();
  }
}
