'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  staffTodosQuery,
  isTodoDone,
  createStaffTodoApi,
  toggleStaffTodoApi,
  setStaffTodoIntervalApi,
  deleteStaffTodoApi,
  type StaffTodoItem,
  type StaffTodoKind,
} from '@/lib/queries/staff-todos-queries';
import {
  DEFAULT_INTERVAL_MS,
  readLS,
  recurKey,
  removeLS,
  todoKey,
  type LegacyRecurringState,
  type StationKey,
  type Todo,
} from './goal-chip-shared';

/**
 * Server-backed recurring + general checklists for the active station
 * (staff_todos via TanStack Query). CRUD is optimistic (cache writes, server
 * reconciles). Recurring done-ness is pure client math over (anchor, interval,
 * latest completion), recomputed on a 30s tick so cycles roll over with no
 * refetch. Also performs the one-time import of legacy v1 localStorage lists.
 */
export function useGoalChecklists(staffId: number | null, active: StationKey | null) {
  const queryClient = useQueryClient();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [draftIntervalMs, setDraftIntervalMs] = useState(DEFAULT_INTERVAL_MS);

  const todosQuery = useQuery({
    ...staffTodosQuery(staffId ?? 0, active ?? ''),
    enabled: !!staffId && !!active,
  });
  const serverItems = useMemo(() => todosQuery.data ?? [], [todosQuery.data]);

  const todoItems = useMemo<Todo[]>(
    () =>
      serverItems
        .filter((it) => it.kind === 'general')
        .map((it) => ({ id: String(it.id), text: it.text, done: it.completed_at_ms != null })),
    [serverItems],
  );
  const recurItems = useMemo<Todo[]>(
    () =>
      serverItems
        .filter((it) => it.kind === 'recurring')
        .map((it) => ({ id: String(it.id), text: it.text, done: isTodoDone(it, nowMs) })),
    [serverItems, nowMs],
  );
  const intervalMs =
    serverItems.find((it) => it.kind === 'recurring')?.recur_interval_ms ?? draftIntervalMs;

  // Reset the interval draft when the active station changes.
  useEffect(() => {
    setDraftIntervalMs(DEFAULT_INTERVAL_MS);
  }, [staffId, active]);

  // Tick so recurring done-ness rolls over even while the popover is closed.
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // One-time import of the legacy localStorage v1 lists.
  const importedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!staffId || !active || !todosQuery.isSuccess) return;
    if ((todosQuery.data?.length ?? 0) > 0) return;
    const guard = `${staffId}.${active}`;
    if (importedRef.current.has(guard)) return;
    const legacyTodos = readLS<Todo[]>(todoKey(staffId, active), []);
    const legacyRecur = readLS<LegacyRecurringState>(recurKey(staffId, active), {
      intervalMs: DEFAULT_INTERVAL_MS,
      anchor: 0,
      items: [],
    });
    if (legacyTodos.length === 0 && legacyRecur.items.length === 0) return;
    importedRef.current.add(guard);
    const station = active;
    (async () => {
      try {
        for (const t of legacyTodos) {
          const item = await createStaffTodoApi({ station, kind: 'general', text: t.text });
          if (t.done) await toggleStaffTodoApi(item.id, true);
        }
        for (const t of legacyRecur.items) {
          const item = await createStaffTodoApi({
            station,
            kind: 'recurring',
            text: t.text,
            intervalMs: legacyRecur.intervalMs > 0 ? legacyRecur.intervalMs : undefined,
          });
          if (t.done) await toggleStaffTodoApi(item.id, true);
        }
        removeLS(todoKey(staffId, station));
        removeLS(recurKey(staffId, station));
      } catch {
        /* partial import — server wins next load; keys stay for retry */
      }
      void queryClient.invalidateQueries({ queryKey: ['staff-todos', staffId, station] });
    })();
  }, [staffId, active, todosQuery.isSuccess, todosQuery.data, queryClient]);

  /* ── CRUD (optimistic cache writes, server reconciles) ─────────────────── */
  const listKey = useCallback(() => staffTodosQuery(staffId ?? 0, active ?? '').queryKey, [staffId, active]);
  const refreshList = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: listKey() });
  }, [queryClient, listKey]);

  const toggleItem = useCallback(
    (list: Todo[], id: string) => {
      if (!staffId || !active) return;
      const cur = list.find((t) => t.id === id);
      const serverId = Number(id);
      if (!cur || serverId <= 0) return; // temp optimistic row — not on the server yet
      const done = !cur.done;
      const ts = Date.now();
      queryClient.setQueryData<StaffTodoItem[]>(listKey(), (items) =>
        (items ?? []).map((it) =>
          it.id === serverId
            ? it.kind === 'general'
              ? { ...it, completed_at_ms: done ? ts : null }
              : { ...it, last_completed_at_ms: done ? ts : null }
            : it,
        ),
      );
      toggleStaffTodoApi(serverId, done)
        .then((item) =>
          queryClient.setQueryData<StaffTodoItem[]>(listKey(), (items) =>
            (items ?? []).map((it) => (it.id === item.id ? item : it)),
          ),
        )
        .catch(refreshList);
    },
    [staffId, active, queryClient, listKey, refreshList],
  );

  const removeItem = useCallback(
    (id: string) => {
      if (!staffId || !active) return;
      const serverId = Number(id);
      queryClient.setQueryData<StaffTodoItem[]>(listKey(), (items) =>
        (items ?? []).filter((it) => String(it.id) !== id),
      );
      if (serverId > 0) deleteStaffTodoApi(serverId).catch(refreshList);
    },
    [staffId, active, queryClient, listKey, refreshList],
  );

  const addItem = useCallback(
    (kind: StaffTodoKind, rawText: string) => {
      const text = rawText.trim();
      if (!text || !staffId || !active) return;
      const ts = Date.now();
      const temp: StaffTodoItem = {
        id: -ts, // negative = not yet on the server (toggle/delete skip the API)
        kind,
        text,
        sort_order: Number.MAX_SAFE_INTEGER,
        recur_interval_ms: kind === 'recurring' ? intervalMs : null,
        recur_anchor_ms: kind === 'recurring' ? ts : null,
        completed_at_ms: null,
        last_completed_at_ms: null,
      };
      queryClient.setQueryData<StaffTodoItem[]>(listKey(), (items) => [...(items ?? []), temp]);
      createStaffTodoApi({ station: active, kind, text, intervalMs: kind === 'recurring' ? intervalMs : undefined })
        .then((item) =>
          queryClient.setQueryData<StaffTodoItem[]>(listKey(), (items) =>
            (items ?? []).map((it) => (it.id === temp.id ? item : it)),
          ),
        )
        .catch(refreshList);
    },
    [staffId, active, intervalMs, queryClient, listKey, refreshList],
  );

  const changeInterval = useCallback(
    (ms: number) => {
      setDraftIntervalMs(ms);
      if (!staffId || !active || recurItems.length === 0) return;
      const station = active;
      const ts = Date.now();
      queryClient.setQueryData<StaffTodoItem[]>(listKey(), (items) =>
        (items ?? []).map((it) =>
          it.kind === 'recurring'
            ? { ...it, recur_interval_ms: ms, recur_anchor_ms: ts, last_completed_at_ms: isTodoDone(it, ts) ? ts : null }
            : it,
        ),
      );
      setStaffTodoIntervalApi(station, ms)
        .then((items) => queryClient.setQueryData<StaffTodoItem[]>(listKey(), items))
        .catch(refreshList);
    },
    [staffId, active, recurItems.length, queryClient, listKey, refreshList],
  );

  // Recurring items are "due" whenever any is unchecked — after a cycle turns
  // over their completions fall out of the current period, lighting this up.
  const recurDue = recurItems.length > 0 && recurItems.some((t) => !t.done);

  return {
    todoItems,
    recurItems,
    intervalMs,
    recurDue,
    toggleTodo: (id: string) => toggleItem(todoItems, id),
    removeTodo: removeItem,
    addTodo: (text: string) => addItem('general', text),
    toggleRecur: (id: string) => toggleItem(recurItems, id),
    removeRecur: removeItem,
    addRecur: (text: string) => addItem('recurring', text),
    changeInterval,
  };
}
