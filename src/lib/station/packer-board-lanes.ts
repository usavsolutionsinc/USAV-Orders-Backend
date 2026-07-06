/**
 * Packer history board lanes (station-table-unification-plan §4.4) — the TS SoT
 * for how a packer record buckets into a Pipeline lane (same Decision-12
 * discipline + descriptor/meta split as {@link import('./tech-board-lanes')}).
 *
 * Lanes: TODAY / THIS_WEEK / FBA / EXCEPTION. EXCEPTION (an unmatched
 * `row_source === 'exception'` pack) and FBA are distinct streams and win over
 * day-banding; EXCEPTION wins over FBA (an exception pack needs attention first).
 */

import { toPSTDateKey } from '@/utils/date';
import { isFbaOrder } from '@/utils/order-platform';
import { TONE_CLASSES } from '@/lib/labels/registry';
import type { LabelTone } from '@/lib/labels/types';

export type PackerHistoryLane = 'TODAY' | 'THIS_WEEK' | 'FBA' | 'EXCEPTION';
export type PackerLaneIconKey = 'clock' | 'calendar' | 'package' | 'alert';

export interface PackerLaneDescriptor {
  id: PackerHistoryLane;
  iconKey: PackerLaneIconKey;
  iconClass: string;
}

export const PACKER_HISTORY_BOARD_LANES: readonly PackerLaneDescriptor[] = [
  { id: 'TODAY', iconKey: 'clock', iconClass: 'text-blue-500' },
  { id: 'THIS_WEEK', iconKey: 'calendar', iconClass: 'text-indigo-500' },
  { id: 'FBA', iconKey: 'package', iconClass: 'text-orange-500' },
  { id: 'EXCEPTION', iconKey: 'alert', iconClass: 'text-rose-500' },
];

export interface PackerLaneMeta {
  label: string;
  description: string;
  tone: LabelTone;
  dot: string;
}

export const PACKER_HISTORY_STATE_META: Record<PackerHistoryLane, PackerLaneMeta> = {
  TODAY: { label: 'Today', description: 'Packed today (PST).', tone: 'blue', dot: TONE_CLASSES.blue.dot },
  THIS_WEEK: { label: 'This week', description: 'Packed earlier this week.', tone: 'indigo', dot: TONE_CLASSES.indigo.dot },
  FBA: { label: 'FBA', description: 'FBA / FNSKU pack scans.', tone: 'orange', dot: TONE_CLASSES.orange.dot },
  EXCEPTION: { label: 'Exception', description: 'Packed against an unmatched exception.', tone: 'rose', dot: TONE_CLASSES.rose.dot },
};

/** Minimal structural input — the fields the bucket reads (decoupled from PackerRecord). */
export interface PackerLaneInput {
  created_at?: string | null;
  order_id?: string | null;
  account_source?: string | null;
  tracking_type?: string | null;
  row_source?: string | null;
}

/** Mirrors `isFbaPackerRecord` (usePackerTableController): FBA order OR FNSKU tracking. */
export function isFbaPackerLaneRow(r: PackerLaneInput): boolean {
  return isFbaOrder(r.order_id, r.account_source) || String(r.tracking_type || '').toUpperCase() === 'FNSKU';
}

export function bucketPackerHistoryLane(r: PackerLaneInput, todayKey: string): PackerHistoryLane {
  if (r.row_source === 'exception') return 'EXCEPTION';
  if (isFbaPackerLaneRow(r)) return 'FBA';
  return toPSTDateKey(r.created_at ?? undefined) === todayKey ? 'TODAY' : 'THIS_WEEK';
}
