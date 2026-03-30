/**
 * Module-level cache for staff daily goals.
 *
 * Per-staff goals (used by station sidebars) are cached for 5 minutes — they
 * are admin-configured and almost never change during a shift.
 *
 * The full goals list (used by GoalsAnalyticsTab) includes live today/week
 * counts, so it uses a shorter 30-second TTL.
 *
 * Call invalidateStaffGoalsCache() after any PUT to /api/staff-goals so the
 * next read gets fresh data.
 */

const PER_STAFF_TTL_MS = 5 * 60 * 1000; // 5 minutes
const ALL_GOALS_TTL_MS = 30 * 1000;      // 30 seconds (live counts)

// ── Per-staff goal ────────────────────────────────────────────────────────────

interface PerStaffEntry {
  value: number;   // daily_goal
  expiresAt: number;
}

/** Cache key = "staffId:station" */
const _perStaffCache = new Map<string, PerStaffEntry>();
const _perStaffPromises = new Map<string, Promise<number>>();

function perStaffKey(staffId: string, station: string = 'TECH'): string {
  return `${staffId}:${station}`;
}

/** Returns the daily_goal for a single staff member + station (defaults to 50 on error). */
export function getStaffGoalById(staffId: string, station: string = 'TECH'): Promise<number> {
  const key = perStaffKey(staffId, station);
  const cached = _perStaffCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return Promise.resolve(cached.value);

  let promise = _perStaffPromises.get(key);
  if (!promise) {
    promise = fetch(`/api/staff-goals?staffId=${encodeURIComponent(staffId)}&station=${encodeURIComponent(station)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { daily_goal?: number } | null) => {
        const goal = Number(data?.daily_goal);
        const value = Number.isFinite(goal) && goal > 0 ? goal : 50;
        _perStaffCache.set(key, { value, expiresAt: Date.now() + PER_STAFF_TTL_MS });
        _perStaffPromises.delete(key);
        return value;
      })
      .catch(() => {
        _perStaffPromises.delete(key);
        return 50;
      });
    _perStaffPromises.set(key, promise);
  }
  return promise;
}

// ── Full goals list (with live today/week counts) ─────────────────────────────

export interface GoalRow {
  staff_id: number;
  name: string;
  role: string;
  employee_id: string | null;
  station: string;
  daily_goal: number;
  today_count: number;
  week_count: number;
  avg_daily_last_7d: number;
}

interface AllGoalsEntry {
  data: GoalRow[];
  expiresAt: number;
}

/** Cache key = station filter or 'ALL' */
const _allGoalsCache = new Map<string, AllGoalsEntry>();
const _allGoalsPromises = new Map<string, Promise<GoalRow[]>>();

/** Returns the full goals list (includes live today/week counts). Optionally filter by station. */
export function getAllStaffGoals(station?: string): Promise<GoalRow[]> {
  const cacheKey = station || 'ALL';
  const cached = _allGoalsCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return Promise.resolve(cached.data);
  }

  let promise = _allGoalsPromises.get(cacheKey);
  if (!promise) {
    const url = station
      ? `/api/staff-goals?station=${encodeURIComponent(station)}`
      : '/api/staff-goals';
    promise = fetch(url)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: GoalRow[]) => {
        const result = Array.isArray(data) ? data : [];
        _allGoalsCache.set(cacheKey, { data: result, expiresAt: Date.now() + ALL_GOALS_TTL_MS });
        _allGoalsPromises.delete(cacheKey);
        return result;
      })
      .catch(() => {
        _allGoalsPromises.delete(cacheKey);
        return [];
      });
    _allGoalsPromises.set(cacheKey, promise);
  }
  return promise;
}

// ── Invalidation ──────────────────────────────────────────────────────────────

/**
 * Call after a PUT to /api/staff-goals.
 * Pass staffId to invalidate only that entry, or omit to clear everything.
 */
export function invalidateStaffGoalsCache(staffId?: string): void {
  // Always clear the full list caches
  _allGoalsCache.clear();
  _allGoalsPromises.clear();

  if (staffId) {
    // Clear all station variants for this staff
    for (const key of _perStaffCache.keys()) {
      if (key.startsWith(`${staffId}:`)) {
        _perStaffCache.delete(key);
        _perStaffPromises.delete(key);
      }
    }
  } else {
    _perStaffCache.clear();
    _perStaffPromises.clear();
  }
}
