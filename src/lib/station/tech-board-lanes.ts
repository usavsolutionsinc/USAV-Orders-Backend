/**
 * Tech shipping-history board lanes (station-table-unification-plan §4.3) — the
 * TS single source of truth for how a tech record buckets into a Pipeline lane.
 * Per Decision 12, lane MEMBERSHIP is derived here (never re-implemented in SQL
 * for display); a counts endpoint may aggregate raw columns but the lane LABELS
 * come from this module. Mirrors the `FULFILLMENT_BOARD_LANES` +
 * `FULFILLMENT_STATE_META` split (descriptor list = order + icon; meta = label/
 * dot/description). Dots come from the label-registry tone map so they stay on
 * the theme palette (no raw neutrals).
 *
 * v1 lanes (O2 resolved): TODAY / THIS_WEEK / FBA. FBA is a distinct stream and
 * wins over day-banding; the "in-progress" lane is deferred (it needs scan-station
 * state, not history rows).
 */

import { toPSTDateKey } from '@/utils/date';
import { TONE_CLASSES } from '@/lib/labels/registry';
import type { LabelTone } from '@/lib/labels/types';

export type TechHistoryLane = 'TODAY' | 'THIS_WEEK' | 'FBA';
export type TechLaneIconKey = 'clock' | 'calendar' | 'package';

export interface TechLaneDescriptor {
  id: TechHistoryLane;
  iconKey: TechLaneIconKey;
  iconClass: string;
}

/** Canonical top→bottom lane order + icon binding. */
export const TECH_HISTORY_BOARD_LANES: readonly TechLaneDescriptor[] = [
  { id: 'TODAY', iconKey: 'clock', iconClass: 'text-blue-500' },
  { id: 'THIS_WEEK', iconKey: 'calendar', iconClass: 'text-indigo-500' },
  { id: 'FBA', iconKey: 'package', iconClass: 'text-orange-500' },
];

export interface TechLaneMeta {
  label: string;
  description: string;
  tone: LabelTone;
  dot: string;
}

export const TECH_HISTORY_STATE_META: Record<TechHistoryLane, TechLaneMeta> = {
  TODAY: { label: 'Today', description: 'Tested today (PST).', tone: 'blue', dot: TONE_CLASSES.blue.dot },
  THIS_WEEK: { label: 'This week', description: 'Tested earlier this week.', tone: 'indigo', dot: TONE_CLASSES.indigo.dot },
  FBA: { label: 'FBA', description: 'FBA / FNSKU tech scans.', tone: 'orange', dot: TONE_CLASSES.orange.dot },
};

/** Minimal structural input — the fields the bucket reads (decoupled from TechRecord). */
export interface TechLaneInput {
  created_at?: string | null;
  account_source?: string | null;
  source_kind?: string | null;
  order_id?: string | null;
  fnsku?: string | null;
}

/** Mirrors `isFbaTechRecord` (useTechTableController) — an FBA / FNSKU tech scan. */
export function isFbaTechLaneRow(r: TechLaneInput): boolean {
  return (
    r.account_source === 'fba' ||
    r.source_kind === 'fba_scan' ||
    String(r.order_id || '').toUpperCase() === 'FBA' ||
    Boolean(String(r.fnsku || '').trim())
  );
}

/**
 * Derive a tech record's lane. `todayKey` is a PST date key (`toPSTDateKey(now)`)
 * passed in by the caller so this stays pure/testable (no clock read here).
 */
export function bucketTechHistoryLane(r: TechLaneInput, todayKey: string): TechHistoryLane {
  if (isFbaTechLaneRow(r)) return 'FBA';
  return toPSTDateKey(r.created_at ?? undefined) === todayKey ? 'TODAY' : 'THIS_WEEK';
}
