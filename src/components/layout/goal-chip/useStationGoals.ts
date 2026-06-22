'use client';

import { useCallback, useEffect, useState } from 'react';
import { activeKey, asStation, readLS, writeLS, type StationGoal, type StationKey } from './goal-chip-shared';

/**
 * Loads the logged-in user's admin-assigned station goals (+ live deduped today
 * counts) from GET /api/staff-goals/me, and tracks the active station. The
 * active station resolves to: a still-valid current pick → the LS-remembered one
 * → the primary. `reload()` is called on mount and whenever the popover opens.
 */
export function useStationGoals(staffId: number | null) {
  const [goals, setGoals] = useState<StationGoal[] | null>(null);
  const [active, setActive] = useState<StationKey | null>(null);

  const reload = useCallback(() => {
    if (!staffId) return;
    fetch('/api/staff-goals/me', { cache: 'no-store', credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          d: {
            primary: string | null;
            stations?: Array<{ station: string; is_primary: boolean; daily_goal: number; today_count: number }>;
          } | null,
        ) => {
          const rows = d?.stations ?? [];
          if (rows.length === 0) {
            setGoals(null);
            return;
          }
          const parsed: StationGoal[] = rows
            .map((row) => {
              const st = asStation(row.station);
              if (!st) return null;
              const target = Number(row.daily_goal) > 0 ? Number(row.daily_goal) : 50;
              return { station: st, isPrimary: Boolean(row.is_primary), target, scanCount: Number(row.today_count) || 0 };
            })
            .filter((x): x is StationGoal => x !== null);
          if (parsed.length === 0) {
            setGoals(null);
            return;
          }
          setGoals(parsed);
          const primary = asStation(d?.primary) ?? parsed.find((g) => g.isPrimary)?.station ?? parsed[0].station;
          setActive((cur) => {
            const valid = (s: StationKey | null) => !!s && parsed.some((g) => g.station === s);
            if (valid(cur)) return cur;
            const stored = asStation(readLS<string>(activeKey(staffId), ''));
            return valid(stored) ? stored : primary;
          });
        },
      )
      .catch(() => setGoals(null));
  }, [staffId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const selectStation = useCallback(
    (st: StationKey) => {
      if (!staffId) return;
      setActive(st);
      writeLS(activeKey(staffId), st);
    },
    [staffId],
  );

  return { goals, active, selectStation, reload };
}
