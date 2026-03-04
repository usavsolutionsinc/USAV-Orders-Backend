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

const _perStaffCache = new Map<string, PerStaffEntry>();
const _perStaffPromises = new Map<string, Promise<number>>();

/** Returns the daily_goal for a single staff member (defaults to 50 on error). */
export function getStaffGoalById(staffId: string): Promise<number> {
  const cached = _perStaffCache.get(staffId);
  if (cached && Date.now() < cached.expiresAt) return Promise.resolve(cached.value);

  let promise = _perStaffPromises.get(staffId);
  if (!promise) {
    promise = fetch(`/api/staff-goals?staffId=${encodeURIComponent(staffId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { daily_goal?: number } | null) => {
        const goal = Number(data?.daily_goal);
        const value = Number.isFinite(goal) && goal > 0 ? goal : 50;
        _perStaffCache.set(staffId, { value, expiresAt: Date.now() + PER_STAFF_TTL_MS });
        _perStaffPromises.delete(staffId);
        return value;
      })
      .catch(() => {
        _perStaffPromises.delete(staffId);
        return 50;
      });
    _perStaffPromises.set(staffId, promise);
  }
  return promise;
}

// ── Full goals list (with live today/week counts) ─────────────────────────────

export interface GoalRow {
  staff_id: number;
  name: string;
  role: string;
  daily_goal: number;
  today_count: number;
  week_count: number;
  avg_daily_last_7d: number;
}

interface AllGoalsEntry {
  data: GoalRow[];
  expiresAt: number;
}

let _allGoalsCache: AllGoalsEntry | null = null;
let _allGoalsPromise: Promise<GoalRow[]> | null = null;

/** Returns the full goals list (includes live today/week counts). */
export function getAllStaffGoals(): Promise<GoalRow[]> {
  if (_allGoalsCache && Date.now() < _allGoalsCache.expiresAt) {
    return Promise.resolve(_allGoalsCache.data);
  }

  if (!_allGoalsPromise) {
    _allGoalsPromise = fetch('/api/staff-goals')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: GoalRow[]) => {
        const result = Array.isArray(data) ? data : [];
        _allGoalsCache = { data: result, expiresAt: Date.now() + ALL_GOALS_TTL_MS };
        _allGoalsPromise = null;
        return result;
      })
      .catch(() => {
        _allGoalsPromise = null;
        return [];
      });
  }
  return _allGoalsPromise;
}

// ── Invalidation ──────────────────────────────────────────────────────────────

/**
 * Call after a PUT to /api/staff-goals.
 * Pass staffId to invalidate only that entry, or omit to clear everything.
 */
export function invalidateStaffGoalsCache(staffId?: string): void {
  _allGoalsCache = null;
  _allGoalsPromise = null;

  if (staffId) {
    _perStaffCache.delete(staffId);
    _perStaffPromises.delete(staffId);
  } else {
    _perStaffCache.clear();
    _perStaffPromises.clear();
  }
}
