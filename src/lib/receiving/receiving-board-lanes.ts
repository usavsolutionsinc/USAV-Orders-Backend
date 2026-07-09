/**
 * Receiving board lanes (station-table-unification-plan §4.1 / §4.2) — the TS SoT
 * for how a receiving line buckets into an Incoming or a History Pipeline lane.
 * Same Decision-12 discipline as the station lanes: membership is derived here
 * (never re-implemented in SQL for display); dots come from the label-registry
 * tone map. Bucket inputs are minimal structural shapes over `ReceivingLineRow`
 * so they stay pure/testable.
 */

import { TONE_CLASSES } from '@/lib/labels/registry';
import type { LabelTone } from '@/lib/labels/types';

// ── Incoming (§4.1) ──────────────────────────────────────────────────────────
export type ReceivingIncomingLane = 'DELIVERED_UNSCANNED' | 'IN_TRANSIT' | 'EXPECTED' | 'TRACKING_UNAVAILABLE';
export type ReceivingLaneIconKey = 'inbox' | 'truck' | 'clock' | 'alert' | 'check' | 'search';

export interface ReceivingLaneDescriptor<LaneId extends string> {
  id: LaneId;
  iconKey: ReceivingLaneIconKey;
  iconClass: string;
}

export const RECEIVING_INCOMING_BOARD_LANES: readonly ReceivingLaneDescriptor<ReceivingIncomingLane>[] = [
  { id: 'DELIVERED_UNSCANNED', iconKey: 'inbox', iconClass: 'text-rose-500' },
  { id: 'IN_TRANSIT', iconKey: 'truck', iconClass: 'text-blue-500' },
  { id: 'EXPECTED', iconKey: 'clock', iconClass: 'text-indigo-500' },
  { id: 'TRACKING_UNAVAILABLE', iconKey: 'alert', iconClass: 'text-amber-500' },
];

export interface ReceivingLaneMeta {
  label: string;
  description: string;
  tone: LabelTone;
  dot: string;
}

export const RECEIVING_INCOMING_STATE_META: Record<ReceivingIncomingLane, ReceivingLaneMeta> = {
  DELIVERED_UNSCANNED: { label: 'Delivered · unscanned', description: 'Carrier delivered — not yet received.', tone: 'rose', dot: TONE_CLASSES.rose.dot },
  IN_TRANSIT: { label: 'In transit', description: 'Moving through the carrier network.', tone: 'blue', dot: TONE_CLASSES.blue.dot },
  EXPECTED: { label: 'Expected', description: 'A PO is expected but not yet in transit.', tone: 'indigo', dot: TONE_CLASSES.indigo.dot },
  TRACKING_UNAVAILABLE: { label: 'Tracking unavailable', description: 'Carrier is access-blocked (e.g. USPS 403).', tone: 'amber', dot: TONE_CLASSES.amber.dot },
};

export interface ReceivingIncomingLaneInput {
  delivery_state?: string | null;
  workflow_status?: string | null;
}

export function bucketReceivingIncomingLane(r: ReceivingIncomingLaneInput): ReceivingIncomingLane {
  const s = String(r.delivery_state || '').toUpperCase();
  if (s === 'DELIVERED_UNOPENED') return 'DELIVERED_UNSCANNED';
  if (s === 'TRACKING_UNAVAILABLE') return 'TRACKING_UNAVAILABLE';
  if (s === 'IN_TRANSIT' || s === 'ARRIVING_TODAY' || s === 'OUT_FOR_DELIVERY' || s === 'STALLED') return 'IN_TRANSIT';
  return 'EXPECTED';
}

// ── History (§4.2) ───────────────────────────────────────────────────────────
export type ReceivingHistoryLane = 'PENDING_UNBOX' | 'RECENTLY_SCANNED' | 'RECEIVED' | 'UNFOUND';

export const RECEIVING_HISTORY_BOARD_LANES: readonly ReceivingLaneDescriptor<ReceivingHistoryLane>[] = [
  { id: 'PENDING_UNBOX', iconKey: 'clock', iconClass: 'text-yellow-500' },
  { id: 'RECENTLY_SCANNED', iconKey: 'inbox', iconClass: 'text-teal-500' },
  { id: 'RECEIVED', iconKey: 'check', iconClass: 'text-emerald-500' },
  { id: 'UNFOUND', iconKey: 'search', iconClass: 'text-orange-500' },
];

export const RECEIVING_HISTORY_STATE_META: Record<ReceivingHistoryLane, ReceivingLaneMeta> = {
  PENDING_UNBOX: { label: 'Pending unbox', description: 'Received row not yet unboxed.', tone: 'yellow', dot: TONE_CLASSES.yellow.dot },
  RECENTLY_SCANNED: { label: 'Recently scanned', description: 'First scanned within the last 24h.', tone: 'teal', dot: TONE_CLASSES.teal.dot },
  RECEIVED: { label: 'Received', description: 'Unboxed / completed.', tone: 'emerald', dot: TONE_CLASSES.emerald.dot },
  UNFOUND: { label: 'Unfound', description: 'No matched PO — needs matching.', tone: 'orange', dot: TONE_CLASSES.orange.dot },
};

export interface ReceivingHistoryLaneInput {
  workflow_status?: string | null;
  zoho_purchaseorder_id?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Derive a receiving line's History lane. `nowMs` is passed in for testability.
 * O1: "recently scanned" = the row's last write is within 24h (proxy for the
 * first-scan timestamp until a dedicated `scanned_at` is surfaced on the row).
 */
export function bucketReceivingHistoryLane(r: ReceivingHistoryLaneInput, nowMs: number): ReceivingHistoryLane {
  if (!r.zoho_purchaseorder_id) return 'UNFOUND';
  if (String(r.workflow_status || '').toUpperCase() === 'EXPECTED') return 'PENDING_UNBOX';
  const stamp = r.updated_at ?? r.created_at;
  const t = stamp ? new Date(stamp).getTime() : NaN;
  if (Number.isFinite(t) && nowMs - t <= DAY_MS) return 'RECENTLY_SCANNED';
  return 'RECEIVED';
}
