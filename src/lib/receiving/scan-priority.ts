/**
 * Receiving "Prioritize" (triage → found) priority model — the client-safe,
 * pure source of truth for how a scanned-but-not-unboxed carton ranks.
 *
 * The ordering itself is computed server-side in /api/receiving-lines via
 * RECEIVING_PRIORITY_RANK_SQL (`?sort=priority`): unfound/untagged first, then
 * amazon → ebay → goodwill → other, recency as the tiebreak. This module mirrors
 * that exact rank so the right pane can *visualize* the priority the rail already
 * sorts by (queue health tiles + the focused carton's tier / position / aging)
 * without re-implementing or re-sorting anything.
 *
 * Pure + dependency-free so it stays usable from any client surface. Tone keys
 * are plain strings; the styling lives with the component that renders them.
 */

export type PriorityTierKey = 'unfound' | 'amazon' | 'ebay' | 'goodwill' | 'other';

/** Tone token the right-pane tiles/header map to Tailwind classes. */
export type PriorityTone = 'rose' | 'amber' | 'blue' | 'violet' | 'gray';

export interface PriorityTierMeta {
  key: PriorityTierKey;
  label: string;
  /** Lower = more urgent. Mirrors RECEIVING_PRIORITY_RANK_SQL. */
  rank: number;
  tone: PriorityTone;
}

/** Rank order matches the SQL CASE in /api/receiving-lines (sort=priority). */
export const PRIORITY_TIERS: readonly PriorityTierMeta[] = [
  { key: 'unfound', label: 'Unfound', rank: 1, tone: 'rose' },
  { key: 'amazon', label: 'Amazon', rank: 2, tone: 'amber' },
  { key: 'ebay', label: 'eBay', rank: 3, tone: 'blue' },
  { key: 'goodwill', label: 'Goodwill', rank: 4, tone: 'violet' },
  { key: 'other', label: 'Other', rank: 5, tone: 'gray' },
] as const;

const TIER_BY_KEY: Record<PriorityTierKey, PriorityTierMeta> = PRIORITY_TIERS.reduce(
  (acc, t) => {
    acc[t.key] = t;
    return acc;
  },
  {} as Record<PriorityTierKey, PriorityTierMeta>,
);

export function tierMeta(key: PriorityTierKey): PriorityTierMeta {
  return TIER_BY_KEY[key];
}

/** Minimal row shape this module needs — a structural subset of ReceivingLineRow. */
export interface PriorityRowLike {
  id: number;
  receiving_source?: string | null;
  source_platform?: string | null;
  received_at?: string | null;
  created_at?: string | null;
  last_activity_at?: string | null;
}

/** Classify a row into a priority tier — mirrors the server CASE expression. */
export function priorityTierOf(row: PriorityRowLike): PriorityTierKey {
  if ((row.receiving_source ?? '') === 'unmatched' || !row.source_platform) {
    return 'unfound';
  }
  switch (row.source_platform.trim().toLowerCase()) {
    case 'amazon':
      return 'amazon';
    case 'ebay':
      return 'ebay';
    case 'goodwill':
      return 'goodwill';
    default:
      return 'other';
  }
}

/**
 * When the carton started waiting in this queue. Anchors on the door-scan time
 * (`received_at`); falls back to created/last-activity so the aging chip is
 * never blank when the primary timestamp is missing.
 */
export function waitingSince(row: PriorityRowLike): string | null {
  return row.received_at ?? row.created_at ?? row.last_activity_at ?? null;
}

/** Compact "how long waiting" label: now · 5m · 3h · 2d · 3w · 4mo · 1y. */
export function formatWaitingShort(date: string | number | Date, now = Date.now()): string {
  const ms = now - new Date(date).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return 'now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (days < 30) return `${weeks}w`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(days / 365)}y`;
}

export interface TierSummary extends PriorityTierMeta {
  count: number;
  /** ISO timestamp of the oldest-waiting carton in this tier, or null. */
  oldestAt: string | null;
}

/**
 * Bucket the queue into per-tier counts + the oldest-waiting timestamp per tier.
 * Returns every tier present in `rows` in rank order (urgent first).
 */
export function summarizePriorityQueue(rows: PriorityRowLike[]): {
  tiers: TierSummary[];
  total: number;
} {
  const buckets = new Map<PriorityTierKey, { count: number; oldestMs: number; oldestAt: string | null }>();
  for (const row of rows) {
    const key = priorityTierOf(row);
    const bucket = buckets.get(key) ?? { count: 0, oldestMs: Infinity, oldestAt: null };
    bucket.count += 1;
    const since = waitingSince(row);
    if (since) {
      const ms = new Date(since).getTime();
      if (Number.isFinite(ms) && ms < bucket.oldestMs) {
        bucket.oldestMs = ms;
        bucket.oldestAt = since;
      }
    }
    buckets.set(key, bucket);
  }

  const tiers = PRIORITY_TIERS.filter((t) => buckets.has(t.key)).map((t) => {
    const b = buckets.get(t.key)!;
    return { ...t, count: b.count, oldestAt: b.oldestAt };
  });

  return { tiers, total: rows.length };
}

/** 1-based position of `lineId` in the priority-ordered queue, plus the total. */
export function queuePosition(
  rows: PriorityRowLike[],
  lineId: number,
): { index: number; total: number } | null {
  const i = rows.findIndex((r) => r.id === lineId);
  if (i < 0) return null;
  return { index: i + 1, total: rows.length };
}
