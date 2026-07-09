/**
 * Fulfillment substitution — the ordered-vs-fulfilled deviation flow.
 *
 * When the unit that physically ships must differ from what was ordered/listed
 * ("customer asked for white even though the order is for black", a tester
 * regrades the unit, or a picked serial is swapped), this is NOT a silent edit:
 * it is an AUDITED RE-ALLOCATION EVENT.
 *
 *   release the original allocation  →  allocate the substitute unit  →
 *   record the original-vs-fulfilled delta in order_unit_amendments.
 *
 * Modeling it as a real re-allocation (not an override hack) means the existing
 * /api/pack/ship allocation check passes naturally for the substitute serial —
 * the substitute unit genuinely has an open allocation for the order. This
 * module owns only the atomic state change + the amendment record; the calling
 * route owns auth, validation, recordAudit, and any propagation side-effects
 * (customer notify / channel sync) via after().
 *
 * Tenancy + transaction shape mirror src/lib/picking/sessions.ts: the public
 * entry runs GUC-wrapped via withTenantTransaction; the core logic is split into
 * runSubstituteOrderUnit(client, …) so unit tests drive it DB-free with a fake
 * client + injected transition (the same core-plus-wrapper split as
 * transition()/runTransition()).
 *
 * Pairs with migration 2026-06-27e_order_unit_amendments.sql and is gated by the
 * FULFILLMENT_SUBSTITUTION rollout flag (isFulfillmentSubstitution()). The
 * advisory-vs-block_until_approved enforcement is resolved per-org by the route
 * (settings registry) and passed in — this helper just stamps the resulting
 * amendment status.
 */

