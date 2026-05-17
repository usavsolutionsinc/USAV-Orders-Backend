/**
 * Shared filter envelope for /api/audit-log/* endpoints.
 *
 * URL params:
 *   day=YYYY-MM-DD     — single-day shortcut (resolved to start/end client-side
 *                        in the user's TZ, then sent as ISO via start/end)
 *   start=ISO end=ISO  — explicit range; overrides day if both present
 *   staffId=<int>      — actor filter (audit_logs.actor_staff_id ∪ SAL.staff_id)
 *   sku=<code>         — SKU filter (exact match against the resolved SKU)
 *   q=<text>           — section-specific typeahead (handled per endpoint)
 *   limit/offset       — pagination
 *
 * The helper is intentionally section-agnostic. Each endpoint picks the
 * column names that mean "when did this happen" / "who did it" / "what SKU"
 * via the FilterColumnMap, and the SQL fragments come out parameterised and
 * safe to splice into a larger WHERE.
 */

import 'server-only';

/** Date range bounds resolved to UTC ISO timestamps. */
export interface DateRange {
  start: string | null;
  end: string | null;
}

export interface AuditLogFilters {
  range: DateRange;
  staffId: number | null;
  sku: string | null;
  q: string | null;
  limit: number;
  offset: number;
}

const MAX_REPORT_DAYS = 31;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseIntOr(value: string | null, fallback: number, max?: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  const truncated = Math.floor(n);
  return max != null ? Math.min(truncated, max) : truncated;
}

function isoOrNull(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Resolve `day=YYYY-MM-DD` to a UTC start/end pair.
 * Used as a server-side fallback when the client didn't compute the bounds —
 * accepts the ambiguity (UTC day, not the user's local day).
 */
function dayToRange(day: string | null): DateRange {
  if (!day) return { start: null, end: null };
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!match) return { start: null, end: null };
  const start = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function parseFilters(searchParams: URLSearchParams): AuditLogFilters {
  const explicitStart = isoOrNull(searchParams.get('start'));
  const explicitEnd = isoOrNull(searchParams.get('end'));
  const range: DateRange =
    explicitStart || explicitEnd
      ? { start: explicitStart, end: explicitEnd }
      : dayToRange(searchParams.get('day'));

  const staffIdRaw = Number(searchParams.get('staffId'));
  const staffId =
    Number.isFinite(staffIdRaw) && staffIdRaw > 0 ? Math.floor(staffIdRaw) : null;

  const sku = (searchParams.get('sku') || '').trim() || null;
  const q = (searchParams.get('q') || '').trim() || null;

  const limit = Math.max(1, parseIntOr(searchParams.get('limit'), DEFAULT_LIMIT, MAX_LIMIT));
  const offset = parseIntOr(searchParams.get('offset'), 0);

  return { range, staffId, sku, q, limit, offset };
}

/**
 * Throw a 400-friendly error when the requested range exceeds the report cap.
 * Daily-report endpoints should call this; list endpoints can skip it.
 */
export function assertReportRange(range: DateRange): void {
  if (!range.start || !range.end) return;
  const span = new Date(range.end).getTime() - new Date(range.start).getTime();
  const days = span / (24 * 60 * 60 * 1000);
  if (days > MAX_REPORT_DAYS) {
    throw new RangeError(
      `Report range too wide (${days.toFixed(1)} days). Max ${MAX_REPORT_DAYS} days — narrow the date filter.`,
    );
  }
}

/**
 * Map a filter dimension to the SQL column expression that represents it for a
 * particular query. Each endpoint supplies its own map so the helper stays
 * section-agnostic.
 *
 *   occurredAt — column / expression with the event timestamp
 *   staffId    — column / expression with the acting staff id
 *   sku        — optional column / expression with the SKU code
 */
export interface FilterColumnMap {
  occurredAt: string;
  staffId?: string;
  sku?: string;
}

export interface BuiltFilter {
  /** SQL fragments suitable for `WHERE ${clauses.join(' AND ')}`. Empty array means no filtering. */
  clauses: string[];
  /** Positional parameters that match `$1`, `$2`, ... in the clauses. */
  params: unknown[];
}

/**
 * Translate parsed filters into SQL fragments scoped to a single table/alias.
 * Caller is responsible for appending the clauses to its own WHERE and
 * passing `params` (or an extended array) to `pool.query`.
 *
 * Pass `paramOffset` if the caller already has parameters earlier in the query.
 */
export function buildFilterSql(
  filters: AuditLogFilters,
  columns: FilterColumnMap,
  paramOffset = 0,
): BuiltFilter {
  const clauses: string[] = [];
  const params: unknown[] = [];

  const push = (value: unknown): string => {
    params.push(value);
    return `$${paramOffset + params.length}`;
  };

  if (filters.range.start) {
    clauses.push(`${columns.occurredAt} >= ${push(filters.range.start)}::timestamptz`);
  }
  if (filters.range.end) {
    clauses.push(`${columns.occurredAt} <= ${push(filters.range.end)}::timestamptz`);
  }
  if (filters.staffId != null && columns.staffId) {
    clauses.push(`${columns.staffId} = ${push(filters.staffId)}`);
  }
  if (filters.sku && columns.sku) {
    clauses.push(`${columns.sku} = ${push(filters.sku)}`);
  }

  return { clauses, params };
}

export const AUDIT_LOG_CONSTANTS = {
  MAX_REPORT_DAYS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} as const;
