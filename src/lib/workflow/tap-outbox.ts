/**
 * Workflow-tap intended-write outbox (roi-execution/03 #10).
 *
 * tapWorkflow is fire-and-forget by contract: an engine failure never fails a
 * production scan. The cost is that a lost tap (crash between the domain
 * mutation and advance(), a transient lock, an engine bug) is invisible — the
 * unit silently stops moving through the graph. This module records the
 * INTENT of every tap before advance() is attempted so a reconciler cron can
 * re-drive taps that never landed:
 *
 *   recordTapIntent   → INSERT status='PENDING' before advance()
 *   markTapIntentLanded → advance() reached a durable outcome (moved/done/blocked)
 *   markTapIntentFailed → advance() reported a permanent drop (or max attempts)
 *   claimStaleTapIntents → reconciler claim: PENDING rows older than N minutes,
 *                          attempts bumped atomically, SKIP LOCKED
 *
 * Everything here is best-effort from the caller's point of view: tap.ts wraps
 * each call in try/catch, and the whole write path is inert unless the
 * WORKFLOW_TAP_OUTBOX flag is on (default OFF — the backing table ships in
 * migration 2026-07-09b_workflow_tap_outbox.sql, which may not be applied yet).
 *
 * Writes go through the owner pool with an explicit organization_id parameter,
 * mirroring the recordOpsEvent pattern (src/lib/ops-events.ts): the table is
 * RLS-FORCED from birth via enforce_tenant_isolation(), and the owner
 * connection stamps the org explicitly. The reconciler's claim is a deliberate
 * cross-org scan (session-less cron, same as the search-outbox worker).
 */

import pool from '@/lib/db';

export interface TapIntentInput {
  organizationId: string;
  serialUnitId: number;
  /** The WorkflowTapEvent that was fired (free text at this layer). */
  eventType: string;
  /** Everything needed to re-drive the tap: { input, staffId, source, expectNodeType }. */
  payload: Record<string, unknown>;
}

/** The injectable surface tap.ts consumes (see TapDeps in tap.ts). */
export interface TapOutboxDeps {
  recordIntent(input: TapIntentInput): Promise<number | null>;
  markLanded(id: number): Promise<void>;
  markFailed(id: number, reason: string): Promise<void>;
}

export async function recordTapIntent(input: TapIntentInput): Promise<number | null> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO workflow_tap_outbox (
       organization_id, serial_unit_id, event_type, payload, status
     )
     VALUES ($1::uuid, $2::bigint, $3, $4::jsonb, 'PENDING')
     RETURNING id`,
    [input.organizationId, input.serialUnitId, input.eventType, JSON.stringify(input.payload ?? {})],
  );
  const row = r.rows[0];
  return row ? Number(row.id) : null;
}

export async function markTapIntentLanded(id: number): Promise<void> {
  await pool.query(
    `UPDATE workflow_tap_outbox
        SET status = 'LANDED', updated_at = now()
      WHERE id = $1::bigint`,
    [id],
  );
}

export async function markTapIntentFailed(id: number, reason: string): Promise<void> {
  await pool.query(
    `UPDATE workflow_tap_outbox
        SET status = 'FAILED', last_error = $2, updated_at = now()
      WHERE id = $1::bigint`,
    [id, reason.slice(0, 500)],
  );
}

export const defaultTapOutbox: TapOutboxDeps = {
  recordIntent: recordTapIntent,
  markLanded: markTapIntentLanded,
  markFailed: markTapIntentFailed,
};

export interface StaleTapIntent {
  id: number;
  organizationId: string;
  serialUnitId: number;
  eventType: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/**
 * Claim PENDING intents older than `olderThanMinutes` for re-drive: bumps
 * `attempts` atomically and returns the claimed rows. SKIP LOCKED so two
 * overlapping reconciler runs never double-claim (belt to withCronLock's
 * suspenders). Oldest first, bounded by `limit`.
 */
export async function claimStaleTapIntents(args: {
  olderThanMinutes: number;
  limit: number;
}): Promise<StaleTapIntent[]> {
  const r = await pool.query<{
    id: string;
    organization_id: string;
    serial_unit_id: string;
    event_type: string;
    payload: Record<string, unknown> | null;
    attempts: number;
  }>(
    `UPDATE workflow_tap_outbox o
        SET attempts = o.attempts + 1, updated_at = now()
      WHERE o.id IN (
        SELECT id FROM workflow_tap_outbox
         WHERE status = 'PENDING'
           AND created_at < now() - make_interval(mins => $1::int)
         ORDER BY created_at ASC
         LIMIT $2::int
         FOR UPDATE SKIP LOCKED
      )
      RETURNING o.id, o.organization_id, o.serial_unit_id, o.event_type, o.payload, o.attempts`,
    [args.olderThanMinutes, args.limit],
  );
  return r.rows.map((row) => ({
    id: Number(row.id),
    organizationId: row.organization_id,
    serialUnitId: Number(row.serial_unit_id),
    eventType: row.event_type,
    payload: row.payload ?? {},
    attempts: row.attempts,
  }));
}
