/**
 * RMA authorizations — domain module for the Phase A5 entity.
 *
 * Pairs with `rma_authorizations` + `return_dispositions` tables (migration
 * 2026-05-23). Promotes RMA from a `serial_units.current_status` flag to a
 * first-class business object so the warehouse can:
 *   - Issue an RMA number before the carton arrives
 *   - Track customer returns AND vendor returns (RTV) in the same table
 *   - Record a typed disposition per unit after inspection
 *   - Look up the history of any returned serial
 *
 * Workflow:
 *   1. `createAuthorization({...})`            — issues a new RMA-NNNNN number
 *   2. (RMA carton arrives) `markReceived({})` — AUTHORIZED → RECEIVED
 *   3. `recordDisposition({...})`              — one row per unit decision
 *   4. `closeAuthorization({...})`             — when all units dispositioned
 */

import type { PoolClient } from 'pg';
import pool from '@/lib/db';
import { recordInventoryEvent } from '@/lib/inventory/events';
import { transition } from '@/lib/inventory/state-machine';
import { resolvePriorOutbound } from '@/lib/neon/serial-units-queries';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { USAV_ORG_ID } from '@/lib/tenancy/constants';
import { isPlacementStrangleRmaRestock } from '@/lib/feature-flags';
import { resolveSitePlacementBin } from '@/lib/workflow/placement-policy';
import { tapWorkflow } from '@/lib/workflow/tap';
import type { PlacementResolverDeps } from '@/lib/workflow/placement';

/**
 * A bin lookup (for the placement strangle) scoped to an open tenant client +
 * org, mirroring receiving's RESERVE + active filter so a restock decision rule
 * resolves a real, pickable bin. Runs on the passed client so it shares the
 * disposition transaction's GUC + lock visibility.
 */
