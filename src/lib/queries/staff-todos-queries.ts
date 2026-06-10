'use client';

/**
 * Query factory + typed fetch helpers for /api/staff-todos — the header goal
 * chip's "Recurring" and "To-do" checklists (server-backed v2 of the old
 * localStorage lists).
 *
 * Same factory rule as dashboard-queries: every consumer builds from
 * `staffTodosQuery(station)` so cache keys can't drift.
 *
 * Recurring "done" is NOT a server flag — it's derived here from the task's
 * cycle (anchor + interval) and its latest completion, so the chip can
 * recompute rollover locally on its 30s tick without refetching.
 */

import { queryOptions } from '@tanstack/react-query';

export type StaffTodoKind = 'general' | 'recurring';

export interface StaffTodoItem {
  id: number;
  kind: StaffTodoKind;
  text: string;
  sort_order: number;
  recur_interval_ms: number | null;
  recur_anchor_ms: number | null;
  completed_at_ms: number | null;
  last_completed_at_ms: number | null;
}

/** Start of the current recurrence cycle (epoch ms). */
export function cyclePeriodStartMs(anchorMs: number, intervalMs: number, nowMs: number): number {
  if (intervalMs <= 0 || nowMs <= anchorMs) return anchorMs;
  return anchorMs + Math.floor((nowMs - anchorMs) / intervalMs) * intervalMs;
}

/** Checked state at `nowMs` — general from its stamp, recurring from its cycle. */
export function isTodoDone(item: StaffTodoItem, nowMs: number): boolean {
  if (item.kind === 'general') return item.completed_at_ms != null;
  if (item.recur_anchor_ms == null || item.recur_interval_ms == null) return false;
  if (item.last_completed_at_ms == null) return false;
  return (
    item.last_completed_at_ms >=
    cyclePeriodStartMs(item.recur_anchor_ms, item.recur_interval_ms, nowMs)
  );
}

async function fetchStaffTodos(station: string): Promise<StaffTodoItem[]> {
  const res = await fetch(`/api/staff-todos?station=${encodeURIComponent(station)}`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to fetch staff todos');
  const data = await res.json();
  return Array.isArray(data?.items) ? data.items : [];
}

/**
 * One staffer's list for one station. Keyed per staffId so a staff switch on
 * a shared terminal can't serve the previous user's cached list.
 */
export function staffTodosQuery(staffId: number, station: string) {
  return queryOptions({
    queryKey: ['staff-todos', staffId, station],
    queryFn: () => fetchStaffTodos(station),
    // Todos only change via this user's own mutations, which write the cache
    // directly — so no focus/mount refetch churn from the always-mounted chip.
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

/* ── mutation fetchers (consumed by the chip's optimistic mutations) ────────── */

export async function createStaffTodoApi(args: {
  station: string;
  kind: StaffTodoKind;
  text: string;
  intervalMs?: number;
}): Promise<StaffTodoItem> {
  const res = await fetch('/api/staff-todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error('Failed to add task');
  const data = await res.json();
  return data.item as StaffTodoItem;
}

export async function toggleStaffTodoApi(id: number, done: boolean): Promise<StaffTodoItem> {
  const res = await fetch('/api/staff-todos', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ action: 'toggle', id, done }),
  });
  if (!res.ok) throw new Error('Failed to update task');
  const data = await res.json();
  return data.item as StaffTodoItem;
}

export async function setStaffTodoIntervalApi(
  station: string,
  intervalMs: number,
): Promise<StaffTodoItem[]> {
  const res = await fetch('/api/staff-todos', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ action: 'set_interval', station, intervalMs }),
  });
  if (!res.ok) throw new Error('Failed to change interval');
  const data = await res.json();
  return Array.isArray(data?.items) ? data.items : [];
}

export async function deleteStaffTodoApi(id: number): Promise<void> {
  const res = await fetch(`/api/staff-todos?id=${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to delete task');
}
