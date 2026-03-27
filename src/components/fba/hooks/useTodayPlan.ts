import { useCallback, useState } from 'react';

interface TodayPlanRecord {
  date: string;
  fnskus: string[];
}

const TODAY_PLAN_KEY = 'fba:today_plan';

function getTodayIso(): string {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

function readTodayPlan(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(TODAY_PLAN_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TodayPlanRecord | null;
    if (!parsed?.date || !Array.isArray(parsed.fnskus)) return [];
    if (parsed.date !== getTodayIso()) {
      localStorage.removeItem(TODAY_PLAN_KEY);
      return [];
    }
    return parsed.fnskus.filter(Boolean);
  } catch {
    return [];
  }
}

function writeTodayPlan(fnskus: string[]) {
  if (typeof window === 'undefined') return;
  const payload: TodayPlanRecord = { date: getTodayIso(), fnskus: Array.from(new Set(fnskus)) };
  localStorage.setItem(TODAY_PLAN_KEY, JSON.stringify(payload));
}

export function useTodayPlan() {
  const [todayFnskus, setTodayFnskus] = useState<string[]>(() => readTodayPlan());

  const addFnskus = useCallback((next: string[]) => {
    if (!next.length) return;
    setTodayFnskus((prev) => {
      const merged = Array.from(new Set([...prev, ...next.filter(Boolean)]));
      writeTodayPlan(merged);
      return merged;
    });
  }, []);

  const replaceToday = useCallback((list: string[]) => {
    setTodayFnskus(() => {
      const clean = Array.from(new Set(list.filter(Boolean)));
      writeTodayPlan(clean);
      return clean;
    });
  }, []);

  const resetIfStale = useCallback(() => {
    const fresh = readTodayPlan();
    setTodayFnskus(fresh);
  }, []);

  return { todayFnskus, addFnskus, replaceToday, resetIfStale };
}