function reserveBinDepsOn(client: Pick<PoolClient, 'query'>, orgId: string): PlacementResolverDeps {
  const find = async (barcode: string): Promise<{ id: number; name: string } | null> => {
    const r = await client.query<{ id: number; name: string }>(
      `SELECT id, name FROM locations
        WHERE barcode = $1
          AND is_active = true
          AND bin_role = 'RESERVE'
          AND organization_id = $2
        ORDER BY id ASC
        LIMIT 1`,
      [barcode, orgId],
    );
    return r.rows[0] ?? null;
  };
  return { findByBarcode: find, findByName: async () => null };
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type RmaDirection = 'INBOUND_FROM_CUSTOMER' | 'OUTBOUND_TO_VENDOR';
export type RmaStatus =
  | 'AUTHORIZED'
  | 'RECEIVED'
  | 'DISPOSITIONED'
  | 'CLOSED'
  | 'EXPIRED'
  | 'CANCELED';
export type DispositionCode = 'ACCEPT' | 'HOLD' | 'RTV' | 'REWORK' | 'SCRAP';

export interface RmaAuthorizationRow {
  id: number;
  rmaNumber: string;
  direction: RmaDirection;
  orderId: number | null;
  customerId: number | null;
  authorizedAt: string;
  expiresAt: string | null;
  expectedCarrier: string | null;
  status: RmaStatus;
  createdByStaffId: number | null;
  closedAt: string | null;
  notes: string | null;
}

export interface CreateAuthorizationInput {
  direction: RmaDirection;
  orderId?: number | null;
  customerId?: number | null;
  expiresAt?: Date | string | null;
  expectedCarrier?: string | null;
  createdByStaffId: number;
  notes?: string | null;
}

export type CreateAuthorizationResult =
  | { ok: true; rma: RmaAuthorizationRow }
  | { ok: false; status: 409 | 500; error: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate the next RMA number for the current year. Format `RMA-YYYY-NNNNN`.
 *
 * Uses a separate read+write rather than a sequence because (a) the format
 * must reset per year and (b) the per-year counter is a small enough table
 * to make a sequence-per-year clunky.
 */
async function nextRmaNumber(orgId?: OrgId | null): Promise<string> {
  const year = new Date().getFullYear();
  // Count existing RMAs for the year and bump. A small race here just means
  // two parallel calls fail the UNIQUE constraint and one retries — handled
  // by the caller via `rma_number UNIQUE` collision retry below.
  //
  // rma_authorizations has no organization_id column, so when an org is in
  // scope we route through tenantQuery purely to set the GUC (RLS backstop);
  // omitted = legacy raw-pool behavior, byte-identical for session-less callers.
  const sql = `SELECT COALESCE(MAX(
              (regexp_replace(rma_number, '^RMA-\\d{4}-', ''))::int
            ), 0) + 1 AS next_seq
       FROM rma_authorizations
      WHERE rma_number LIKE $1`;
  const params = [`RMA-${year}-%`];
  const { rows } = orgId
    ? await tenantQuery<{ next_seq: number }>(orgId, sql, params)
    : await pool.query<{ next_seq: number }>(sql, params);
  const seq = rows[0]?.next_seq ?? 1;
  return `RMA-${year}-${String(seq).padStart(5, '0')}`;
}

function mapRow(row: {
  id: number;
  rma_number: string;
  direction: RmaDirection;
  order_id: number | null;
  customer_id: number | null;
  authorized_at: string;
  expires_at: string | null;
  expected_carrier: string | null;
  status: RmaStatus;
  created_by_staff_id: number | null;
  closed_at: string | null;
  notes: string | null;
}): RmaAuthorizationRow {
  return {
    id: row.id,
    rmaNumber: row.rma_number,
    direction: row.direction,
    orderId: row.order_id,
    customerId: row.customer_id,
    authorizedAt: row.authorized_at,
    expiresAt: row.expires_at,
    expectedCarrier: row.expected_carrier,
    status: row.status,
    createdByStaffId: row.created_by_staff_id,
    closedAt: row.closed_at,
    notes: row.notes,
  };
}

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createAuthorization(
  input: CreateAuthorizationInput,
  /**
   * Optional tenant scope. rma_authorizations has no organization_id column, so
   * an org in scope only routes the read+insert through the GUC (RLS backstop);
   * omitted = legacy raw-pool behavior, byte-identical for session-less callers.
   */
  orgId?: OrgId | null,
): Promise<CreateAuthorizationResult> {
  // Up to 3 retries to handle the rare per-year sequence race.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rmaNumber = await nextRmaNumber(orgId ?? null);
    try {
      const expiresAt =
        input.expiresAt instanceof Date
          ? input.expiresAt.toISOString()
          : (input.expiresAt ?? null);
      const sql = `INSERT INTO rma_authorizations (
           rma_number, direction, order_id, customer_id,
           expires_at, expected_carrier, created_by_staff_id, notes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, rma_number, direction, order_id, customer_id,
                   authorized_at::text, expires_at::text, expected_carrier, status,
                   created_by_staff_id, closed_at::text, notes`;
      const params = [
        rmaNumber,
        input.direction,
        input.orderId ?? null,
        input.customerId ?? null,
        expiresAt,
        input.expectedCarrier ?? null,
        input.createdByStaffId,
        input.notes ?? null,
      ];
      const { rows } = orgId
        ? await tenantQuery<RmaAuthorizationRow & Record<string, unknown>>(orgId, sql, params)
        : await pool.query<RmaAuthorizationRow & Record<string, unknown>>(sql, params);
      return { ok: true, rma: mapRow(rows[0] as never) };
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      // Duplicate UNIQUE on rma_number — retry with a fresh number.
      if (/duplicate key value/i.test(message) && attempt < 2) continue;
      return { ok: false, status: 500, error: message || 'unknown DB error' };
    }
  }
  return { ok: false, status: 500, error: 'failed to generate unique rma_number after 3 attempts' };
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export type MarkReceivedResult =
  | { ok: true }
  | { ok: false; status: 404 | 409; error: string };

export async function markReceived(
  input: { rmaId: number },
  /**
   * Optional tenant scope. rma_authorizations has no organization_id column, so
   * an org in scope only routes the update+check through the GUC (RLS backstop);
   * omitted = legacy raw-pool behavior, byte-identical for session-less callers.
   */
  orgId?: OrgId | null,
): Promise<MarkReceivedResult> {
  const updSql = `UPDATE rma_authorizations
        SET status = 'RECEIVED'
      WHERE id = $1
        AND status = 'AUTHORIZED'`;
  const { rowCount } = orgId
    ? await tenantQuery(orgId, updSql, [input.rmaId])
    : await pool.query(updSql, [input.rmaId]);
  if (rowCount === 0) {
    const checkSql = `SELECT status FROM rma_authorizations WHERE id = $1`;
    const check = orgId
      ? await tenantQuery<{ status: RmaStatus }>(orgId, checkSql, [input.rmaId])
      : await pool.query<{ status: RmaStatus }>(checkSql, [input.rmaId]);
    if (check.rowCount === 0) return { ok: false, status: 404, error: 'rma not found' };
    return { ok: false, status: 409, error: `rma is ${check.rows[0].status}, expected AUTHORIZED` };
  }
  return { ok: true };
}

export interface RecordDispositionInput {
  rmaId: number | null;
  serialUnitId: number | null;
  dispositionCode: DispositionCode;
  decidedByStaffId: number;
  notes?: string | null;
  /**
   * Tenant scope. When provided the whole disposition runs inside
   * `withTenantTransaction` (GUC set, RLS backstop) and the org-bearing
   * co-tables (serial_units / order_unit_allocations) get an explicit
   * `organization_id` predicate. `null`/omitted keeps the legacy raw-pool
   * behavior byte-identical for session-less callers.
   */
  organizationId?: OrgId | null;
}

export type RecordDispositionResult =
  | {
      ok: true;
      dispositionId: number;
      eventId: number | null;
      /** Outbound order this unit was paired back to, if one was resolved. */
      matchedOrderPk: number | null;
      /** How the prior order was resolved: 'allocation' | 'tsn' | null. */
      matchedVia: 'allocation' | 'tsn' | null;
      /** True when an open SHIPPED allocation was flipped to RETURNED. */
      allocationReturned: boolean;
      /** True when an ACCEPT disposition restocked the unit (RETURNED → STOCKED). */
      restocked: boolean;
    }
  | { ok: false; status: 400 | 404 | 500; error: string };

export async function recordDisposition(
  input: RecordDispositionInput,
): Promise<RecordDispositionResult> {
  if (input.rmaId == null && input.serialUnitId == null) {
    return { ok: false, status: 400, error: 'rmaId or serialUnitId required' };
  }

  const orgId = input.organizationId ?? null;

  // The transactional body, parameterized over the client + whether an org is
  // in scope. rma_authorizations / return_dispositions have no organization_id
  // column, so they are scoped via the GUC (withTenantTransaction) when orgId is
  // present; the org-bearing co-tables (serial_units / order_unit_allocations)
  // additionally get an explicit organization_id predicate.
  const run = async (client: PoolClient, manageTxn: boolean): Promise<RecordDispositionResult> => {
    try {
      if (manageTxn) await client.query('BEGIN');

      // Optional verification — if rma id given, confirm it exists and capture
      // its direction + order so we can reverse-link and backfill below.
      let rmaDirection: RmaDirection | null = null;
      let rmaOrderId: number | null = null;
      if (input.rmaId != null) {
        const check = await client.query<{ direction: RmaDirection; order_id: number | null }>(
          `SELECT direction, order_id FROM rma_authorizations WHERE id = $1`,
          [input.rmaId],
        );
        if (check.rowCount === 0) {
          if (manageTxn) await client.query('ROLLBACK');
          return { ok: false, status: 404, error: 'rma not found' };
        }
        rmaDirection = check.rows[0].direction;
        rmaOrderId = check.rows[0].order_id;
      }

      // Reverse-link applies to customer returns (the unit was out on an order
      // and physically came back). RTV / vendor returns (OUTBOUND_TO_VENDOR) have
      // no customer-ship allocation to flip. A standalone unit disposition
      // (rmaId null) is treated as an inbound return.
      const isInboundReturn = rmaDirection == null || rmaDirection === 'INBOUND_FROM_CUSTOMER';

      let matchedOrderPk: number | null = null;
      let matchedVia: 'allocation' | 'tsn' | null = null;
      let allocationReturned = false;
      let restocked = false;

      let eventId: number | null = null;
      if (input.serialUnitId != null) {
        // serial_units carries organization_id — when org-scoped, filter on it so
        // a unit id from another tenant simply isn't found (no cross-tenant flip).
        const unitQ = await client.query<{
          sku: string | null;
          current_status: string;
          normalized_serial: string;
          condition_grade: string | null;
        }>(
          orgId
            ? `SELECT sku, current_status::text AS current_status, normalized_serial,
                      condition_grade::text AS condition_grade
                 FROM serial_units WHERE id = $1 AND organization_id = $2 FOR UPDATE`
            : `SELECT sku, current_status::text AS current_status, normalized_serial,
                      condition_grade::text AS condition_grade
                 FROM serial_units WHERE id = $1 FOR UPDATE`,
          orgId ? [input.serialUnitId, orgId] : [input.serialUnitId],
        );
        const unit = unitQ.rows[0];
        if (unit) {
          if (isInboundReturn) {
            // Resolve the outbound order this unit shipped on, flip its open
            // SHIPPED allocation → RETURNED (durable shipped↔returned link;
            // idempotent if the returns dock already flipped it), and backfill
            // the RMA's order_id when it was issued without one.
            const prior = await resolvePriorOutbound(
              { id: input.serialUnitId, normalized_serial: unit.normalized_serial },
              { executor: client, organizationId: orgId },
            );
            matchedOrderPk = prior?.orderPk ?? null;
            matchedVia = prior?.via ?? null;

            // order_unit_allocations carries organization_id — align the flip to
            // the tenant so we never RETURN another tenant's allocation.
            const flip = await client.query(
              orgId
                ? `UPDATE order_unit_allocations
                      SET state = 'RETURNED', returned_at = NOW(), returned_reason = $2
                    WHERE serial_unit_id = $1 AND state = 'SHIPPED' AND organization_id = $3`
                : `UPDATE order_unit_allocations
                      SET state = 'RETURNED', returned_at = NOW(), returned_reason = $2
                    WHERE serial_unit_id = $1 AND state = 'SHIPPED'`,
              orgId
                ? [input.serialUnitId, `RMA disposition: ${input.dispositionCode}`, orgId]
                : [input.serialUnitId, `RMA disposition: ${input.dispositionCode}`],
            );
            allocationReturned = (flip.rowCount ?? 0) > 0;

            if (input.rmaId != null && rmaOrderId == null && matchedOrderPk != null) {
              await client.query(
                `UPDATE rma_authorizations SET order_id = $2 WHERE id = $1 AND order_id IS NULL`,
                [input.rmaId, matchedOrderPk],
              );
            }
          }

          const event = await recordInventoryEvent(
            {
              event_type: 'NOTE',
              actor_staff_id: input.decidedByStaffId,
              station: 'SYSTEM',
              serial_unit_id: input.serialUnitId,
              sku: unit.sku,
              prev_status: unit.current_status,
              next_status: unit.current_status,
              notes: `disposition: ${input.dispositionCode}${input.notes ? ` — ${input.notes}` : ''}`,
              payload: {
                source: 'rma.disposition',
                rmaId: input.rmaId,
                dispositionCode: input.dispositionCode,
                matched_order_pk: matchedOrderPk,
                matched_via: matchedVia,
                allocation_returned: allocationReturned,
              },
            },
            client,
            orgId ?? USAV_ORG_ID,
          );
          eventId = event.id;

          // ACCEPT on a returned unit RESTOCKS it (RETURNED → STOCKED) so it
          // re-enters sellable inventory. Previously the disposition recorded the
          // decision but never enacted it, stranding accepted returns in RETURNED.
          // Gated on isInboundReturn so an OUTBOUND_TO_VENDOR (RTV) RMA's ACCEPT
          // can NOT put a unit that's physically leaving for the vendor back into
          // our sellable stock. Only fires when the unit is actually RETURNED;
          // other states / codes record the disposition without a status change.
          if (isInboundReturn && input.dispositionCode === 'ACCEPT' && unit.current_status === 'RETURNED') {
            // Config-driven restock placement (§1.6 Track 1, opt-in). When the
            // flag is on, consult the org's Studio decision policy for a restock
            // bin (NO system default — see resolveSitePlacementBin with [] policy).
            // With no decision node authored it resolves nothing → restock stays
            // bin-less, exactly as before; an org that authors a rule gets the
            // unit physically placed + current_location set, no app change.
            const effectiveOrg = orgId ?? USAV_ORG_ID;
            let restockBinId: number | null = null;
            let restockBinName: string | null = null;

            // Compensating sku_stock_ledger row (+1, mirrors processReturnsIntake's
            // Path B, src/lib/inventory/returns.ts:158-167) — without this, the
            // trigger-projected sku_stock.stock count never sees the restock, so a
            // unit could be STOCKED here yet absent from the sellable count.
            let restockLedgerId: number | null = null;
            if (unit.sku) {
              const ledgerQ = await client.query<{ id: number }>(
                `INSERT INTO sku_stock_ledger (
                   organization_id, sku, delta, reason, dimension, staff_id,
                   ref_serial_unit_id, ref_order_id, notes
                 )
                 VALUES ($1, $2, 1, 'RETURN_CUSTOMER', 'WAREHOUSE', $3, $4, $5, $6)
                 RETURNING id`,
                [
                  orgId,
                  unit.sku,
                  input.decidedByStaffId,
                  input.serialUnitId,
                  matchedOrderPk,
                  input.notes?.trim() || `RMA disposition: ${input.dispositionCode}`,
                ],
              );
              restockLedgerId = ledgerQ.rows[0]?.id ?? null;
            }
            if (isPlacementStrangleRmaRestock()) {
              const resolved = await resolveSitePlacementBin({
                orgId: effectiveOrg,
                facts: { disposition: 'ACCEPT', grade: unit.condition_grade ?? undefined },
                systemPolicy: [], // opt-in only — no built-in restock bin
                binDeps: reserveBinDepsOn(client, effectiveOrg),
              });
              if (resolved) {
                restockBinId = resolved.bin.binId;
                restockBinName = resolved.bin.binName;
              }
            }

            const t = await transition(
              {
                unitId: input.serialUnitId,
                to: 'STOCKED',
                eventType: 'ADJUSTED',
                actorStaffId: input.decidedByStaffId,
                station: 'SYSTEM',
                binId: restockBinId ?? undefined,
                stockLedgerId: restockLedgerId,
                payload: {
                  source: 'rma.restock',
                  rmaId: input.rmaId,
                  dispositionCode: input.dispositionCode,
                  ...(restockBinName ? { placement: restockBinName } : {}),
                },
              },
              client,
            );
            // Pre-checked RETURNED → STOCKED is a declared edge, so this is
            // expected to succeed; a failure means concurrent drift — abort.
            if (!t.ok) throw new Error(`restock failed: ${t.error}`);
            // Mirror parts-sort: when a bin was resolved, set current_location in
            // the SAME tx so the unit never ends STOCKED-but-not-relocated.
            if (restockBinId != null && restockBinName) {
              await client.query(
                `UPDATE serial_units SET current_location = $1, updated_at = NOW() WHERE id = $2`,
                [restockBinName, input.serialUnitId],
              );
            }
            restocked = true;
          }
        }
      }

      const dispQ = await client.query<{ id: number }>(
        `INSERT INTO return_dispositions (
           rma_id, serial_unit_id, disposition_code, decided_by_staff_id, notes, inventory_event_id
         ) VALUES ($1, $2, $3::disposition_enum, $4, $5, $6)
         RETURNING id`,
        [
          input.rmaId,
          input.serialUnitId,
          input.dispositionCode,
          input.decidedByStaffId,
          input.notes ?? null,
          eventId,
        ],
      );

      // If at least one disposition exists for an RMA still in RECEIVED, bump
      // it to DISPOSITIONED so the supervisor list reflects progress.
      if (input.rmaId != null) {
        await client.query(
          `UPDATE rma_authorizations
              SET status = 'DISPOSITIONED'
            WHERE id = $1 AND status = 'RECEIVED'`,
          [input.rmaId],
        );
      }

      if (manageTxn) await client.query('COMMIT');
      return {
        ok: true,
        dispositionId: dispQ.rows[0].id,
        eventId,
        matchedOrderPk,
        matchedVia,
        allocationReturned,
        restocked,
      };
    } catch (err) {
      if (manageTxn) {
        try { await client.query('ROLLBACK'); } catch { /* noop */ }
      }
      const message = err instanceof Error ? err.message : 'disposition failed';
      if (!manageTxn) throw err instanceof Error ? err : new Error(message);
      return { ok: false, status: 500, error: message };
    }
  };

  // Org-scoped path: withTenantTransaction owns BEGIN/COMMIT/ROLLBACK + the GUC,
  // so `run` must not manage the transaction itself.
  let result: RecordDispositionResult;
  if (orgId) {
    try {
      result = await withTenantTransaction(orgId, (client) => run(client, false));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'disposition failed';
      result = { ok: false, status: 500, error: message };
    }
  } else {
    // Legacy session-less path — byte-identical to the prior behavior.
    const client = await pool.connect();
    try {
      result = await run(client, true);
    } finally {
      client.release();
    }
  }

  // Studio tap (Tap 2, §7.1 of the returns-unification plan): fired after the
  // transaction commits, never inside it — mirrors Tap 1's timing rule in
  // linkReturnedSerial. Only when a real unit was dispositioned (rmaId-only
  // calls have no per-unit engine position to advance) and the write
  // succeeded. Ports from the function's actual computed outcome, not a
  // naive disposition-code map: ACCEPT only means "restock" when it actually
  // did (isInboundReturn + prior RETURNED) — an OUTBOUND_TO_VENDOR RMA's
  // ACCEPT must not falsely report `restock`. HOLD/REWORK (and a non-
  // restocking ACCEPT) map to no port, which is correct, not an omission:
  // the `returns` node has no lane for them yet, so the tap re-parks the
  // unit there rather than silently inventing a route.
  if (result.ok && input.serialUnitId != null) {
    const port = dispositionToPort(input.dispositionCode, result.restocked);
    await tapWorkflow({
      serialUnitId: input.serialUnitId,
      event: 'return_received',
      input: port ? { disposition: port, rmaRef: input.rmaId, returnReason: input.notes ?? null } : undefined,
      orgId,
      staffId: input.decidedByStaffId,
      source: 'manual',
    });
  }

  return result;
}

/**
 * Map a disposition decision to the `returns` node's output port, from what
 * actually happened (restocked) rather than the raw code alone — see the
 * call site's comment for why ACCEPT can't be assumed to mean restock.
 */
function dispositionToPort(
  code: DispositionCode,
  restocked: boolean,
): 'restock' | 'rtv' | 'scrap' | null {
  if (restocked) return 'restock';
  if (code === 'RTV') return 'rtv';
  if (code === 'SCRAP') return 'scrap';
  return null;
}

export type CloseAuthorizationResult = { ok: true } | { ok: false; status: 404 | 409; error: string };

export async function closeAuthorization(
  input: { rmaId: number },
  /**
   * Optional tenant scope. rma_authorizations has no organization_id column, so
   * an org in scope only routes the update+check through the GUC (RLS backstop);
   * omitted = legacy raw-pool behavior, byte-identical for session-less callers.
   */
  orgId?: OrgId | null,
): Promise<CloseAuthorizationResult> {
  const updSql = `UPDATE rma_authorizations
        SET status = 'CLOSED',
            closed_at = NOW()
      WHERE id = $1
        AND status IN ('RECEIVED','DISPOSITIONED')`;
  const { rowCount } = orgId
    ? await tenantQuery(orgId, updSql, [input.rmaId])
    : await pool.query(updSql, [input.rmaId]);
  if (rowCount === 0) {
    const checkSql = `SELECT status FROM rma_authorizations WHERE id = $1`;
    const check = orgId
      ? await tenantQuery<{ status: RmaStatus }>(orgId, checkSql, [input.rmaId])
      : await pool.query<{ status: RmaStatus }>(checkSql, [input.rmaId]);
    if (check.rowCount === 0) return { ok: false, status: 404, error: 'rma not found' };
    return { ok: false, status: 409, error: `rma is ${check.rows[0].status}, cannot close` };
  }
  return { ok: true };
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function findByNumber(
  rmaNumber: string,
  /** Optional tenant scope — sets the GUC (RLS backstop) when present. */
  orgId?: OrgId | null,
): Promise<RmaAuthorizationRow | null> {
  const sql = `SELECT id, rma_number, direction, order_id, customer_id,
            authorized_at::text, expires_at::text, expected_carrier, status,
            created_by_staff_id, closed_at::text, notes
       FROM rma_authorizations
      WHERE rma_number = $1
      LIMIT 1`;
  const { rows } = orgId
    ? await tenantQuery(orgId, sql, [rmaNumber])
    : await pool.query(sql, [rmaNumber]);
  if (rows.length === 0) return null;
  return mapRow(rows[0] as never);
}

export async function listOpen(
  /** Optional tenant scope — sets the GUC (RLS backstop) when present. */
  orgId?: OrgId | null,
): Promise<RmaAuthorizationRow[]> {
  const sql = `SELECT id, rma_number, direction, order_id, customer_id,
            authorized_at::text, expires_at::text, expected_carrier, status,
            created_by_staff_id, closed_at::text, notes
       FROM rma_authorizations
      WHERE status IN ('AUTHORIZED','RECEIVED','DISPOSITIONED')
      ORDER BY authorized_at DESC`;
  const { rows } = orgId ? await tenantQuery(orgId, sql) : await pool.query(sql);
  return rows.map((r) => mapRow(r as never));
}

export interface DispositionBacklogRow {
  serialUnitId: number;
  serialNumber: string;
  sku: string | null;
  conditionGrade: string | null;
  currentStatus: string;
  /** How long it's been sitting undecided (serial_units.updated_at). */
  updatedAt: string;
}

/**
 * The disposition worklist (returns-unification plan §9 Stage 4): units
 * sitting at RETURNED that have never received ANY disposition — not simply
 * `current_status = 'RETURNED'`, which alone over-counts. A HOLD/REWORK
 * disposition deliberately does NOT change `current_status` away from
 * RETURNED (only ACCEPT does, via the restock branch above), so a unit a
 * human already triaged to "needs more review" would incorrectly reappear as
 * backlog on a bare status filter. `NOT EXISTS` against `return_dispositions`
 * is the correct "genuinely untouched since it came back" signal. Oldest
 * first — a worklist should surface what's waited longest.
 */
export async function listDispositionBacklog(
  orgId: OrgId,
  limit = 100,
): Promise<DispositionBacklogRow[]> {
  const sql = `SELECT su.id AS serial_unit_id, su.serial_number, su.sku,
            su.condition_grade::text AS condition_grade,
            su.current_status::text AS current_status,
            su.updated_at::text AS updated_at
       FROM serial_units su
      WHERE su.organization_id = $1
        AND su.current_status = 'RETURNED'
        AND NOT EXISTS (
          SELECT 1 FROM return_dispositions rd WHERE rd.serial_unit_id = su.id
        )
      ORDER BY su.updated_at ASC
      LIMIT $2`;
  const { rows } = await tenantQuery<{
    serial_unit_id: number;
    serial_number: string;
    sku: string | null;
    condition_grade: string | null;
    current_status: string;
    updated_at: string;
  }>(orgId, sql, [orgId, limit]);
  return rows.map((r) => ({
    serialUnitId: Number(r.serial_unit_id),
    serialNumber: r.serial_number,
    sku: r.sku,
    conditionGrade: r.condition_grade,
    currentStatus: r.current_status,
    updatedAt: r.updated_at,
  }));
}

export async function findById(
  rmaId: number,
  /** Optional tenant scope — sets the GUC (RLS backstop) when present. */
  orgId?: OrgId | null,
): Promise<RmaAuthorizationRow | null> {
  const sql = `SELECT id, rma_number, direction, order_id, customer_id,
            authorized_at::text, expires_at::text, expected_carrier, status,
            created_by_staff_id, closed_at::text, notes
       FROM rma_authorizations
      WHERE id = $1
      LIMIT 1`;
  const { rows } = orgId ? await tenantQuery(orgId, sql, [rmaId]) : await pool.query(sql, [rmaId]);
  if (rows.length === 0) return null;
  return mapRow(rows[0] as never);
}

// ─── Record-level update / cancel ─────────────────────────────────────────────
//
// These edit the RMA *record* (mutable metadata + a soft-cancel). Lifecycle
// status transitions (AUTHORIZED→RECEIVED→DISPOSITIONED→CLOSED) stay in their
// dedicated verb routes — PATCH here intentionally cannot move `status`.

export interface UpdateAuthorizationInput {
  rmaId: number;
  expectedCarrier?: string | null;
  expiresAt?: string | null;
  notes?: string | null;
}

export type UpdateAuthorizationResult =
  | { ok: true; rma: RmaAuthorizationRow }
  | { ok: false; status: 404; error: string };

/**
 * Patch mutable metadata (carrier / expiry / notes). COALESCE semantics:
 * `null`/omitted fields leave the column untouched.
 */
export async function updateAuthorization(
  input: UpdateAuthorizationInput,
  /**
   * Optional tenant scope. rma_authorizations has no organization_id column, so
   * an org in scope only routes the update through the GUC (RLS backstop);
   * omitted = legacy raw-pool behavior, byte-identical for session-less callers.
   */
  orgId?: OrgId | null,
): Promise<UpdateAuthorizationResult> {
  const sql = `UPDATE rma_authorizations SET
        expected_carrier = COALESCE($2, expected_carrier),
        expires_at       = COALESCE($3::timestamptz, expires_at),
        notes            = COALESCE($4, notes)
      WHERE id = $1
      RETURNING id, rma_number, direction, order_id, customer_id,
                authorized_at::text, expires_at::text, expected_carrier, status,
                created_by_staff_id, closed_at::text, notes`;
  const params = [input.rmaId, input.expectedCarrier ?? null, input.expiresAt ?? null, input.notes ?? null];
  const { rows } = orgId ? await tenantQuery(orgId, sql, params) : await pool.query(sql, params);
  if (rows.length === 0) return { ok: false, status: 404, error: 'rma not found' };
  return { ok: true, rma: mapRow(rows[0] as never) };
}

export type CancelAuthorizationResult =
  | { ok: true; rma: RmaAuthorizationRow }
  | { ok: false; status: 404 | 409; error: string };

/**
 * Soft-cancel — AUTHORIZED → CANCELED. Only an RMA that hasn't yet received
 * goods can be canceled; once it's RECEIVED/DISPOSITIONED it must be closed
 * through the normal flow. We never hard-delete (units + dispositions FK here).
 */
export async function cancelAuthorization(
  input: { rmaId: number },
  /**
   * Optional tenant scope. rma_authorizations has no organization_id column, so
   * an org in scope only routes the update+check through the GUC (RLS backstop);
   * omitted = legacy raw-pool behavior, byte-identical for session-less callers.
   */
  orgId?: OrgId | null,
): Promise<CancelAuthorizationResult> {
  const updSql = `UPDATE rma_authorizations
        SET status = 'CANCELED', closed_at = NOW()
      WHERE id = $1 AND status = 'AUTHORIZED'
      RETURNING id, rma_number, direction, order_id, customer_id,
                authorized_at::text, expires_at::text, expected_carrier, status,
                created_by_staff_id, closed_at::text, notes`;
  const { rows } = orgId
    ? await tenantQuery(orgId, updSql, [input.rmaId])
    : await pool.query(updSql, [input.rmaId]);
  if (rows.length === 0) {
    const checkSql = `SELECT status FROM rma_authorizations WHERE id = $1`;
    const check = orgId
      ? await tenantQuery<{ status: RmaStatus }>(orgId, checkSql, [input.rmaId])
      : await pool.query<{ status: RmaStatus }>(checkSql, [input.rmaId]);
    if (check.rowCount === 0) return { ok: false, status: 404, error: 'rma not found' };
    return {
      ok: false,
      status: 409,
      error: `rma is ${check.rows[0].status}, only AUTHORIZED RMAs can be canceled`,
    };
  }
  return { ok: true, rma: mapRow(rows[0] as never) };
}
