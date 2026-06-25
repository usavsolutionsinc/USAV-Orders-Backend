'use client';

/**
 * Analytics data for the Operations → Analytics mode.
 *
 * Composes ONLY tenant-scoped endpoints — no cross-tenant leak, no new backend,
 * no polling (staleTime only, per the neon-cost rule):
 *   - GET /api/inventory-events  → org-scoped lifecycle events (RLS via
 *     readTimeline/tenantQuery). We bucket these client-side into the throughput
 *     time-series + station/type breakdowns. (Deliberately NOT the kpi-table
 *     rollups — those tables lack organization_id and commingle tenants.)
 *   - GET /api/reports/velocity  → A/B/C/D inventory velocity tiers
 *   - GET /api/reports/dead-stock → dormant-SKU count
 *
 * inventory-events requires `sku_stock.view`; reports require `reports.view`. If
 * the viewer lacks a permission the fetch 403s, `safeJson` returns null, and the
 * affected panel renders its empty/locked state instead of throwing. The events
 * feed is capped at {@link EVENTS_LIMIT} most-recent rows in the window
 * (`truncated` surfaces when the cap is hit).
 */

import { useQuery } from '@tanstack/react-query';
import type { AnalyticsRange } from '@/components/sidebar/operations/operations-sidebar-shared';

const EVENTS_LIMIT = 2000;
const FAILURE_TYPES = new Set(['TEST_FAIL', 'SCRAPPED', 'HELD']);

interface InventoryEventRow {
  id: number;
  occurred_at: string | null;
  event_type: string;
  station: string | null;
  serial_unit_id: number | null;
}

interface InventoryEventsResponse {
  success: boolean;
  events: InventoryEventRow[];
}

interface VelocityResponse {
  success: boolean;
  rows: { velocity_tier: 'A' | 'B' | 'C' | 'D' }[];
}

interface DeadStockResponse {
  success: boolean;
  rows: unknown[];
}

async function safeJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function rangeWindow(range: AnalyticsRange): { granularity: 'hourly' | 'daily'; start: Date; end: Date } {
  const end = new Date();
  const start = new Date(end);
  if (range === '24h') {
    start.setHours(start.getHours() - 24);
    return { granularity: 'hourly', start, end };
  }
  if (range === '30d') {
    start.setDate(start.getDate() - 30);
    return { granularity: 'daily', start, end };
  }
  start.setDate(start.getDate() - 7);
  return { granularity: 'hourly', start, end };
}

/** Floor a date to the start of its hour/day slot (local time). */
function slotStart(d: Date, granularity: 'hourly' | 'daily'): number {
  const x = new Date(d);
  x.setMinutes(0, 0, 0);
  if (granularity === 'daily') x.setHours(0, 0, 0, 0);
  return x.getTime();
}

/** A continuous, gap-filled time-series from `start` to `end` at the granularity. */
function buildBuckets(
  events: InventoryEventRow[],
  start: Date,
  end: Date,
  granularity: 'hourly' | 'daily',
): { at: string; value: number }[] {
  const step = granularity === 'daily' ? 86_400_000 : 3_600_000;
  const from = slotStart(start, granularity);
  const to = slotStart(end, granularity);
  const counts = new Map<number, number>();
  for (let t = from; t <= to; t += step) counts.set(t, 0);

  for (const e of events) {
    if (!e.occurred_at) continue;
    const d = new Date(e.occurred_at);
    if (Number.isNaN(d.getTime())) continue;
    const key = slotStart(d, granularity);
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Array.from(counts.keys())
    .sort((a, b) => a - b)
    .map((t) => ({ at: new Date(t).toISOString(), value: counts.get(t) ?? 0 }));
}

function tally(
  events: InventoryEventRow[],
  pick: (e: InventoryEventRow) => string,
): { label: string; count: number; percent: number }[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    const key = pick(e);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = events.length || 1;
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count, percent: (count / total) * 100 }))
    .sort((a, b) => b.count - a.count);
}

export interface VelocityTier {
  tier: 'A' | 'B' | 'C' | 'D';
  count: number;
  percent: number;
}

export interface OperationsAnalyticsData {
  buckets: { at: string; value: number }[];
  byStation: { label: string; count: number; percent: number }[];
  byType: { label: string; count: number; percent: number }[];
  totals: { events: number; exceptions: number; uniqueEntities: number };
  velocityTiers: VelocityTier[];
  velocityAvailable: boolean;
  deadStockCount: number | null;
  truncated: boolean;
  granularity: 'hourly' | 'daily';
}

export function useOperationsAnalytics(range: AnalyticsRange) {
  const { granularity, start, end } = rangeWindow(range);
  const startIso = start.toISOString();

  const query = useQuery<OperationsAnalyticsData>({
    queryKey: ['ops-analytics', range],
    staleTime: 60_000,
    queryFn: async () => {
      const eventsParams = new URLSearchParams({ since: startIso, limit: String(EVENTS_LIMIT) });
      const [eventsRes, velocity, dead] = await Promise.all([
        safeJson<InventoryEventsResponse>(`/api/inventory-events?${eventsParams.toString()}`),
        safeJson<VelocityResponse>('/api/reports/velocity?limit=2000'),
        safeJson<DeadStockResponse>('/api/reports/dead-stock?minDays=90&limit=2000'),
      ]);

      const events = Array.isArray(eventsRes?.events) ? eventsRes!.events : [];
      const buckets = buildBuckets(events, start, end, granularity);
      const byStation = tally(events, (e) => (e.station ?? 'SYSTEM').toUpperCase());
      const byType = tally(events, (e) => e.event_type).slice(0, 8);

      const uniqueSerials = new Set(events.map((e) => e.serial_unit_id).filter((v): v is number => v != null));
      const totals = {
        events: events.length,
        exceptions: events.filter((e) => FAILURE_TYPES.has(e.event_type)).length,
        uniqueEntities: uniqueSerials.size,
      };

      const velocityAvailable = Boolean(velocity?.success && Array.isArray(velocity?.rows));
      const tierCounts: Record<'A' | 'B' | 'C' | 'D', number> = { A: 0, B: 0, C: 0, D: 0 };
      if (velocityAvailable && velocity) {
        for (const row of velocity.rows) {
          if (row.velocity_tier in tierCounts) tierCounts[row.velocity_tier] += 1;
        }
      }
      const tierTotal = tierCounts.A + tierCounts.B + tierCounts.C + tierCounts.D;
      const velocityTiers: VelocityTier[] = (['A', 'B', 'C', 'D'] as const).map((tier) => ({
        tier,
        count: tierCounts[tier],
        percent: tierTotal > 0 ? (tierCounts[tier] / tierTotal) * 100 : 0,
      }));

      const deadStockCount = dead?.success && Array.isArray(dead?.rows) ? dead.rows.length : null;

      return {
        buckets,
        byStation,
        byType,
        totals,
        velocityTiers,
        velocityAvailable,
        deadStockCount,
        truncated: events.length >= EVENTS_LIMIT,
        granularity,
      };
    },
  });

  return { ...query, granularity, range, eventsLimit: EVENTS_LIMIT };
}
