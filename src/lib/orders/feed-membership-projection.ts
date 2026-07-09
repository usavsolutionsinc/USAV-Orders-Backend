/**
 * orders_unshipped → feed_memberships projection (Phase 5 of
 * docs/unshipped-dashboard-performance-plan.md; universal-feed plan Phase 4
 * "backfill shared memberships").
 *
 * Mirrors the live Unshipped fulfillment queue into `feed_memberships`
 * (feed_key='orders_unshipped', entity_type='ORDER', one row per open order) so
 * the shared read substrate — getFeedState today, a paginated dashboard read
 * later — sees a real feed with per-lane counts at sub-100ms, instead of the
 * unbounded `/api/orders?fulfillmentScope=true` CTE.
 *
 * DECISION 8 — the fulfillment LANE is computed in NODE, never in SQL. The fetch
 * pulls only the RAW signals (shipment_id / has_tech_scan / out_of_stock); this
 * module runs each through the TS SoT `deriveFulfillmentState`
 * (src/lib/order-lifecycle.ts) and stores the resulting lane
 * (pending | tested | blocked) directly in `feed_memberships.state`. That reuses
 * the existing idx_feed_memberships_org_feed_state_time index for per-lane counts
 * + keyset pagination with no SQL re-implementation of the lane rule and no new
 * column. `occurred_at` = the order's deadline (the queue sort key).
 *
 * Scope mirrors `/api/orders?fulfillmentScope=true` (and /api/orders/queue-counts):
 * labeled (shipment_id), not carrier-shipped, not Amazon-fulfilled, not yet
 * packed (no PACK event). Reconcile WITHOUT deletes: upsert the current in-queue
 * set, then flip existing rows to 'done' once their order leaves the queue.
 * Hard-deleted orders are cleaned by the existing parent-delete trigger
 * (trg_delete_feed_memberships_on_order_delete, migration 2026-07-03j).
 *
 * Tenancy: org-preserving set-based upsert on the OWNER pool (RLS-bypassed), same
 * posture as the receiving-triage projector — every row stamped with its source
 * `orders.organization_id`. Deps-injected so it unit-tests DB-free.
 */

import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/drizzle/db';
import { SHIPPED_BY_CARRIER_SQL } from '@/lib/sql-fragments';
import { PACK_ACTIVITY_TYPES, sqlInList } from '@/lib/station-activity';
import { deriveFulfillmentState, type FulfillmentState } from '@/lib/unshipped-state';

/** Lane → feed tone (FeedMembershipTone / TimelineTone). */
const LANE_TONE: Record<FulfillmentState, 'default' | 'success' | 'danger'> = {
  PENDING: 'default',
  TESTED: 'success',
  BLOCKED: 'danger',
};

type LaneState = Lowercase<FulfillmentState>;

export interface OrdersUnshippedProjectionResult {
  success: boolean;
  /** in-queue rows upserted (all lanes). */
  upserted: number;
  /** existing rows flipped to 'done' because their order left the queue. */
  doneFlipped: number;
  windowDays: number;
  /** per-lane upsert breakdown (the lanes computed in Node). */
  byLane: Record<LaneState, number>;
}

export interface FeedProjectionDeps {
  execute: (query: SQL) => Promise<{ rows: unknown[] }>;
}

const defaultDeps: FeedProjectionDeps = { execute: (q) => db.execute(q) };

/** Bulk-upsert batch size — keeps a single VALUES list well under param limits. */
const UPSERT_CHUNK = 500;

interface RawOrderRow {
  id: number | string;
  organization_id: string;
  shipment_id: number | string | null;
  has_tech_scan: boolean;
  out_of_stock: string | null;
  occurred_at: Date | string;
  title: string;
}