import type { PoolClient } from 'pg';
import { transition as defaultTransition } from '@/lib/inventory/state-machine';
import { withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Which station raised the amendment. Must match the migration CHECK. */
export type AmendmentNode = 'pick' | 'test' | 'pack' | 'ship' | 'other';

/** Per-org enforcement (resolved from the settings registry by the route). */
export type AmendmentEnforcement = 'advisory' | 'block_until_approved';

export interface SubstituteOrderUnitInput {
  /** The allocation being replaced (carries order_id + the original unit). */
  originalAllocationId: number;
  /**
   * The order the caller believes it is amending (the URL `[id]`). When set, the
   * helper rejects (409) BEFORE any mutation if the allocation belongs to a
   * different order — closes the intra-org targeting hole where a valid foreign
   * allocation id would otherwise be substituted against the wrong order.
   */
  expectedOrderId?: number;
  /** The unit physically going out instead (resolved from a serial scan upstream). */
  substituteUnitId: number;
  /** Why — required (ORDER_SUBSTITUTE_UNIT is reason-required for audit). */
  reasonCode: string;
  /** Free-text "customer asked for white". */
  customerRequestNote?: string | null;
  /** Soft reference to evidence of the actual unit (photos link polymorphically). */
  photoId?: number | null;
  /** Station that raised it. Default 'pick'. */
  raisedAtNode?: AmendmentNode;
  /** advisory → APPLIED immediately; block_until_approved → PENDING (gate at ship). */
  enforcement?: AmendmentEnforcement;
  actorStaffId?: number | null;
  /** UUID; threaded into the two transitions for idempotent retries. */
  clientEventId?: string | null;
}

export interface SubstituteOrderUnitSuccess {
  ok: true;
  amendmentId: number;
  orderId: number;
  substituteAllocationId: number;
  /** PENDING when block_until_approved (order can't ship until approved). */
  status: 'APPLIED' | 'PENDING';
  original: { unitId: number; sku: string | null; condition: string | null };
  fulfilled: { unitId: number; sku: string | null; condition: string | null };
  /** True when a threaded clientEventId matched a prior amendment (retry no-op). */
  idempotent?: boolean;
}

export type SubstituteOrderUnitResult =
  | SubstituteOrderUnitSuccess
  | { ok: false; status: 404 | 409; error: string };

/** Injectable collaborators so the core runs DB-free in unit tests. */
export interface SubstituteDeps {
  transition: typeof defaultTransition;
}

const defaultDeps: SubstituteDeps = { transition: defaultTransition };

// ─── Core (single client; testable) ──────────────────────────────────────────

/**
 * Core re-allocation + amendment logic over one client. The caller owns the
 * transaction and the GUC (set by withTenantTransaction in the public entry, or
 * by the test harness). `orgId` is threaded into every read/write + the two
 * transition() calls so a cross-tenant id reads as not-found.
 */
export async function runSubstituteOrderUnit(
  input: SubstituteOrderUnitInput,
  client: Pick<PoolClient, 'query'>,
  orgId: OrgId,
  deps: SubstituteDeps = defaultDeps,
): Promise<SubstituteOrderUnitResult> {
  const raisedAtNode: AmendmentNode = input.raisedAtNode ?? 'pick';
  const amendmentStatus: 'APPLIED' | 'PENDING' =
    input.enforcement === 'block_until_approved' ? 'PENDING' : 'APPLIED';

  // 0. Idempotency: a retry carrying the same clientEventId returns the prior
  //    amendment instead of erroring on the now-RELEASED original allocation.
  if (input.clientEventId) {
    const prior = await client.query<{
      id: number;
      order_id: number;
      substitute_allocation_id: number | null;
      status: 'APPLIED' | 'PENDING' | 'APPROVED' | 'REJECTED';
      original_unit_id: number | null;
      original_sku: string | null;
      original_condition: string | null;
      substitute_unit_id: number | null;
      fulfilled_sku: string | null;
      fulfilled_condition: string | null;
    }>(
      `SELECT id, order_id, substitute_allocation_id, status,
              original_unit_id, original_sku, original_condition,
              substitute_unit_id, fulfilled_sku, fulfilled_condition
         FROM order_unit_amendments
        WHERE organization_id = $1 AND client_event_id = $2
        LIMIT 1`,
      [orgId, input.clientEventId],
    );
    const p = prior.rows[0];
    if (p) {
      return {
        ok: true,
        amendmentId: p.id,
        orderId: p.order_id,
        substituteAllocationId: p.substitute_allocation_id ?? 0,
        status: p.status === 'PENDING' ? 'PENDING' : 'APPLIED',
        original: { unitId: p.original_unit_id ?? 0, sku: p.original_sku, condition: p.original_condition },
        fulfilled: { unitId: p.substitute_unit_id ?? 0, sku: p.fulfilled_sku, condition: p.fulfilled_condition },
        idempotent: true,
      };
    }
  }

  // 1. Lock the original allocation; it carries the order + the original unit.
  const origAllocQ = await client.query<{
    id: number;
    order_id: number;
    serial_unit_id: number;
    state: string;
  }>(
    `SELECT id, order_id, serial_unit_id, state::text AS state
       FROM order_unit_allocations
      WHERE id = $1
        AND organization_id = $2
      FOR UPDATE`,
    [input.originalAllocationId, orgId],
  );
  const origAlloc = origAllocQ.rows[0];
  if (!origAlloc) {
    return { ok: false, status: 404, error: `allocation ${input.originalAllocationId} not found` };
  }
  // Reject a mismatched order BEFORE any mutation — never substitute against an
  // order other than the one the caller named.
  if (input.expectedOrderId != null && origAlloc.order_id !== input.expectedOrderId) {
    return { ok: false, status: 409, error: 'allocation does not belong to this order' };
  }
  if (origAlloc.state === 'SHIPPED' || origAlloc.state === 'RELEASED') {
    return { ok: false, status: 409, error: `allocation already ${origAlloc.state}` };
  }
  if (origAlloc.serial_unit_id === input.substituteUnitId) {
    return { ok: false, status: 409, error: 'substitute unit is the same as the original' };
  }

  // 2. Read original + substitute unit metadata (sku/condition for the delta).
  //    Lock the substitute so a concurrent allocator can't grab it mid-swap.
  const origUnitQ = await client.query<{ sku: string | null; condition_grade: string | null }>(
    `SELECT sku, condition_grade::text AS condition_grade
       FROM serial_units
      WHERE id = $1 AND organization_id = $2`,
    [origAlloc.serial_unit_id, orgId],
  );
  const origUnit = origUnitQ.rows[0] ?? { sku: null, condition_grade: null };

  const subUnitQ = await client.query<{ sku: string | null; condition_grade: string | null }>(
    `SELECT sku, condition_grade::text AS condition_grade
       FROM serial_units
      WHERE id = $1 AND organization_id = $2
      FOR UPDATE`,
    [input.substituteUnitId, orgId],
  );
  const subUnit = subUnitQ.rows[0];
  if (!subUnit) {
    return { ok: false, status: 404, error: `substitute unit ${input.substituteUnitId} not found` };
  }

  // 3. The substitute must be free — no open allocation on another order.
  const subAllocQ = await client.query<{ id: number }>(
    `SELECT id FROM order_unit_allocations
      WHERE serial_unit_id = $1
        AND organization_id = $2
        AND state NOT IN ('RELEASED', 'SHIPPED')
      LIMIT 1`,
    [input.substituteUnitId, orgId],
  );
  if (subAllocQ.rows[0]) {
    return { ok: false, status: 409, error: 'substitute unit is already allocated' };
  }

  // 4. Release the original: unit → STOCKED (available again) + mark the
  //    allocation RELEASED. Mirrors the short-pick release in picking/sessions.
  const releaseResult = await deps.transition(
    {
      unitId: origAlloc.serial_unit_id,
      to: 'STOCKED',
      eventType: 'NOTE',
      actorStaffId: input.actorStaffId ?? null,
      station: 'PACK',
      clientEventId: input.clientEventId ? `${input.clientEventId}:release` : null,
      notes: `substituted out → unit ${input.substituteUnitId} (${input.reasonCode})`,
      payload: {
        source: 'fulfillment.substitute',
        order_id: origAlloc.order_id,
        original_allocation_id: origAlloc.id,
        substitute_unit_id: input.substituteUnitId,
        reason: input.reasonCode,
      },
    },
    client,
    orgId,
  );
  if (!releaseResult.ok) return { ok: false, status: releaseResult.status, error: releaseResult.error };

  await client.query(
    `UPDATE order_unit_allocations
        SET state = 'RELEASED',
            released_at = NOW(),
            released_reason = 'SUBSTITUTED'
      WHERE id = $1
        AND organization_id = $2`,
    [origAlloc.id, orgId],
  );

  // 5. Allocate the substitute: unit → ALLOCATED + a fresh allocation row for
  //    the order. It starts ALLOCATED (re-picked physically), so the downstream
  //    pick/pack flow treats it as any other allocation.
  const allocResult = await deps.transition(
    {
      unitId: input.substituteUnitId,
      to: 'ALLOCATED',
      eventType: 'ALLOCATED',
      actorStaffId: input.actorStaffId ?? null,
      station: 'PACK',
      clientEventId: input.clientEventId ? `${input.clientEventId}:allocate` : null,
      notes: `substituted in for unit ${origAlloc.serial_unit_id} (${input.reasonCode})`,
      payload: {
        source: 'fulfillment.substitute',
        order_id: origAlloc.order_id,
        original_unit_id: origAlloc.serial_unit_id,
        reason: input.reasonCode,
      },
    },
    client,
    orgId,
  );
  if (!allocResult.ok) return { ok: false, status: allocResult.status, error: allocResult.error };

  const newAllocQ = await client.query<{ id: number }>(
    `INSERT INTO order_unit_allocations (order_id, serial_unit_id, state, organization_id)
     VALUES ($1, $2, 'ALLOCATED', $3)
     RETURNING id`,
    [origAlloc.order_id, input.substituteUnitId, orgId],
  );
  const substituteAllocationId = newAllocQ.rows[0].id;

  // 6. The durable ordered-vs-fulfilled record.
  const amendmentQ = await client.query<{ id: number }>(
    `INSERT INTO order_unit_amendments (
       organization_id, order_id,
       original_allocation_id, original_unit_id, original_sku, original_condition,
       substitute_allocation_id, substitute_unit_id, fulfilled_sku, fulfilled_condition,
       reason_code, customer_request_note, photo_id, raised_at_node,
       status, raised_by, client_event_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING id`,
    [
      orgId,
      origAlloc.order_id,
      origAlloc.id,
      origAlloc.serial_unit_id,
      origUnit.sku,
      origUnit.condition_grade,
      substituteAllocationId,
      input.substituteUnitId,
      subUnit.sku,
      subUnit.condition_grade,
      input.reasonCode,
      input.customerRequestNote ?? null,
      input.photoId ?? null,
      raisedAtNode,
      amendmentStatus,
      input.actorStaffId ?? null,
      input.clientEventId ?? null,
    ],
  );

  return {
    ok: true,
    amendmentId: amendmentQ.rows[0].id,
    orderId: origAlloc.order_id,
    substituteAllocationId,
    status: amendmentStatus,
    original: { unitId: origAlloc.serial_unit_id, sku: origUnit.sku, condition: origUnit.condition_grade },
    fulfilled: { unitId: input.substituteUnitId, sku: subUnit.sku, condition: subUnit.condition_grade },
  };
}

// ─── Public entry (own GUC-wrapped transaction) ──────────────────────────────

/**
 * Substitute the unit fulfilling an order line — atomic release + re-allocate +
 * amendment record, GUC-wrapped for tenant isolation. The route layer validates,
 * resolves the substitute serial → unitId, resolves per-org enforcement, then
 * calls this, maps the status, recordAudit(ORDER_SUBSTITUTE_UNIT), and fires any
 * propagation in after().
 */
export async function substituteOrderUnit(
  input: SubstituteOrderUnitInput,
  orgId: OrgId,
  deps: SubstituteDeps = defaultDeps,
): Promise<SubstituteOrderUnitResult> {
  return withTenantTransaction<SubstituteOrderUnitResult>(orgId, (client) =>
    runSubstituteOrderUnit(input, client, orgId, deps),
  );
}

// ─── Approve / reject a PENDING amendment ────────────────────────────────────
//
// Only relevant under block_until_approved: a substitution re-allocates
// immediately but records PENDING, and /api/pack/ship holds the order until the
// amendment is decided. APPROVE just clears the gate (the re-allocation already
// stands). REJECT reverts it: release the substitute back to stock and best-
// effort re-allocate the original unit to the order.

export type AmendmentDecision = 'APPROVE' | 'REJECT';

export interface DecideAmendmentInput {
  amendmentId: number;
  decision: AmendmentDecision;
  actorStaffId?: number | null;
  clientEventId?: string | null;
}

export interface DecideAmendmentSuccess {
  ok: true;
  amendmentId: number;
  orderId: number;
  status: 'APPROVED' | 'REJECTED';
  /** REJECT only: whether the original unit could be re-allocated to the order
   *  (false ⇒ it drifted out of stock; the order needs manual re-allocation). */
  originalReallocated?: boolean;
  /** True when the amendment was already in the requested terminal state. */
  idempotent?: boolean;
}

export type DecideAmendmentResult =
  | DecideAmendmentSuccess
  | { ok: false; status: 404 | 409; error: string };

export async function runDecideAmendment(
  input: DecideAmendmentInput,
  client: Pick<PoolClient, 'query'>,
  orgId: OrgId,
  deps: SubstituteDeps = defaultDeps,
): Promise<DecideAmendmentResult> {
  const targetStatus = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';

  const amendQ = await client.query<{
    id: number;
    order_id: number;
    status: 'APPLIED' | 'PENDING' | 'APPROVED' | 'REJECTED';
    original_unit_id: number | null;
    substitute_unit_id: number | null;
    substitute_allocation_id: number | null;
  }>(
    `SELECT id, order_id, status, original_unit_id, substitute_unit_id, substitute_allocation_id
       FROM order_unit_amendments
      WHERE id = $1 AND organization_id = $2
      FOR UPDATE`,
    [input.amendmentId, orgId],
  );
  const amend = amendQ.rows[0];
  if (!amend) {
    return { ok: false, status: 404, error: `amendment ${input.amendmentId} not found` };
  }
  // Idempotent replay: already in the requested terminal state.
  if (amend.status === targetStatus) {
    return { ok: true, amendmentId: amend.id, orderId: amend.order_id, status: targetStatus, idempotent: true };
  }
  // Only a PENDING amendment can be decided. APPLIED (advisory) never gated, and
  // a flip to the opposite terminal state is not allowed.
  if (amend.status !== 'PENDING') {
    return { ok: false, status: 409, error: `amendment is ${amend.status}, not PENDING` };
  }

  let originalReallocated: boolean | undefined;

  if (input.decision === 'REJECT') {
    // Release the substitute back to stock + mark its allocation released.
    if (amend.substitute_unit_id != null) {
      const rel = await deps.transition(
        {
          unitId: amend.substitute_unit_id,
          to: 'STOCKED',
          eventType: 'NOTE',
          actorStaffId: input.actorStaffId ?? null,
          station: 'PACK',
          clientEventId: input.clientEventId ? `${input.clientEventId}:reject-release` : null,
          notes: `substitution rejected — released substitute (amendment ${amend.id})`,
          payload: { source: 'fulfillment.substitute.reject', amendment_id: amend.id, order_id: amend.order_id },
        },
        client,
        orgId,
      );
      if (!rel.ok) return { ok: false, status: rel.status, error: rel.error };
    }
    if (amend.substitute_allocation_id != null) {
      await client.query(
        `UPDATE order_unit_allocations
            SET state = 'RELEASED', released_at = NOW(), released_reason = 'SUBSTITUTION_REJECTED'
          WHERE id = $1 AND organization_id = $2`,
        [amend.substitute_allocation_id, orgId],
      );
    }

    // Best-effort: re-allocate the original unit to the order. It may have
    // drifted out of STOCKED (advisory window) — if so, leave the order to be
    // manually re-allocated rather than forcing an illegal transition.
    originalReallocated = false;
    if (amend.original_unit_id != null) {
      const realloc = await deps.transition(
        {
          unitId: amend.original_unit_id,
          to: 'ALLOCATED',
          eventType: 'ALLOCATED',
          actorStaffId: input.actorStaffId ?? null,
          station: 'PACK',
          clientEventId: input.clientEventId ? `${input.clientEventId}:reject-reallocate` : null,
          notes: `substitution rejected — restored original (amendment ${amend.id})`,
          payload: { source: 'fulfillment.substitute.reject', amendment_id: amend.id, order_id: amend.order_id },
        },
        client,
        orgId,
      );
      if (realloc.ok) {
        await client.query(
          `INSERT INTO order_unit_allocations (order_id, serial_unit_id, state, organization_id)
           VALUES ($1, $2, 'ALLOCATED', $3)`,
          [amend.order_id, amend.original_unit_id, orgId],
        );
        originalReallocated = true;
      }
    }
  }

  await client.query(
    `UPDATE order_unit_amendments
        SET status = $3, approved_by = $4, approved_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND organization_id = $2`,
    [amend.id, orgId, targetStatus, input.actorStaffId ?? null],
  );

  return {
    ok: true,
    amendmentId: amend.id,
    orderId: amend.order_id,
    status: targetStatus,
    ...(input.decision === 'REJECT' ? { originalReallocated } : {}),
  };
}

export async function decideAmendment(
  input: DecideAmendmentInput,
  orgId: OrgId,
  deps: SubstituteDeps = defaultDeps,
): Promise<DecideAmendmentResult> {
  return withTenantTransaction<DecideAmendmentResult>(orgId, (client) =>
    runDecideAmendment(input, client, orgId, deps),
  );
}
