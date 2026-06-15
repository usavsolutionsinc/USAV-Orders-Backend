import type { TimelineItem, TimelineTone } from './types';

/**
 * One tech-aggregator event, as produced by `getTechSessionDetail`
 * (src/lib/audit-log/tech-aggregator.ts). Decoupled structural type (a subset)
 * so this client-safe adapter doesn't import the server-only aggregator.
 *
 * `kind` is the source-specific event key: the `inventory_events.event_type`
 * (TEST_PASS…), the `station_activity_logs.activity_type` (FNSKU_SCANNED…), the
 * `audit_logs.action` (tech.qc.pass…), or the synthetic 'SERIAL_TESTED'.
 */
export interface TechTimelineRow {
  id: string;
  occurred_at: string | null;
  kind: string;
  actor_name: string | null;
  station: string | null;
  serial_number: string | null;
  sku: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/**
 * kind → display across all tech sources (lifecycle, scans, qc verdicts).
 * Unmapped kinds fall back to a prettified label + muted tone.
 */
const KIND_MAP: Record<string, { title: string; tone: TimelineTone }> = {
  // inventory_events lifecycle
  RECEIVED: { title: 'Received', tone: 'info' },
  TEST_START: { title: 'Testing started', tone: 'info' },
  TEST_PASS: { title: 'Tested — Pass', tone: 'success' },
  TEST_FAIL: { title: 'Tested — Fail', tone: 'danger' },
  GRADED: { title: 'Graded', tone: 'info' },
  PUTAWAY: { title: 'Put away', tone: 'muted' },
  MOVED: { title: 'Moved', tone: 'muted' },
  LABELED: { title: 'Labeled', tone: 'info' },
  // synthetic + scan sources
  SERIAL_TESTED: { title: 'Serial tested', tone: 'success' },
  SERIAL_ADDED: { title: 'Serial added', tone: 'muted' },
  FNSKU_SCANNED: { title: 'FNSKU scanned', tone: 'info' },
  TRACKING_SCANNED: { title: 'Tracking scanned', tone: 'info' },
  LABEL_PRINTED: { title: 'Label printed', tone: 'info' },
  PACK_COMPLETED: { title: 'Packed', tone: 'success' },
  PACK_SCAN: { title: 'Pack scan', tone: 'muted' },
  SHIP_CONFIRM: { title: 'Scanned out', tone: 'success' },
  // audit_logs qc verdict actions
  'tech.qc.pass': { title: 'Tested — Pass', tone: 'success' },
  'tech.qc.fail': { title: 'Tested — Fail', tone: 'danger' },
  'tech.qc.retest': { title: 'Re-test', tone: 'warning' },
};

function pretty(kind: string): string {
  const s = kind.replace(/[._-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function statusOf(blob: Record<string, unknown> | null): string | null {
  const v = blob?.status ?? blob?.next_status ?? blob?.prev_status;
  return v == null ? null : String(v);
}

/**
 * Map tech-aggregator events → {@link TimelineItem}s for the shared
 * `EventTimeline`, so the Tech detail uses the same trail as Shipped / Incoming.
 */
export function techEventsToTimeline(rows: TechTimelineRow[]): TimelineItem[] {
  return rows.map((r) => {
    const mapped = KIND_MAP[r.kind];
    const title = mapped?.title ?? pretty(r.kind);
    const tone = mapped?.tone ?? 'muted';

    const from = statusOf(r.before);
    const to = statusOf(r.after);
    const subtitle = from && to && from !== to ? `${from} → ${to}` : undefined;
    // Serial / SKU → last-4 CopyChip (consistent with every other id surface).
    let ref: TimelineItem['ref'];
    if (r.serial_number) ref = { value: r.serial_number, kind: 'serial' };
    else if (r.sku) ref = { value: r.sku, kind: 'sku' };

    return {
      id: r.id,
      at: r.occurred_at,
      title,
      tone,
      subtitle,
      ref,
      actor: r.actor_name ?? undefined,
    };
  });
}
