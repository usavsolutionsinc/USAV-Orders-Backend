/**
 * Warranty clock maintenance (Phase 3).
 *
 *  1. recomputeProvisionalClocks — for non-terminal claims still on a provisional
 *     (PACKED_PLUS_ESTIMATE) or unknown clock, re-resolve the carrier delivered
 *     date + packed date from the order and recompute the window. When a real
 *     DELIVERED date has landed, the basis flips DELIVERED and the expiry moves
 *     off the +4-day estimate onto the true delivered date.
 *
 *  2. expireLapsedClaims — un-adjudicated claims (LOGGED / SUBMITTED) whose window
 *     has passed are moved to EXPIRED. Adjudicated claims (APPROVED / IN_REPAIR /
 *     REPAIRED / DENIED) are left alone — they were already honored or decided.
 *
 * Both are batch-limited and run from the hourly shipping reconcile cron (no new
 * interval — see /api/cron/shipping/reconcile-delivered), so they piggyback on a
 * wake-up that already exists right after carrier delivered-state is reconciled.
 *
 * Cost shape (Neon CU-hours): each pass does ONE read + at most TWO set-based
 * writes (a bulk UPDATE via `unnest` + a bulk event INSERT) per run — never a
 * per-claim connection or round-trip loop, regardless of batch size.
 */

import pool from '@/lib/db';
import { isWarrantyLogger } from '@/lib/feature-flags';
import { computeWarranty, decideClockRecompute, DEFAULT_WARRANTY_DAYS } from './clock';
import { notifyWarrantyExpired } from './notify';
import type { WarrantyClockBasis } from './clock';

const RECOMPUTE_LIMIT = 300;
const EXPIRE_LIMIT = 500;

export interface RecomputeResult {
  scanned: number;
  recomputed: number;
  flippedToDelivered: number;
}

export interface ExpireResult {
  expired: number;
}

export interface ClockMaintenanceResult {
  skipped?: boolean;
  recompute?: RecomputeResult;
  expire?: ExpireResult;
}

interface CandidateRow {
  id: string | number;
  clock_basis: WarrantyClockBasis | null;
  warranty_days: number | null;
  warranty_expires_at: string | null;
  delivered_at: string | null;
  packed_scanned_at: string | null;
}

/**
 * Re-derive the clock for provisional/unknown non-terminal claims. A single read
 * pulls every candidate's fresh delivered/packed date (joined through the order);
 * the changed claims are written in one bulk UPDATE + one bulk event INSERT.
 */
