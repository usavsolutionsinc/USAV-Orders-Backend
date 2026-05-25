import type { DataSourceInfo } from '@/features/operations/components/DataSourcePopover';

/** Mirrors `src/app/api/dashboard/operations/route.ts` primary summary queries */
export const OPERATIONS_PRIMARY_KPI_SOURCES = {
  dailyVelocity: {
    headline: 'Daily velocity (floor-wide)',
    bullets: [
      'Postgres `station_activity_logs` (Neon pool).',
      '"Today" = `timezone(\'America/Los_Angeles\', created_at)::date` equal to LA calendar today.',
      'Distinct workflow key: COALESCE(shipment_id::text, scan_ref, id::text).',
      'Activity types: TRACKING_SCANNED, FNSKU_SCANNED, PACK_SCAN, PACK_COMPLETED, FBA_READY.',
      '`summary.all` — value plus % delta vs same query for yesterday.',
    ],
    endpoint: 'GET /api/dashboard/operations?timeRange=24h',
  } satisfies DataSourceInfo,

  testedToday: {
    headline: 'Tested today (TECH station)',
    bullets: [
      'Same table and LA date window as daily velocity.',
      'Rows where station = TECH and activity IN (TRACKING_SCANNED, FNSKU_SCANNED).',
      'Same DISTINCT key as velocity.',
      '`summary.tested` with yesterday comparison for the trend pill.',
    ],
    endpoint: 'GET /api/dashboard/operations?timeRange=24h',
  } satisfies DataSourceInfo,

  fbaIntake: {
    headline: 'FBA intake',
    bullets: [
      '`station_activity_logs` where activity_type = FNSKU_SCANNED on LA "today".',
      'Uses COUNT(*) (scan events), not distinct shipments.',
      '`summary.fba` vs yesterday for the headline delta.',
    ],
    endpoint: 'GET /api/dashboard/operations?timeRange=24h',
  } satisfies DataSourceInfo,

  repairQueue: {
    headline: 'Repair backlog',
    bullets: [
      'Table `repair_service` excluding terminal statuses Done, Shipped, Picked Up.',
      'Snapshot queue depth — not limited to repairs opened today.',
      'API fixes `repair` delta at 0 until day-over-day history is modeled.',
      '`summary.repair`.',
    ],
    endpoint: 'GET /api/dashboard/operations?timeRange=24h',
  } satisfies DataSourceInfo,
} as const;

/** Same route — `pending_orders` / `late_orders` CTE fields */
export const OPERATIONS_SECONDARY_KPI_SOURCES = {
  outOfStock: {
    headline: 'Out of stock',
    bullets: [
      'From the `/api/dashboard/operations` summary subquery on pending outbound orders:',
      '`pending_orders` joins orders + tracking; excludes shipped-by-carrier and station-log completion.',
      'Counts orders where trimmed `out_of_stock` is non-empty.',
      '`summary.outOfStock`.',
    ],
    endpoint: 'GET /api/dashboard/operations?timeRange=24h',
  } satisfies DataSourceInfo,

  testsOverdue: {
    headline: 'Tests overdue',
    bullets: [
      '`late_orders` CTE — pending orders with an open TEST assignment past `deadline_at`.',
      'Joins `work_assignments` (entity_type ORDER, work_type TEST, status ASSIGNED/IN_PROGRESS/OPEN).',
      '`summary.pendingLate` (count of those late rows).',
    ],
    endpoint: 'GET /api/dashboard/operations?timeRange=24h',
  } satisfies DataSourceInfo,
} as const;
