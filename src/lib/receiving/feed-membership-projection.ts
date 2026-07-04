/**
 * Receiving-triage → feed_memberships projection (universal-feed plan Phase 4
 * "backfill shared memberships for receiving triage").
 *
 * Mirrors what's currently in the receiving-TRIAGE queue into `feed_memberships`
 * (feed_key='receiving_triage', entity_type='RECEIVING', one row per carton) so
 * the shared read substrate — the AI's `getFeedState` tool today, more surfaces
 * later — sees a real feed instead of an empty table.
 *
 * CARTON-GRAIN + STABLE-COLUMN predicate (deliberately NOT a replica of the
 * rail's line-grain fetch SQL): a carton is "in triage" from arrival until it is
 * triaged or moved to unbox. Using the stable carton columns (received_at /
 * unboxed_at / unbox_opened_at / triage_complete / source) keeps this projection
 * from drifting against the evolving line-grain visibility rules (quantity,
 * workflow_status, serial_unit_provenance) that decide which LINES show inside a
 * carton — those don't change a carton's triage membership.
 *
 *   state:
 *     needs_match — an unmatched carton awaiting a PO match (the Unfound tab).
 *                   Mirrors the LIVE v_unfound_queue = any source='unmatched'
 *                   carton, WITH OR WITHOUT lines (the restrictive no-lines
 *                   redefinition in 2026-07-03b is .BLOCKED / not applied).
 *     active      — matched, arrived, awaiting triage (Prioritize/Scanned)
 *     done        — left triage (triage_complete, or moved to unbox)
 *
 * Reconcile without deletes: upsert the current active/needs_match set, then
 * flip EXISTING rows to 'done' once their carton leaves triage. That keeps
 * 'done' bounded to cartons that were actually tracked (no historical bloat),
 * and hard-deleted cartons are cleaned by the parent-delete trigger
 * (trg_delete_feed_memberships_on_receiving_delete).
 *
 * Tenancy: org-preserving set-based upsert on the OWNER pool (RLS-bypassed),
 * same posture as workflow/node-stats + operations/signal-rollup — every row is
 * stamped with its source `receiving.organization_id` (NOT NULL), never
 * cross-attributed. Deps-injected so it unit-tests DB-free.
 *
 * Other feed_keys (receiving_unbox, testing_queue, orders_unshipped, …) are the
 * same pattern over their own source tables — separate SoT mappings, not here.
 */

import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/drizzle/db';

interface TriageProjectionResult {
  success: boolean;
  /** active/needs_match rows upserted for cartons currently in triage. */
  upserted: number;
  /** existing rows flipped to 'done' because their carton left triage. */
  doneFlipped: number;
  windowDays: number;
}

export interface FeedProjectionDeps {
  execute: (query: SQL) => Promise<{ rows: unknown[] }>;
}

const defaultDeps: FeedProjectionDeps = { execute: (q) => db.execute(q) };

export async function projectReceivingTriageMemberships(
  windowDays = 90,
  deps: FeedProjectionDeps = defaultDeps,
): Promise<TriageProjectionResult> {
  const days = Number.isFinite(windowDays) ? Math.max(1, Math.min(Math.round(windowDays), 365)) : 90;

  // 1. Upsert the cartons currently in triage as active / needs_match.
  const upsert = await deps.execute(sql`
    INSERT INTO feed_memberships
      (organization_id, feed_key, entity_type, entity_id, state, occurred_at, title, tone, priority_tier)
    SELECT r.organization_id,
           'receiving_triage',
           'RECEIVING',
           r.id,
           CASE WHEN r.source = 'unmatched' THEN 'needs_match' ELSE 'active' END,
           COALESCE(r.received_at, r.receiving_date_time, r.created_at),
           COALESCE(
             (SELECT rl.item_name FROM receiving_lines rl
               WHERE rl.receiving_id = r.id AND rl.item_name IS NOT NULL
               ORDER BY rl.id LIMIT 1),
             r.zoho_purchaseorder_number,
             'Carton #' || r.id
           ),
           CASE WHEN r.source = 'unmatched' THEN 'warning' ELSE 'default' END,
           r.priority_tier
      FROM receiving r
     WHERE r.triage_complete = false
       AND r.unboxed_at IS NULL
       AND r.unbox_opened_at IS NULL
       AND COALESCE(r.received_at, r.receiving_date_time, r.created_at) >= NOW() - make_interval(days => ${days})
       AND (
         -- matched, arrived at dock, awaiting triage
         (r.received_at IS NOT NULL AND r.source IS DISTINCT FROM 'unmatched')
         OR
         -- unfound / unmatched (the Unfound tab) — any source='unmatched' carton,
         -- with or without lines (mirrors the live v_unfound_queue)
         r.source = 'unmatched'
       )
    ON CONFLICT (organization_id, feed_key, entity_type, entity_id)
    DO UPDATE SET state = EXCLUDED.state,
                  occurred_at = EXCLUDED.occurred_at,
                  title = EXCLUDED.title,
                  tone = EXCLUDED.tone,
                  priority_tier = EXCLUDED.priority_tier,
                  updated_at = NOW()
    RETURNING id
  `);

  // 2. Flip existing memberships to 'done' once their carton leaves triage
  //    (triaged, or moved to unbox). Only touches rows already projected.
  const flipped = await deps.execute(sql`
    UPDATE feed_memberships fm
       SET state = 'done', updated_at = NOW()
      FROM receiving r
     WHERE fm.organization_id = r.organization_id
       AND fm.feed_key = 'receiving_triage'
       AND fm.entity_type = 'RECEIVING'
       AND fm.entity_id = r.id
       AND fm.state <> 'done'
       AND (r.triage_complete = true OR r.unboxed_at IS NOT NULL OR r.unbox_opened_at IS NOT NULL)
    RETURNING fm.id
  `);

  return {
    success: true,
    upserted: upsert.rows.length,
    doneFlipped: flipped.rows.length,
    windowDays: days,
  };
}