export async function recomputeProvisionalClocks(limit = RECOMPUTE_LIMIT): Promise<RecomputeResult> {
  let rows: CandidateRow[] = [];
  try {
    const res = await pool.query<CandidateRow>(
      `SELECT
         wc.id,
         wc.clock_basis,
         wc.warranty_days,
         wc.warranty_expires_at::text AS warranty_expires_at,
         CASE WHEN stn.is_delivered THEN stn.latest_event_at::text END AS delivered_at,
         pl.packed_at::text AS packed_scanned_at
       FROM warranty_claims wc
       JOIN orders o ON o.id = wc.order_id
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
       WHERE wc.deleted_at IS NULL
         AND wc.status NOT IN ('CLOSED', 'EXPIRED')
         AND wc.clock_basis IS DISTINCT FROM 'DELIVERED'
         AND wc.order_id IS NOT NULL
       ORDER BY wc.updated_at ASC
       LIMIT $1`,
      [limit],
    );
    rows = res.rows;
  } catch (err) {
    // shipping_tracking_numbers is managed outside this schema; a join/availability
    // failure must not break the cron. Skip this pass.
    console.warn('[warranty.recompute] candidate query failed:', err);
    return { scanned: 0, recomputed: 0, flippedToDelivered: 0 };
  }

  // Compute every change in memory first; write set-based.
  const ids: number[] = [];
  const startsAt: (string | null)[] = [];
  const expiresAt: (string | null)[] = [];
  const bases: (string | null)[] = [];
  const days: number[] = [];
  const flipIds: number[] = [];
  const flipPayloads: string[] = [];

  for (const row of rows) {
    const warrantyDays =
      row.warranty_days != null && row.warranty_days > 0 ? row.warranty_days : DEFAULT_WARRANTY_DAYS;
    const next = computeWarranty({
      deliveredAt: row.delivered_at,
      packedScannedAt: row.packed_scanned_at,
      warrantyDays,
    });
    const decision = decideClockRecompute(
      { basis: row.clock_basis, expiresAt: row.warranty_expires_at },
      next,
    );
    if (!decision.changed) continue;

    const id = Number(row.id);
    ids.push(id);
    startsAt.push(next.startsAt ? next.startsAt.toISOString() : null);
    expiresAt.push(next.expiresAt ? next.expiresAt.toISOString() : null);
    bases.push(next.basis);
    days.push(warrantyDays);

    if (decision.flippedToDelivered) {
      flipIds.push(id);
      flipPayloads.push(
        JSON.stringify({
          from: row.clock_basis,
          to: next.basis,
          warrantyExpiresAt: next.expiresAt ? next.expiresAt.toISOString() : null,
        }),
      );
    }
  }

  if (ids.length === 0) return { scanned: rows.length, recomputed: 0, flippedToDelivered: 0 };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE warranty_claims AS wc
          SET warranty_starts_at  = v.starts_at,
              warranty_expires_at = v.expires_at,
              clock_basis         = v.basis,
              warranty_days       = v.days,
              updated_at          = NOW()
         FROM unnest($1::bigint[], $2::timestamptz[], $3::timestamptz[],
                     $4::text[], $5::int[])
                AS v(id, starts_at, expires_at, basis, days)
        WHERE wc.id = v.id`,
      [ids, startsAt, expiresAt, bases, days],
    );
    if (flipIds.length > 0) {
      await client.query(
        `INSERT INTO warranty_claim_events (claim_id, event_type, payload, actor_staff_id)
         SELECT id, 'CLOCK_RECOMPUTED', payload::jsonb, NULL
           FROM unnest($1::bigint[], $2::text[]) AS t(id, payload)`,
        [flipIds, flipPayloads],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.warn('[warranty.recompute] bulk write failed:', err);
    return { scanned: rows.length, recomputed: 0, flippedToDelivered: 0 };
  } finally {
    client.release();
  }

  return { scanned: rows.length, recomputed: ids.length, flippedToDelivered: flipIds.length };
}

/**
 * Move un-adjudicated lapsed claims to EXPIRED. Uses SKIP LOCKED so a concurrent
 * sweep can't double-process; one bulk UPDATE + one bulk event INSERT.
 */
export async function expireLapsedClaims(limit = EXPIRE_LIMIT): Promise<ExpireResult> {
  const client = await pool.connect();
  let expiredClaims: Array<{
    organizationId: string;
    id: number;
    claimNumber: string;
    createdByStaffId: number | null;
    title: string | null;
  }> = [];
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{
      id: string | number;
      organization_id: string;
      status: string;
      claim_number: string;
      created_by_staff_id: number | null;
      product_title: string | null;
      serial_number: string | null;
    }>(
      `SELECT id, organization_id, status, claim_number, created_by_staff_id, product_title, serial_number
         FROM warranty_claims
        WHERE deleted_at IS NULL
          AND status IN ('LOGGED', 'SUBMITTED')
          AND warranty_expires_at IS NOT NULL
          AND warranty_expires_at < NOW()
        ORDER BY warranty_expires_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    if (rows.length === 0) {
      await client.query('COMMIT');
      return { expired: 0 };
    }

    const ids = rows.map((r) => Number(r.id));
    const statuses = rows.map((r) => r.status);
    await client.query(
      `UPDATE warranty_claims SET status = 'EXPIRED', updated_at = NOW() WHERE id = ANY($1::bigint[])`,
      [ids],
    );
    await client.query(
      `INSERT INTO warranty_claim_events (claim_id, event_type, from_status, to_status, payload, actor_staff_id)
       SELECT id, 'STATUS_CHANGE', from_status, 'EXPIRED', '{"via":"cron"}'::jsonb, NULL
         FROM unnest($1::bigint[], $2::text[]) AS t(id, from_status)`,
      [ids, statuses],
    );
    await client.query('COMMIT');
    expiredClaims = rows.map((r) => ({
      organizationId: r.organization_id,
      id: Number(r.id),
      claimNumber: r.claim_number,
      createdByStaffId: r.created_by_staff_id == null ? null : Number(r.created_by_staff_id),
      title: r.product_title || r.serial_number || null,
    }));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.warn('[warranty.expire] sweep failed:', err);
    return { expired: 0 };
  } finally {
    client.release();
  }

  // Notify each lapsed claim's logger (best-effort, outside the transaction).
  if (expiredClaims.length > 0) {
    await notifyWarrantyExpired(expiredClaims);
  }
  return { expired: expiredClaims.length };
}

/**
 * Run both clock-maintenance passes. No-op (skipped) when the feature flag is off.
 * Called from the hourly shipping reconcile cron — guard it so a warranty error
 * never breaks shipping reconciliation.
 */
export async function runWarrantyClockMaintenance(): Promise<ClockMaintenanceResult> {
  if (!isWarrantyLogger()) return { skipped: true };
  const recompute = await recomputeProvisionalClocks();
  const expire = await expireLapsedClaims();
  return { recompute, expire };
}
