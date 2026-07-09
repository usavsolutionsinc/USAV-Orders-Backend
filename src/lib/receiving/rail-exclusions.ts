/**
 * Per-staff rail dismiss (universal-feed plan Phase 4 — "bulk actions target
 * the exclusion table").
 *
 * A receiving-rail "dismiss" hides an entity from THIS staffer's rail only, by
 * writing a `staff_rail_exclusions` row — reversible, never a shared delete
 * (the pre-Phase-4 bulk action hard-DELETE'd the receiving line/carton for
 * everyone). The rail read path (rail-exclusions read filter) anti-joins the
 * same set so the row simply disappears from that operator's view.
 *
 * Reuses the SAME guarded writers the AI mutation path uses
 * (`insertStaffRailExclusion` / `deleteStaffRailExclusion` in surfaces/feed-writes),
 * so there is exactly one writer per table. Deps-injected (default:
 * withTenantTransaction + tenantQuery) so it unit-tests DB-free.
 *
 * `station` is DERIVED server-side from the feed_key (not trusted from the
 * client) so the writer and the read filter always agree on the exclusion's
 * natural key. Receiving feeds all map to the physical 'RECEIVING' station; the
 * feed_key (receiving_triage vs receiving_unbox) carries the surface split.
 */

import { withTenantTransaction, tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import {
  insertStaffRailExclusion,
  deleteStaffRailExclusion,
  type FeedWriteClient,
} from '@/lib/surfaces/feed-writes';
import { isFeedKey } from '@/lib/surfaces/registry';

/** entity_types a receiving rail row can carry (positive id = line, negative = carton). */
export const RECEIVING_RAIL_ENTITY_TYPES = ['RECEIVING', 'RECEIVING_LINE'] as const;
export type ReceivingRailEntityType = (typeof RECEIVING_RAIL_ENTITY_TYPES)[number];

/** feed_keys a receiving rail dismiss may target. */
export const RECEIVING_RAIL_FEED_KEYS = ['receiving_triage', 'receiving_unbox'] as const;
export type ReceivingRailFeedKey = (typeof RECEIVING_RAIL_FEED_KEYS)[number];

export interface RailExclusionItem {
  entityType: string;
  entityId: number;
}

export interface RailExclusionArgs {
  orgId: OrgId;
  staffId: number;
  feedKey: string;
  items: RailExclusionItem[];
}

export interface RailExclusionResult {
  ok: boolean;
  status: 200 | 400;
  error?: string;
  /**
   * Valid items accepted + submitted (NOT necessarily rows changed — the
   * underlying INSERT … ON CONFLICT DO NOTHING / DELETE report ok regardless of
   * rowCount, so a re-dismiss of an already-excluded item still counts here).
   */
  count: number;
  /** The (entity_type, entity_id) pairs that were valid + acted on (for the optimistic UI). */
  applied: RailExclusionItem[];
}

export interface RailExclusionDeps {
  runTransaction: <T>(orgId: OrgId, fn: (client: FeedWriteClient) => Promise<T>) => Promise<T>;
  query: typeof tenantQuery;
}

const defaultDeps: RailExclusionDeps = {
  // withTenantTransaction hands the callback a PoolClient, which structurally
  // satisfies FeedWriteClient (has .query) — bridge it explicitly.
  runTransaction: (orgId, fn) => withTenantTransaction(orgId, (client) => fn(client)),
  query: tenantQuery,
};

/** Receiving feeds all live at the physical RECEIVING station; feed_key carries the surface. */
export function stationForReceivingFeed(_feedKey: string): string {
  return 'RECEIVING';
}

function validate(args: RailExclusionArgs): { error: string } | { items: RailExclusionItem[] } {
  if (!isFeedKey(args.feedKey) || !(RECEIVING_RAIL_FEED_KEYS as readonly string[]).includes(args.feedKey)) {
    return { error: `feedKey must be one of ${RECEIVING_RAIL_FEED_KEYS.join(', ')}` };
  }
  if (!Array.isArray(args.items) || args.items.length === 0) return { error: 'items must be a non-empty array' };
  if (args.items.length > 500) return { error: 'too many items (max 500)' };
  const clean: RailExclusionItem[] = [];
  for (const it of args.items) {
    if (!(RECEIVING_RAIL_ENTITY_TYPES as readonly string[]).includes(it.entityType)) {
      return { error: `entityType must be one of ${RECEIVING_RAIL_ENTITY_TYPES.join(', ')}` };
    }
    if (typeof it.entityId !== 'number' || !Number.isSafeInteger(it.entityId) || it.entityId <= 0) {
      return { error: 'each entityId must be a positive integer' };
    }
    clean.push({ entityType: it.entityType, entityId: it.entityId });
  }
  return { items: clean };
}

/** Dismiss (exclude) each item from the staffer's rail. Idempotent per natural key. */
export async function addRailExclusions(
  args: RailExclusionArgs,
  deps: RailExclusionDeps = defaultDeps,
): Promise<RailExclusionResult> {
  const v = validate(args);
  if ('error' in v) return { ok: false, status: 400, error: v.error, count: 0, applied: [] };
  const station = stationForReceivingFeed(args.feedKey);

  const count = await deps.runTransaction(args.orgId, async (client) => {
    let n = 0;
    for (const it of v.items) {
      const r = await insertStaffRailExclusion(client, args.orgId, {
        staffId: args.staffId,
        station,
        feedKey: args.feedKey,
        entityType: it.entityType,
        entityId: it.entityId,
      });
      if (r.ok) n += 1;
    }
    return n;
  });

  return { ok: true, status: 200, count, applied: v.items };
}

/** Restore (un-dismiss) each item for the staffer. */
export async function removeRailExclusions(
  args: RailExclusionArgs,
  deps: RailExclusionDeps = defaultDeps,
): Promise<RailExclusionResult> {
  const v = validate(args);
  if ('error' in v) return { ok: false, status: 400, error: v.error, count: 0, applied: [] };
  const station = stationForReceivingFeed(args.feedKey);

  const count = await deps.runTransaction(args.orgId, async (client) => {
    let n = 0;
    for (const it of v.items) {
      const r = await deleteStaffRailExclusion(client, args.orgId, {
        staffId: args.staffId,
        station,
        feedKey: args.feedKey,
        entityType: it.entityType,
        entityId: it.entityId,
      });
      if (r.ok) n += 1;
    }
    return n;
  });

  return { ok: true, status: 200, count, applied: v.items };
}

/** The staffer's current exclusion set for a feed (for the rail read filter). */
export async function listRailExclusions(
  orgId: OrgId,
  staffId: number,
  feedKey: string,
  deps: RailExclusionDeps = defaultDeps,
): Promise<RailExclusionItem[]> {
  if (!isFeedKey(feedKey) || !(RECEIVING_RAIL_FEED_KEYS as readonly string[]).includes(feedKey)) return [];
  const station = stationForReceivingFeed(feedKey);
  const r = await deps.query<{ entity_type: string; entity_id: string }>(
    orgId,
    `SELECT entity_type, entity_id
       FROM staff_rail_exclusions
      WHERE organization_id = $1 AND staff_id = $2 AND station = $3 AND feed_key = $4`,
    [orgId, staffId, station, feedKey],
  );
  return r.rows.map((row) => ({ entityType: row.entity_type, entityId: Number(row.entity_id) }));
}
