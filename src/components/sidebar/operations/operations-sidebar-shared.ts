/**
 * Shared types + constants for the Operations master-page sidebar.
 *
 * The Operations page is a single contextual sidebar + a mostly-visual right
 * pane (the house sidebar-mode contract). The four modes below are the
 * top-level switcher; each owns its own search placeholder, result list, and
 * right-pane view. `?mode=` in the URL is the single source of truth — never a
 * local `useState`. Mirrors `receiving-sidebar-shared.ts`.
 *
 * Pure data only — no JSX.
 */

import { Activity, BarChart3, Sparkles, History } from '@/components/Icons';
import type { HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import type { JourneyDimension } from '@/lib/timeline/journey';

// ── Sidebar mode switcher ───────────────────────────────────────────────────

export type OperationsMode = 'live' | 'analytics' | 'insights' | 'history';

/**
 * `live` is the default and stays on the bare `/operations` path (no `?mode=`)
 * for deep-link + realtime back-compat — it renders the existing floor
 * dashboard. The other three flip `?mode=`.
 *
 * - live      → real-time operations (the existing OperationsDashboard)
 * - analytics → deep analytics dashboard (trends, breakdowns, inventory health)
 * - insights  → AI assistant, pre-scoped to live ops/inventory context
 * - history   → audit + inventory-event timeline of past operations
 */
export const OPERATIONS_MODE_ITEMS: HorizontalSliderItem[] = [
  { id: 'live',      label: 'Live',      icon: Activity },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'insights',  label: 'Insights',  icon: Sparkles },
  { id: 'history',   label: 'History',   icon: History },
];

export const DEFAULT_OPERATIONS_MODE: OperationsMode = 'live';

export function parseOperationsMode(raw: string | null | undefined): OperationsMode {
  return raw === 'analytics' || raw === 'insights' || raw === 'history' ? raw : 'live';
}

/**
 * URL params owned by a specific mode. Cleared on a mode switch so the next
 * mode lands on a clean default state (sidebar-mode law #4).
 */
export const OPERATIONS_MODE_SCOPED_PARAMS = [
  'q',        // search query (history)
  'open',     // selected entity in the right pane
  'section',  // analytics section anchor
  'range',    // analytics time range
  'segment',  // analytics series segment
  'staffId',  // history actor filter
  'station',  // legacy single-station filter (superseded by `stations`)
  // ── Master Operations Journey (History mode) ──
  'dim',      // journey dimension: order | serial | tracking
  'order',    // focused order number
  'serial',   // focused serial
  'tracking', // focused tracking number
  'from',     // date range start (ISO)
  'until',    // date range end (ISO)
  'stations', // multi-station filter (CSV)
  'types',    // multi event-type filter (CSV)
  'status',   // status filter
  'sources',  // spine filter (CSV)
  'view',     // applied saved-view id
  'cursor',   // browse keyset cursor (transient; cleared on filter change)
] as const;

// ── Master Operations Journey (History mode) ────────────────────────────────

/** Journey grouping dimension — one band per order / serial / tracking number. */
export const JOURNEY_DIMENSION_ITEMS: HorizontalSliderItem[] = [
  { id: 'order', label: 'Order' },
  { id: 'serial', label: 'Serial' },
  { id: 'tracking', label: 'Tracking' },
];

export function parseJourneyDimension(raw: string | null | undefined): JourneyDimension {
  return raw === 'serial' || raw === 'tracking' ? raw : 'order';
}

/** Station facets — the UI vocab the journey endpoint maps to each spine. */
export const JOURNEY_STATION_ITEMS: HorizontalSliderItem[] = [
  { id: 'RECEIVING', label: 'Receiving' },
  { id: 'TECH', label: 'Tech' },
  { id: 'PACK', label: 'Pack' },
  { id: 'SHIP', label: 'Ship' },
  { id: 'FBA', label: 'FBA' },
];

/** Curated event-type facets (raw event_type / activity_type / action values). */
export const JOURNEY_TYPE_ITEMS: { id: string; label: string }[] = [
  { id: 'RECEIVED', label: 'Received' },
  { id: 'TEST_PASS', label: 'Tested — Pass' },
  { id: 'TEST_FAIL', label: 'Tested — Fail' },
  { id: 'GRADED', label: 'Graded' },
  { id: 'TRACKING_SCANNED', label: 'Tech scan' },
  { id: 'SERIAL_ADDED', label: 'Serial added' },
  { id: 'PACK_COMPLETED', label: 'Packed' },
  { id: 'SHIP_CONFIRM', label: 'Shipped out' },
  { id: 'SHIPPED', label: 'Shipped' },
  { id: 'RETURNED', label: 'Returned' },
];

/** Which URL param carries the focused entity for a given dimension. */
export const JOURNEY_DIMENSION_PARAM: Record<JourneyDimension, 'order' | 'serial' | 'tracking'> = {
  order: 'order',
  serial: 'serial',
  tracking: 'tracking',
};

// Analytics time-range options (drive the kpi-table window + granularity).
export type AnalyticsRange = '24h' | '7d' | '30d';

export const ANALYTICS_RANGE_LABELS: Record<AnalyticsRange, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

export function parseAnalyticsRange(raw: string | null | undefined): AnalyticsRange {
  return raw === '24h' || raw === '30d' ? raw : '7d';
}
