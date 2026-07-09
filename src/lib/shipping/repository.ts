import pool from '../db';
import type { CarrierCode, CarrierTrackingEvent, CarrierTrackingResult, ShipmentRow, TrackingEventRow } from './types';
import { computeNextCheckAt, normalizeTrackingNumber } from './normalize';
import { ENABLED_SYNC_CARRIERS } from './enabled-carriers';
import type { PoolClient } from 'pg';
import { withTenantConnection, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { resolveShipmentOrgId } from './resolve-shipment-org';

// ─── Tenancy note ─────────────────────────────────────────────────────────────
//
// `shipping_tracking_numbers` and `shipment_tracking_events` are both classified
// `tenant-owned-NEEDS-COL` in docs/tenancy/org-id-coverage.generated.md — neither
// carries an `organization_id` column, and within this module there is no
// org-bearing parent table to JOIN against (the tracking-number ↔ order linkage
// lives in `order_shipment_links`, not reachable from these raw lookups). Per the
// tenant-isolation pattern rule (6), these helpers can therefore only be
// GUC-wrapped when an orgId is threaded through: we route through
// withTenantConnection / withTenantTransaction (which set `app.current_org` via
// SET LOCAL) so the GUC is in place for RLS once the columns exist, but we cannot
// add explicit `organization_id = $n` predicates or stamps yet. Until the columns
// land, the GUC-wrapped path runs byte-identical SQL to the raw-pool path; the
// only difference is the executor (tenant pool + transaction-scoped GUC). When
// orgId is omitted, behavior is byte-identical to the original raw-pool path so
// the many un-migrated callers keep compiling and behaving as today.
// → NEEDS-COL: shipping_tracking_numbers, shipment_tracking_events.

// ─── Upsert shipment master record ───────────────────────────────────────────

export async function upsertShipment(params: {
  trackingNumberRaw: string;
  trackingNumberNormalized: string;
  carrier: CarrierCode;
  sourceSystem?: string | null;
  carrierAccountRef?: string | null;
}, orgId?: OrgId): Promise<ShipmentRow> {
  // shipping_tracking_numbers.organization_id exists (2026-06-14, NULLABLE) but is
  // a GLOBAL natural key on tracking_number_normalized — one row per physical
  // package that orders/receiving/fba all link to. We do NOT re-scope the unique
  // per-org (that needs a product decision + every session-less writer threaded;
  // see 2026-06-14_org_id_phase_b_needs_col_2.sql). What we CAN do safely, and
  // what unblocks an eventual per-org re-scope + FORCE RLS, is stamp the column:
  // when orgId is threaded we set it explicitly on INSERT and HEAL it on conflict
  // (COALESCE keeps a non-null existing value, fills a NULL one). Omitted orgId →
  // byte-identical raw-pool path so un-migrated session-less callers are unchanged.
  if (orgId) {
    const sql = `INSERT INTO shipping_tracking_numbers
           (tracking_number_raw, tracking_number_normalized, carrier, source_system, carrier_account_ref, next_check_at, organization_id)
         VALUES ($1, $2, $3, $4, $5, now(), $6::uuid)
         ON CONFLICT (tracking_number_normalized) DO UPDATE
           SET carrier_account_ref = EXCLUDED.carrier_account_ref,
               source_system       = COALESCE(EXCLUDED.source_system, shipping_tracking_numbers.source_system),
               organization_id     = COALESCE(shipping_tracking_numbers.organization_id, EXCLUDED.organization_id),
               updated_at          = now()
         RETURNING *`;
    const scopedArgs = [
      params.trackingNumberRaw,
      params.trackingNumberNormalized,
      params.carrier,
      params.sourceSystem ?? null,
      params.carrierAccountRef ?? null,
      orgId,
    ];
    return withTenantTransaction(orgId, async (client) => {
      const result = await client.query<ShipmentRow>(sql, scopedArgs);
      return result.rows[0];
    });
  }
  const sql = `INSERT INTO shipping_tracking_numbers
         (tracking_number_raw, tracking_number_normalized, carrier, source_system, carrier_account_ref, next_check_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (tracking_number_normalized) DO UPDATE
         SET carrier_account_ref = EXCLUDED.carrier_account_ref,
             source_system       = COALESCE(EXCLUDED.source_system, shipping_tracking_numbers.source_system),
             updated_at          = now()
       RETURNING *`;
  const args = [
    params.trackingNumberRaw,
    params.trackingNumberNormalized,
    params.carrier,
    params.sourceSystem ?? null,
    params.carrierAccountRef ?? null,
  ];
  const client = await pool.connect();
  try {
    const result = await client.query<ShipmentRow>(sql, args);
    return result.rows[0];
  } finally {
    client.release();
  }
}

// ─── Lookups ──────────────────────────────────────────────────────────────────

export async function getShipmentById(id: number, orgId?: OrgId): Promise<ShipmentRow | null> {
  // NEEDS-COL: GUC-wrap only when orgId present; no org predicate possible.
  const sql = 'SELECT * FROM shipping_tracking_numbers WHERE id = $1';
  if (orgId) {
    return withTenantConnection(orgId, async (client) => {
      const result = await client.query<ShipmentRow>(sql, [id]);
      return result.rows[0] ?? null;
    });
  }
  const client = await pool.connect();
  try {
    const result = await client.query<ShipmentRow>(sql, [id]);
    return result.rows[0] ?? null;
  } finally {
    client.release();
  }
}

export async function getShipmentByTracking(
  trackingNumberNormalized: string,
  orgId?: OrgId,
): Promise<ShipmentRow | null> {
  // shipping_tracking_numbers.organization_id now exists (NULLABLE during the
  // Phase-B transition). When an orgId is threaded, scope the match to that org
  // so two tenants that happen to share a tracking number can never resolve to
  // each other's row — the match stays UNIQUE per org. We also still accept an
  // as-yet-unstamped (NULL-org) row so the transition is seamless, and prefer an
  // exact-org match over a NULL-org one (ORDER BY + LIMIT 1) for determinism.
  // The returned row carries organization_id so callers can pin their downstream
  // writes to the row's real owner. Omitted orgId → byte-identical raw-pool path.
  if (orgId) {
    const sql = `SELECT * FROM shipping_tracking_numbers
       WHERE tracking_number_normalized = $1
         AND (organization_id = $2::uuid OR organization_id IS NULL)
       ORDER BY (organization_id = $2::uuid) DESC NULLS LAST
       LIMIT 1`;
    const args = [normalizeTrackingNumber(trackingNumberNormalized), orgId];
    return withTenantConnection(orgId, async (client) => {
      const result = await client.query<ShipmentRow>(sql, args);
      return result.rows[0] ?? null;
    });
  }
  const sql = 'SELECT * FROM shipping_tracking_numbers WHERE tracking_number_normalized = $1';
  const args = [normalizeTrackingNumber(trackingNumberNormalized)];
  const client = await pool.connect();
  try {
    const result = await client.query<ShipmentRow>(sql, args);
    return result.rows[0] ?? null;
  } finally {
    client.release();
  }
}

export async function getDueShipments(
  limit: number = 50,
  carriers?: CarrierCode[],
  orgId?: OrgId,
): Promise<ShipmentRow[]> {
  // NEEDS-COL: GUC-wrap only when orgId present; no org predicate possible.
  const run = async (client: PoolClient): Promise<ShipmentRow[]> => {
    const params: Array<number | string[]> = [];
    // Only carriers we actively poll (USPS is disabled pending OAuth — see
    // enabled-carriers.ts). Also excludes UNKNOWN, which has no API to call.
    params.push([...ENABLED_SYNC_CARRIERS]);
    const enabledCarrierParam = `$${params.length}::text[]`;
    const where: string[] = [
      `is_terminal = false`,
      `(next_check_at IS NULL OR next_check_at <= now())`,
      `carrier = ANY(${enabledCarrierParam})`,
      // Stop retrying after 5 consecutive failures (dead tracking numbers)
      `consecutive_error_count < 5`,
    ];

    if (carriers && carriers.length > 0) {
      params.push(carriers);
      where.push(`carrier = ANY($${params.length}::text[])`);
    }

    // Prioritize shipments that are actually in-flight over label-only
    params.push(limit);

    const result = await client.query<ShipmentRow>(
      `SELECT * FROM shipping_tracking_numbers
       WHERE ${where.join('\n         AND ')}
       ORDER BY
         CASE WHEN is_in_transit OR is_out_for_delivery THEN 0
              WHEN is_carrier_accepted THEN 1
              ELSE 2 END,
         next_check_at ASC NULLS FIRST
       LIMIT $${params.length}`,
      params
    );
    return result.rows;
  };
  if (orgId) {
    return withTenantConnection(orgId, (client) => run(client));
  }
  const client = await pool.connect();
  try {
    return await run(client);
  } finally {
    client.release();
  }
}

export async function getShipmentEvents(shipmentId: number, orgId?: OrgId): Promise<TrackingEventRow[]> {
  // shipment_tracking_events has no organization_id column (NEEDS-COL): GUC-wrap
  // only when orgId present; no org predicate possible.
  const sql = `SELECT * FROM shipment_tracking_events
       WHERE shipment_id = $1
       ORDER BY event_occurred_at DESC NULLS LAST, id DESC`;
  if (orgId) {
    return withTenantConnection(orgId, async (client) => {
      const result = await client.query<TrackingEventRow>(sql, [shipmentId]);
      return result.rows;
    });
  }
  const client = await pool.connect();
  try {
    const result = await client.query<TrackingEventRow>(sql, [shipmentId]);
    return result.rows;
  } finally {
    client.release();
  }
}

// ─── Upsert carrier events (deduped via unique index) ────────────────────────

export async function upsertTrackingEvents(
  shipmentId: number,
  carrier: CarrierCode,
  trackingNumberNormalized: string,
  events: CarrierTrackingEvent[],
  orgId?: OrgId,
): Promise<number> {
  if (events.length === 0) return 0;

  // shipment_tracking_events.organization_id is derived from its PARENT tracking
  // row (an event definitionally belongs to its STN's org) — so every write is
  // correctly org-stamped even on the session-less carrier-sync path, with no
  // webhook org-resolution needed. This is what lets the table be FORCEd.
  const run = async (client: PoolClient): Promise<number> => {
    let inserted = 0;
    for (const ev of events) {
      const result = await client.query(
        `INSERT INTO shipment_tracking_events (
           shipment_id, carrier, tracking_number_normalized,
           external_event_id, external_status_code, external_status_label,
           external_status_description, normalized_status_category,
           event_occurred_at, event_city, event_state, event_postal_code,
           event_country_code, signed_by, exception_code, exception_description,
           payload, organization_id
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
           (SELECT organization_id FROM shipping_tracking_numbers WHERE id = $1)
         )
         ON CONFLICT (
           shipment_id,
           COALESCE(external_event_id, ''),
           COALESCE(external_status_code, ''),
           COALESCE(event_occurred_at, 'epoch'::timestamptz)
         ) DO NOTHING`,
        [
          shipmentId,
          carrier,
          trackingNumberNormalized,
          ev.externalEventId ?? null,
          ev.externalStatusCode ?? null,
          ev.externalStatusLabel ?? null,
          ev.externalStatusDescription ?? null,
          ev.normalizedStatusCategory,
          ev.eventOccurredAt ?? null,
          ev.city ?? null,
          ev.state ?? null,
          ev.postalCode ?? null,
          ev.countryCode ?? null,
          ev.signedBy ?? null,
          ev.exceptionCode ?? null,
          ev.exceptionDescription ?? null,
          JSON.stringify(ev.payload ?? {}),
        ]
      );
      if ((result.rowCount ?? 0) > 0) inserted++;
    }
    return inserted;
  };

  if (orgId) {
    return withTenantTransaction(orgId, (client) => run(client));
  }
  const client = await pool.connect();
  try {
    return await run(client);
  } finally {
    client.release();
  }
}

// ─── Update shipment after a successful sync ──────────────────────────────────

export async function updateShipmentSummary(
  shipmentId: number,
  result: CarrierTrackingResult,
  orgId?: OrgId,
): Promise<void> {
  const { emitShippedLedgerForShipment } = await import('@/lib/neon/stock-ledger-helpers');
  const resolvedOrgId = orgId ?? (await resolveShipmentOrgId(shipmentId));

  const run = async (client: PoolClient): Promise<void> => {
    const status = result.latestStatusCategory;

    // ─── A1: derive delivered from the append-only event log, not just the
    // latest snapshot. Callers (poll + every webhook) upsert events *before*
    // calling this, so the log is authoritative and immune to out-of-order /
    // late-arriving events that leave `latest_status_category` on an in-transit
    // value even though a DELIVERED scan exists. Earliest such event time is the
    // honest delivered_at.
    const logAgg = await client.query<{ has_delivered: boolean; first_delivered_at: string | null }>(
      `SELECT
         bool_or(normalized_status_category = 'DELIVERED')                                  AS has_delivered,
         min(event_occurred_at) FILTER (WHERE normalized_status_category = 'DELIVERED')     AS first_delivered_at
       FROM shipment_tracking_events
       WHERE shipment_id = $1`,
      [shipmentId]
    );
    const deliveredFromLog = logAgg.rows[0]?.has_delivered === true;
    const firstDeliveredAt = logAgg.rows[0]?.first_delivered_at ?? null;

    // Delivered if the log has it, the snapshot says so, or the carrier handed
    // us an explicit delivered timestamp. The SQL OR with the stored column
    // (A2) makes it monotonic — a stray later in-transit event can't un-deliver.
    const deliveredNow = deliveredFromLog || status === 'DELIVERED' || result.deliveredAt != null;
    // Earliest known delivery instant from any source. NULL is fine — the SQL
    // coheres it to now() under the A4 invariant when delivered is true.
    const deliveredAtValue = firstDeliveredAt ?? result.deliveredAt ?? null;
    // Terminal is sticky: delivered (now or previously) or a fresh RETURNED.
    const isTerminal = deliveredNow || status === 'RETURNED';
    const nextCheck = isTerminal ? null : computeNextCheckAt(status, 0);

    await client.query(
      `UPDATE shipping_tracking_numbers SET
         latest_status_code        = $1,
         latest_status_label       = $2,
         latest_status_description = $3,
         latest_status_category    = $4,

         is_label_created     = (is_label_created    OR $5::boolean),
         is_carrier_accepted  = (is_carrier_accepted OR $6::boolean),
         is_in_transit        = (is_in_transit        OR $7::boolean),
         is_out_for_delivery  = (is_out_for_delivery  OR $8::boolean),
         -- A2: monotonic delivered — never flips back to false once observed.
         is_delivered         = (is_delivered OR $9::boolean),
         has_exception        = $10::boolean,
         -- A2: monotonic terminal — a delivered shipment stays terminal.
         is_terminal          = (is_terminal OR $11::boolean),

         label_created_at    = CASE WHEN $12::boolean AND label_created_at IS NULL    THEN now() ELSE label_created_at    END,
         carrier_accepted_at = CASE WHEN $13::boolean AND carrier_accepted_at IS NULL THEN now() ELSE carrier_accepted_at END,
         first_in_transit_at = CASE WHEN $14::boolean AND first_in_transit_at IS NULL THEN now() ELSE first_in_transit_at END,
         out_for_delivery_at = CASE WHEN $15::boolean THEN now() ELSE out_for_delivery_at END,
         -- A4 coherence: is_delivered ⇒ delivered_at IS NOT NULL. Keep the
         -- earliest known instant; only ever fill, never push it later.
         delivered_at        = CASE
                                 WHEN $16::boolean
                                   THEN LEAST(COALESCE(delivered_at, $17::timestamptz, now()),
                                              COALESCE($17::timestamptz, delivered_at, now()))
                                 ELSE delivered_at
                               END,
         exception_at        = CASE WHEN $18::boolean THEN now() ELSE exception_at END,

         latest_event_at          = COALESCE($19::timestamptz, latest_event_at),
         last_checked_at          = now(),
         next_check_at            = $20::timestamptz,
         check_attempt_count      = check_attempt_count + 1,
         consecutive_error_count  = 0,
         last_error_code          = NULL,
         last_error_message       = NULL,
         -- C1: a successful sync clears any prior carrier-blocked marker.
         tracking_blocked_reason  = NULL,
         latest_payload           = $21::jsonb,
         metadata                 = COALESCE(metadata, '{}'::jsonb) || $22::jsonb,
         updated_at               = now()
       WHERE id = $23`,
      [
        result.latestStatusCode ?? null,               // $1
        result.latestStatusLabel ?? null,              // $2
        result.latestStatusDescription ?? null,        // $3
        status,                                        // $4

        status === 'LABEL_CREATED',                    // $5  is_label_created
        status === 'ACCEPTED',                         // $6  is_carrier_accepted
        status === 'IN_TRANSIT',                       // $7  is_in_transit
        status === 'OUT_FOR_DELIVERY',                 // $8  is_out_for_delivery
        deliveredNow,                                  // $9  is_delivered (log-derived, monotonic)
        status === 'EXCEPTION',                        // $10 has_exception
        isTerminal,                                    // $11 is_terminal

        status === 'LABEL_CREATED',                    // $12 label_created_at gate
        status === 'ACCEPTED',                         // $13 carrier_accepted_at gate
        status === 'IN_TRANSIT',                       // $14 first_in_transit_at gate
        status === 'OUT_FOR_DELIVERY',                 // $15 out_for_delivery_at gate
        deliveredNow,                                  // $16 delivered_at gate (log-derived)
        deliveredAtValue,                              // $17 delivered_at value (earliest from log/result)
        status === 'EXCEPTION',                        // $18 exception_at gate

        result.latestEventAt ?? null,                  // $19
        nextCheck?.toISOString() ?? null,              // $20
        JSON.stringify(result.payload ?? {}),          // $21
        JSON.stringify(result.metadata ?? {}),         // $22
        shipmentId,                                    // $23
      ]
    );

    // If carrier just accepted the package, drain boxed_stock for this
    // shipment. Idempotent: helper skips if a SHIPPED row already exists
    // for this shipment_id.
    if (
      status === 'ACCEPTED' ||
      status === 'IN_TRANSIT' ||
      status === 'OUT_FOR_DELIVERY' ||
      status === 'DELIVERED' ||
      deliveredNow
    ) {
      try {
        await emitShippedLedgerForShipment(client, shipmentId, {
          source: `carrier-sync.${status}`,
        }, resolvedOrgId ?? undefined);
      } catch (err) {
        console.warn('[updateShipmentSummary] SHIPPED ledger emit failed', err);
      }
    }
  };

  if (resolvedOrgId) {
    await withTenantTransaction(resolvedOrgId, (client) => run(client));
    return;
  }
  const client = await pool.connect();
  try {
    await run(client);
  } finally {
    client.release();
  }
}

// ─── Update shipment after a failed sync ─────────────────────────────────────

export async function updateShipmentError(
  shipmentId: number,
  errorCode: string,
  errorMessage: string,
  carrier?: CarrierCode | string | null,
  orgId?: OrgId,
): Promise<void> {
  // C1/C2: an auth/access-control rejection (USPS 403 IP-Agreement gate, or a
  // carrier that keeps returning 401/403) is not a transient error — polling
  // can't fix it. Record a distinct `tracking_blocked_reason` so the UI can
  // show TRACKING_UNAVAILABLE instead of leaving the shipment silently stuck
  // pre-delivered, and push next_check_at ~24h out so we stop burning the
  // (e.g. USPS 60/hr) quota re-failing until access clears.
  const isAccessBlocked = errorCode === 'ACCESS_CONTROL' || errorCode === 'AUTH_ERROR';
  const blockedReason = isAccessBlocked
    ? `${(carrier ?? 'CARRIER')}_ACCESS_CONTROL`
    : null;

  // NEEDS-COL: GUC-wrap when orgId present; no org predicate possible on UPDATE.
  const sql = `UPDATE shipping_tracking_numbers SET
         consecutive_error_count = consecutive_error_count + 1,
         check_attempt_count     = check_attempt_count + 1,
         last_checked_at         = now(),
         last_error_code         = $1,
         last_error_message      = $2,
         tracking_blocked_reason = CASE WHEN $4::boolean THEN $5::text ELSE tracking_blocked_reason END,
         next_check_at           = CASE
                                     WHEN $4::boolean THEN now() + INTERVAL '24 hours'
                                     ELSE now() + (INTERVAL '1 hour' * LEAST(POWER(2, consecutive_error_count), 16))
                                   END,
         updated_at              = now()
       WHERE id = $3`;
  const args = [errorCode, errorMessage.slice(0, 1000), shipmentId, isAccessBlocked, blockedReason];

  if (orgId) {
    await withTenantTransaction(orgId, (client) => client.query(sql, args));
    return;
  }
  const client = await pool.connect();
  try {
    await client.query(sql, args);
  } finally {
    client.release();
  }
}

// ─── Carrier webhook subscription state ──────────────────────────────────────
//
// Carriers push near-real-time track events only for tracking numbers
// associated to our webhook project / destination. These helpers feed the
// subscribe-<carrier> crons, which associate pending shipments and (for FedEx's
// async model) reconcile the resulting jobs to COMPLETED. Carrier-agnostic:
// pass 'FEDEX' or 'UPS'.

export interface PendingSubscriptionRow {
  id: number;
  trackingNumberNormalized: string;
}

/**
 * Active shipments for `carrier` that still need a webhook (re)subscription:
 * never attempted (NULL), queued (PENDING), or previously FAILED. Backed by the
 * partial index from 2026-06-02_carrier_webhook_subscription.sql.
 */
export async function getShipmentsPendingSubscription(
  carrier: CarrierCode,
  limit: number,
  orgId?: OrgId,
): Promise<PendingSubscriptionRow[]> {
  // NEEDS-COL: GUC-wrap only when orgId present; no org predicate possible.
  const sql = `SELECT id, tracking_number_normalized
         FROM shipping_tracking_numbers
        WHERE carrier = $1
          AND is_terminal = false
          AND (webhook_subscription_status IS NULL
               OR webhook_subscription_status IN ('PENDING','FAILED'))
        ORDER BY next_check_at ASC NULLS FIRST
        LIMIT $2`;
  const map = (rows: Array<{ id: number; tracking_number_normalized: string }>): PendingSubscriptionRow[] =>
    rows.map((r) => ({ id: r.id, trackingNumberNormalized: r.tracking_number_normalized }));
  if (orgId) {
    return withTenantConnection(orgId, async (client) => {
      const result = await client.query(sql, [carrier, limit]);
      return map(result.rows);
    });
  }
  const client = await pool.connect();
  try {
    const result = await client.query(sql, [carrier, limit]);
    return map(result.rows);
  } finally {
    client.release();
  }
}

/**
 * Record the outcome of a subscription request against the shipments it
 * covered. `jobId` is null for synchronous carriers (UPS) or when FedEx
 * completed synchronously; status is then COMPLETED.
 */
export async function markSubscriptionResult(
  carrier: CarrierCode,
  trackingNumbers: string[],
  status: 'SUBMITTED' | 'COMPLETED' | 'FAILED',
  jobId: string | null,
  error?: string | null,
  orgId?: OrgId,
): Promise<void> {
  if (trackingNumbers.length === 0) return;
  // NEEDS-COL: GUC-wrap when orgId present; no org predicate possible on UPDATE.
  const sql = `UPDATE shipping_tracking_numbers SET
         webhook_subscription_status = $3,
         webhook_subscription_job_id = $4,
         webhook_subscribed_at       = CASE WHEN $3 = 'COMPLETED' THEN now() ELSE webhook_subscribed_at END,
         webhook_subscription_error  = $5,
         updated_at                  = now()
       WHERE carrier = $1
         AND tracking_number_normalized = ANY($2::text[])`;
  const args = [carrier, trackingNumbers, status, jobId, error ? error.slice(0, 1000) : null];
  if (orgId) {
    await withTenantTransaction(orgId, (client) => client.query(sql, args));
    return;
  }
  const client = await pool.connect();
  try {
    await client.query(sql, args);
  } finally {
    client.release();
  }
}

/**
 * Active shipments whose subscription COMPLETED but is older than `ttlDays` —
 * i.e. due for renewal. Carriers expire subscriptions (USPS in particular), so
 * re-subscribing before TTL keeps push alive. Returns [] when ttlDays <= 0
 * (renewal disabled). Not index-backed (COMPLETED rows are excluded from the
 * pending index), but the carrier + is_terminal + LIMIT keep it bounded.
 */
export async function getShipmentsForSubscriptionRenewal(
  carrier: CarrierCode,
  ttlDays: number,
  limit: number,
  orgId?: OrgId,
): Promise<PendingSubscriptionRow[]> {
  if (!ttlDays || ttlDays <= 0) return [];
  // NEEDS-COL: GUC-wrap only when orgId present; no org predicate possible.
  const sql = `SELECT id, tracking_number_normalized
         FROM shipping_tracking_numbers
        WHERE carrier = $1
          AND is_terminal = false
          AND webhook_subscription_status = 'COMPLETED'
          AND webhook_subscribed_at IS NOT NULL
          AND webhook_subscribed_at < now() - ($2 || ' days')::interval
        ORDER BY webhook_subscribed_at ASC
        LIMIT $3`;
  const args = [carrier, String(ttlDays), limit];
  const map = (rows: Array<{ id: number; tracking_number_normalized: string }>): PendingSubscriptionRow[] =>
    rows.map((r) => ({ id: r.id, trackingNumberNormalized: r.tracking_number_normalized }));
  if (orgId) {
    return withTenantConnection(orgId, async (client) => {
      const result = await client.query(sql, args);
      return map(result.rows);
    });
  }
  const client = await pool.connect();
  try {
    const result = await client.query(sql, args);
    return map(result.rows);
  } finally {
    client.release();
  }
}

/** Distinct jobIds still awaiting reconciliation (status SUBMITTED). FedEx-only. */
export async function getSubmittedSubscriptionJobIds(
  carrier: CarrierCode,
  limit: number,
  orgId?: OrgId,
): Promise<string[]> {
  // NEEDS-COL: GUC-wrap only when orgId present; no org predicate possible.
  const sql = `SELECT DISTINCT webhook_subscription_job_id AS job_id
         FROM shipping_tracking_numbers
        WHERE carrier = $1
          AND webhook_subscription_status = 'SUBMITTED'
          AND webhook_subscription_job_id IS NOT NULL
        LIMIT $2`;
  if (orgId) {
    return withTenantConnection(orgId, async (client) => {
      const result = await client.query(sql, [carrier, limit]);
      return result.rows.map((r) => r.job_id as string);
    });
  }
  const client = await pool.connect();
  try {
    const result = await client.query(sql, [carrier, limit]);
    return result.rows.map((r) => r.job_id as string);
  } finally {
    client.release();
  }
}

/** Flip every shipment carrying `jobId` to the reconciled terminal status. */
export async function markSubscriptionJobStatus(
  carrier: CarrierCode,
  jobId: string,
  status: 'COMPLETED' | 'FAILED',
  orgId?: OrgId,
): Promise<void> {
  // NEEDS-COL: GUC-wrap when orgId present; no org predicate possible on UPDATE.
  const sql = `UPDATE shipping_tracking_numbers SET
         webhook_subscription_status = $3,
         webhook_subscribed_at       = CASE WHEN $3 = 'COMPLETED' THEN now() ELSE webhook_subscribed_at END,
         updated_at                  = now()
       WHERE carrier = $1
         AND webhook_subscription_job_id = $2
         AND webhook_subscription_status = 'SUBMITTED'`;
  const args = [carrier, jobId, status];
  if (orgId) {
    await withTenantTransaction(orgId, (client) => client.query(sql, args));
    return;
  }
  const client = await pool.connect();
  try {
    await client.query(sql, args);
  } finally {
    client.release();
  }
}