export async function projectOrdersUnshippedMemberships(
  windowDays = 90,
  deps: FeedProjectionDeps = defaultDeps,
): Promise<OrdersUnshippedProjectionResult> {
  const days = Number.isFinite(windowDays) ? Math.max(1, Math.min(Math.round(windowDays), 365)) : 90;

  // 1. Fetch the RAW signals for orders currently in the fulfillment queue —
  //    scope-identical to /api/orders?fulfillmentScope=true. Lane is NOT computed
  //    here (Decision 8): only the inputs to deriveFulfillmentState.
  const fetched = await deps.execute(sql`
    SELECT o.id,
           o.organization_id,
           o.shipment_id,
           (EXISTS (
             SELECT 1 FROM station_activity_logs sal
             WHERE sal.shipment_id IS NOT NULL AND sal.shipment_id = o.shipment_id
           )) AS has_tech_scan,
           o.out_of_stock,
           COALESCE(wa.deadline_at, o.created_at) AS occurred_at,
           COALESCE(NULLIF(o.product_title, ''), 'Order ' || COALESCE(o.order_id, o.id::text)) AS title
      FROM orders o
      LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
      LEFT JOIN LATERAL (
        SELECT w.deadline_at
          FROM work_assignments w
         WHERE w.entity_type = 'ORDER' AND w.entity_id = o.id AND w.work_type = 'TEST'
         ORDER BY CASE w.status
                    WHEN 'IN_PROGRESS' THEN 1 WHEN 'ASSIGNED' THEN 2
                    WHEN 'OPEN' THEN 3 WHEN 'DONE' THEN 4 ELSE 5 END,
                  w.updated_at DESC, w.id DESC
         LIMIT 1
      ) wa ON TRUE
     WHERE o.shipment_id IS NOT NULL
       AND NOT ${sql.raw(SHIPPED_BY_CARRIER_SQL)}
       AND COALESCE(o.fulfillment_channel, '') <> 'AFN'
       AND NOT EXISTS (
         SELECT 1 FROM station_activity_logs sal
         WHERE sal.shipment_id IS NOT NULL AND sal.shipment_id = o.shipment_id
           AND sal.activity_type IN (${sql.raw(sqlInList(PACK_ACTIVITY_TYPES))})
       )
       AND COALESCE(wa.deadline_at, o.created_at) >= NOW() - make_interval(days => ${days})
  `);
  const rows = fetched.rows as RawOrderRow[];

  // 2. NODE: compute each order's lane through the TS SoT. This is the whole
  //    point — the lane rule lives once, in deriveFulfillmentState.
  const byLane: Record<LaneState, number> = { pending: 0, tested: 0, blocked: 0 };
  const memberships = rows.map((r) => {
    const lane = deriveFulfillmentState({
      shipmentId: r.shipment_id,
      hasTechScan: Boolean(r.has_tech_scan),
      outOfStock: r.out_of_stock,
    });
    const state = lane.toLowerCase() as LaneState;
    byLane[state] += 1;
    return { org: r.organization_id, id: Number(r.id), state, tone: LANE_TONE[lane], occurredAt: r.occurred_at, title: r.title };
  });

  // 3. Bulk upsert the in-queue set (chunked), stamping the Node-computed lane.
  for (let i = 0; i < memberships.length; i += UPSERT_CHUNK) {
    const chunk = memberships.slice(i, i + UPSERT_CHUNK);
    const values = chunk.map(
      (m) => sql`(${m.org}::uuid, 'orders_unshipped', 'ORDER', ${m.id}::bigint, ${m.state}, ${m.occurredAt}::timestamptz, ${m.title}, ${m.tone})`,
    );
    await deps.execute(sql`
      INSERT INTO feed_memberships
        (organization_id, feed_key, entity_type, entity_id, state, occurred_at, title, tone)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (organization_id, feed_key, entity_type, entity_id)
      DO UPDATE SET state = EXCLUDED.state,
                    occurred_at = EXCLUDED.occurred_at,
                    title = EXCLUDED.title,
                    tone = EXCLUDED.tone,
                    updated_at = NOW()
    `);
  }

  // 4. Flip existing memberships to 'done' once their order leaves the queue
  //    (packed / shipped / label removed) — i.e. no longer in fulfillment scope.
  //    Only touches rows already projected (state <> 'done').
  const flipped = await deps.execute(sql`
    UPDATE feed_memberships fm
       SET state = 'done', updated_at = NOW()
     WHERE fm.feed_key = 'orders_unshipped'
       AND fm.entity_type = 'ORDER'
       AND fm.state <> 'done'
       AND NOT EXISTS (
         SELECT 1
           FROM orders o
           LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
          WHERE o.id = fm.entity_id
            AND o.organization_id = fm.organization_id
            AND o.shipment_id IS NOT NULL
            AND NOT ${sql.raw(SHIPPED_BY_CARRIER_SQL)}
            AND COALESCE(o.fulfillment_channel, '') <> 'AFN'
            AND NOT EXISTS (
              SELECT 1 FROM station_activity_logs sal
              WHERE sal.shipment_id IS NOT NULL AND sal.shipment_id = o.shipment_id
                AND sal.activity_type IN (${sql.raw(sqlInList(PACK_ACTIVITY_TYPES))})
            )
       )
    RETURNING fm.id
  `);

  return {
    success: true,
    upserted: memberships.length,
    doneFlipped: flipped.rows.length,
    windowDays: days,
    byLane,
  };
}
