/**
 * Maps a receiving rail (feed id + cache scope) to the staff_rail_exclusions
 * `feed_key` its dismiss/read-filter uses (universal-feed plan Phase 4).
 *
 * The two scan surfaces map 1:1 to the two receiving feed_keys. The `scanned`
 * feed backs the triage Prioritize rail (scope='triage'); the unbox Queue is the
 * separate `unboxQueue` feed. So `scanned` maps to triage under 'triage' scope,
 * and its else-branch is a defensive default (receiving_unbox). Feeds that never
 * host a dismiss return null.
 *
 * Pure — unit-tested without the client.
 */

import type { ReceivingRailFeedId } from './feeds';
import type { ReceivingRailFeedKey } from '@/lib/receiving/rail-exclusions';

const TRIAGE_FEEDS: ReadonlySet<string> = new Set(['triageCombined', 'triageUnfound', 'triageDone']);
const UNBOX_FEEDS: ReadonlySet<string> = new Set(['unboxRecent', 'unboxQueue', 'viewed']);

export function railExclusionFeedKey(
  feedId: ReceivingRailFeedId,
  scope?: string,
): ReceivingRailFeedKey | null {
  if (TRIAGE_FEEDS.has(feedId)) return 'receiving_triage';
  if (UNBOX_FEEDS.has(feedId)) return 'receiving_unbox';
  // The shared Scanned feed: 'triage' scope = Prioritize (triage), else Queue (unbox).
  if (feedId === 'scanned') return scope === 'triage' ? 'receiving_triage' : 'receiving_unbox';
  return null;
}

/**
 * Translate an exclusion (entity_type, entity_id) into the rail-id the rows use
 * (getRowId = row.id): a receiving line keeps its positive id; an unfound carton
 * stub is the NEGATED receiving_id (feeds.ts shapes stub rows with id < 0).
 */
export function exclusionToRailId(entityType: string, entityId: number): number {
  return entityType === 'RECEIVING' ? -entityId : entityId;
}
