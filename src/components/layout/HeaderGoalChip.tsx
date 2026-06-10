'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnchoredLayer } from '@/design-system';
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
import { Bell, Check, ChevronDown, Clock, Plus, RotateCcw, Barcode, Trash2, X } from '@/components/Icons';
import { cn } from '@/utils/_cn';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Header goal chip — the daily goal pinned to the {@link GlobalHeader}, top-left
 * right of the sidebar toggle, so it follows the user across every page (it used
 * to live only inside the per-station sidebar via StationGoalBar).
 *
 * Which stations a staffer sees is admin-controlled (staff_stations): one locked
 * PRIMARY station, plus optional SECONDARY stations. The data comes from
 * GET /api/staff-goals/me (primary first, with live deduped today counts). The
 * "Switch" control only appears when the staffer has at least one secondary —
 * otherwise the chip stays locked to the primary station.
 *
 * A ring fills with progress; click to open a popover with three modes:
 *   · scans     — live, scan-based progress (today_count vs daily_goal), exactly
 *                 how goals are counted today.
 *   · recurring — interval to-dos: the whole list auto-resets on a selected
 *                 interval (1h / 2h / 4h / 8h / daily). When the interval rolls
 *                 over the items un-check themselves and the header chip shows a
 *                 red reminder dot until they're re-checked.
 *   · to-do     — a general, persistent checklist the user ticks off (does not
 *                 reset on its own).
 *
 * The checklists are server-backed (staff_todos via /api/staff-todos, per
 * staff + station) so they follow the user across devices. Recurring "done"
 * is derived client-side from each task's cycle (anchor + interval) and its
 * latest completion, recomputed on a 30s tick — rollover needs no refetch.
 * Only the chosen mode and active station remain in localStorage (UI prefs),
 * and any legacy v1 localStorage lists are imported once, then cleared.
 */

type StationKey = 'TECH' | 'PACK' | 'UNBOX' | 'SALES' | 'FBA';
type GoalMode = 'scans' | 'recurring' | 'todo';
/** UI row shape consumed by {@link TaskList} (server rows map onto this). */
type Todo = { id: string; text: string; done: boolean };
/** Legacy v1 localStorage shape — read only by the one-time import. */
type LegacyRecurringState = { intervalMs: number; anchor: number; items: Todo[] };

type StationGoal = {
  station: StationKey;
  isPrimary: boolean;
  target: number;
  scanCount: number;
};

const STATIONS: StationKey[] = ['TECH', 'PACK', 'UNBOX', 'SALES', 'FBA'];
const STATION_LABEL: Record<StationKey, string> = {
  TECH: 'Tech',
  PACK: 'Packing',
  UNBOX: 'Unboxing',
  SALES: 'Sales',
  FBA: 'FBA',
};

const HOUR_MS = 60 * 60_000;
const RECUR_INTERVALS = [
  { label: '1h', ms: HOUR_MS },
  { label: '2h', ms: 2 * HOUR_MS },
  { label: '4h', ms: 4 * HOUR_MS },
  { label: '8h', ms: 8 * HOUR_MS },
  { label: 'Daily', ms: 24 * HOUR_MS },
] as const;
const DEFAULT_INTERVAL_MS = 4 * HOUR_MS;

const TONES = [
  { min: 100, ring: '#059669', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-500/20', label: 'Hit goal' },
  { min: 85, ring: '#059669', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-500/20', label: 'On track' },
  { min: 60, ring: '#D97706', chip: 'bg-amber-50 text-amber-700 ring-amber-500/20', label: 'Close' },
  { min: 0, ring: '#E11D48', chip: 'bg-rose-50 text-rose-700 ring-rose-500/20', label: 'Behind' },
] as const;

function toneFor(percent: number) {
  return TONES.find((t) => percent >= t.min) ?? TONES[TONES.length - 1];
}

function asStation(v: string | null | undefined): StationKey | null {
  const up = String(v ?? '').toUpperCase();
  return (STATIONS as string[]).includes(up) ? (up as StationKey) : null;
}

/* ── localStorage helpers (browser-only; v1 persistence) ───────────────────── */

function readLS<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeLS<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode — non-fatal */
  }
}
const activeKey = (staffId: number) => `usav.hgoal.active.${staffId}`;
const modeKey = (staffId: number, st: StationKey) => `usav.hgoal.mode.${staffId}.${st}`;
// Legacy v1 list keys — only read (then removed) by the one-time server import.
const todoKey = (staffId: number, st: StationKey) => `usav.hgoal.todo.${staffId}.${st}`;
const recurKey = (staffId: number, st: StationKey) => `usav.hgoal.recurring.${staffId}.${st}`;

function removeLS(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* non-fatal */
  }
}

/** Accept whatever the mode key holds (incl. the legacy 'checklist' value). */
function asMode(v: string | null | undefined): GoalMode {
  if (v === 'recurring' || v === 'todo' || v === 'scans') return v;
  if (v === 'checklist') return 'todo'; // legacy v1 single-checklist → general to-do
  return 'scans';
}

/* ── progress ring ─────────────────────────────────────────────────────────── */

function GoalRing({ percent, color, size = 26 }: { percent: number; color: string; size?: number }) {
  const r = size / 2 - 2.5;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg className="h-full w-full -rotate-90" viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#E5E7EB" strokeWidth="2.5" fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth="2.5"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          animate={{ strokeDashoffset: c * (1 - clamped / 100) }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className="font-extrabold tabular-nums tracking-tight text-gray-900"
          style={{ fontSize: Math.max(7, size * 0.3) }}
        >
          {clamped}
        </span>
      </div>
    </div>
  );
}

/* ── shared checklist list (used by both recurring + to-do) ──────────────────── */

function TaskList({
  items,
  onToggle,
  onRemove,
  adding,
  draft,
  onDraft,
  onAdd,
  onStartAdd,
  onCancelAdd,
  emptyHint,
  placeholder,
  addLabel,
}: {
  items: Todo[];
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  adding: boolean;
  draft: string;
  onDraft: (v: string) => void;
  onAdd: () => void;
  onStartAdd: () => void;
  onCancelAdd: () => void;
  emptyHint: string;
  placeholder: string;
  addLabel: string;
}) {
  return (
    <>
      {items.length === 0 && !adding && (
        <p className="px-2 py-3 text-center text-[11px] text-gray-400">{emptyHint}</p>
      )}
      {items.map((t) => (
        <div
          key={t.id}
          className="group flex items-center gap-2.5 rounded-xl px-2 py-2 transition-colors hover:bg-gray-50"
        >
          <button
            type="button"
            onClick={() => onToggle(t.id)}
            className={cn(
              'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md ring-1 transition-colors',
              t.done ? 'bg-emerald-500 ring-emerald-500' : 'bg-white ring-gray-300',
            )}
            aria-pressed={t.done}
          >
            <AnimatePresence>
              {t.done && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  transition={{ type: 'spring', stiffness: 520, damping: 30 }}
                >
                  <Check className="h-3 w-3 text-white" />
                </motion.span>
              )}
            </AnimatePresence>
          </button>
          <button
            type="button"
            onClick={() => onToggle(t.id)}
            className={cn(
              'flex-1 text-left text-[12px] font-semibold transition-colors',
              t.done ? 'text-gray-400 line-through' : 'text-gray-800',
            )}
          >
            {t.text}
          </button>
          <button
            type="button"
            onClick={() => onRemove(t.id)}
            aria-label="Delete task"
            className="opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5 text-gray-400" />
          </button>
        </div>
      ))}

      {adding ? (
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <input
            autoFocus
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onAdd();
              if (e.key === 'Escape') onCancelAdd();
            }}
            placeholder={placeholder}
            className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20"
          />
          <button
            type="button"
            onClick={onAdd}
            className="shrink-0 rounded-lg bg-blue-600 px-2 py-1.5 text-[11px] font-bold text-white hover:bg-blue-500"
          >
            Add
          </button>
          <button
            type="button"
            onClick={onCancelAdd}
            aria-label="Cancel"
            className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onStartAdd}
          className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-[11px] font-bold text-blue-600 hover:bg-gray-50"
        >
          <Plus className="h-3.5 w-3.5" /> {addLabel}
        </button>
      )}
    </>
  );
}

/* ── component ─────────────────────────────────────────────────────────────── */

export function HeaderGoalChip() {
  const { user } = useAuth();
  const staffId = user?.staffId ?? null;
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  // Admin-assigned stations for this staffer, primary first, with live counts.
  const [goals, setGoals] = useState<StationGoal[] | null>(null);

  const [active, setActive] = useState<StationKey | null>(null);
  const [mode, setMode] = useState<GoalMode>('scans');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  // Recurring done-ness is pure client math over (anchor, interval, latest
  // completion); this tick re-evaluates it every 30s so the cycle visibly
  // rolls over (and the red "due" dot lights up) without any refetch.
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Interval selection shown while the recurring list is EMPTY — once rows
  // exist, the list itself carries the interval and this is just a mirror.
  const [draftIntervalMs, setDraftIntervalMs] = useState(DEFAULT_INTERVAL_MS);

  const wrapRef = useRef<HTMLDivElement>(null);

  /* server-backed checklists for the active station */
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

  /* fetch the logged-in user's own station goals (+ live scan counts) */
  const load = useCallback(() => {
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
    load();
  }, [load]);

  /* when the active station changes, hydrate its mode (a UI pref) from LS */
  useEffect(() => {
    if (!staffId || !active) return;
    setMode(asMode(readLS<string>(modeKey(staffId, active), 'scans')));
    setDraftIntervalMs(DEFAULT_INTERVAL_MS);
    setAdding(false);
    setDraft('');
  }, [staffId, active]);

  /* tick so recurring done-ness rolls over even while the popover is closed,
     surfacing the red "due" reminder the moment an interval cycle turns */
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  /* one-time import of the legacy localStorage v1 lists: when the server list
     is empty but LS still holds items, push them up, then clear the LS keys */
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

  /* refresh live counts each time the popover opens */
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  /* click-outside + Escape close are owned by AnchoredLayer (see render). */
  const closePopover = useCallback(() => {
    setOpen(false);
    setSwitching(false);
  }, []);

  const selectStation = useCallback(
    (st: StationKey) => {
      if (!staffId) return;
      setActive(st);
      writeLS(activeKey(staffId), st);
      setSwitching(false);
    },
    [staffId],
  );

  const changeMode = useCallback(
    (m: GoalMode) => {
      if (!staffId || !active) return;
      setMode(m);
      writeLS(modeKey(staffId, active), m);
      setAdding(false);
      setDraft('');
    },
    [staffId, active],
  );

  /* ── checklist CRUD (optimistic cache writes, server reconciles) ─────────── */
  const listKey = useCallback(
    () => staffTodosQuery(staffId ?? 0, active ?? '').queryKey,
    [staffId, active],
  );
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
    (kind: StaffTodoKind) => {
      const text = draft.trim();
      if (!text || !staffId || !active) return;
      setDraft('');
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
      createStaffTodoApi({
        station: active,
        kind,
        text,
        intervalMs: kind === 'recurring' ? intervalMs : undefined,
      })
        .then((item) =>
          queryClient.setQueryData<StaffTodoItem[]>(listKey(), (items) =>
            (items ?? []).map((it) => (it.id === temp.id ? item : it)),
          ),
        )
        .catch(refreshList);
    },
    [draft, staffId, active, intervalMs, queryClient, listKey, refreshList],
  );

  const toggleTodo = (id: string) => toggleItem(todoItems, id);
  const removeTodo = removeItem;
  const addTodo = () => addItem('general');
  const toggleRecur = (id: string) => toggleItem(recurItems, id);
  const removeRecur = removeItem;
  const addRecur = () => addItem('recurring');

  // Changing the interval restarts the cycle from now so it doesn't fire
  // instantly; the server re-logs completions for checked tasks so nothing
  // un-checks. With an empty list it's just a local draft for the next add.
  const changeInterval = (ms: number) => {
    setDraftIntervalMs(ms);
    if (!staffId || !active || recurItems.length === 0) return;
    const station = active;
    const ts = Date.now();
    queryClient.setQueryData<StaffTodoItem[]>(listKey(), (items) =>
      (items ?? []).map((it) =>
        it.kind === 'recurring'
          ? {
              ...it,
              recur_interval_ms: ms,
              recur_anchor_ms: ts,
              last_completed_at_ms: isTodoDone(it, ts) ? ts : null,
            }
          : it,
      ),
    );
    setStaffTodoIntervalApi(station, ms)
      .then((items) => queryClient.setQueryData<StaffTodoItem[]>(listKey(), items))
      .catch(refreshList);
  };

  const activeGoal = useMemo(
    () => goals?.find((g) => g.station === active) ?? null,
    [goals, active],
  );

  // Recurring items are "due" whenever any is unchecked — after a cycle turns
  // over their completions fall out of the current period, lighting this up.
  const recurDue = recurItems.length > 0 && recurItems.some((t) => !t.done);

  const view = useMemo(() => {
    if (!activeGoal) return null;
    const { target, scanCount } = activeGoal;
    if (mode === 'todo' || mode === 'recurring') {
      const list = mode === 'todo' ? todoItems : recurItems;
      const done = list.filter((t) => t.done).length;
      const total = list.length;
      const percent = total === 0 ? 0 : Math.round((done / total) * 100);
      return { target, scanCount, done, total, percent };
    }
    return {
      target,
      scanCount,
      done: 0,
      total: 0,
      percent: target <= 0 ? 0 : Math.round((scanCount / target) * 100),
    };
  }, [activeGoal, todoItems, recurItems, mode]);

  if (!user || !goals || !active || !activeGoal || !view) return null;

  const hasSwitch = goals.length > 1;
  const tone = toneFor(view.percent);
  const chipCount =
    mode === 'scans'
      ? { value: view.scanCount, total: view.target, unit: 'scans' }
      : { value: view.done, total: view.total, unit: 'tasks' };

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <motion.button
        type="button"
        onClick={() => setOpen((o) => !o)}
        whileTap={{ scale: 0.97 }}
        aria-label="Daily goal"
        aria-expanded={open}
        title={`${STATION_LABEL[active]} goal — ${view.percent}%${recurDue ? ' · recurring tasks due' : ''}`}
        className={cn(
          'flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 transition-colors',
          open ? 'bg-gray-100' : 'hover:bg-gray-100',
        )}
      >
        <GoalRing percent={view.percent} color={tone.ring} />
        <span className="flex flex-col items-start leading-none">
          <span className="text-[11px] font-bold tracking-tight text-gray-900">{STATION_LABEL[active]}</span>
          <span className="mt-0.5 text-[9px] font-semibold tabular-nums text-gray-500">
            {chipCount.value}/{chipCount.total} {chipCount.unit}
          </span>
        </span>
        <ChevronDown className={cn('h-3 w-3 text-gray-400 transition-transform duration-200', open && 'rotate-180')} />
      </motion.button>

      {/* in-app reminder: recurring tasks have come due for this station */}
      {recurDue && (
        <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white" />
        </span>
      )}

      <AnchoredLayer
        open={open}
        onClose={closePopover}
        anchorRef={wrapRef}
        placement="bottom-start"
        gap={8}
      >
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="w-[290px] origin-top-left overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_12px_40px_rgba(20,30,55,0.16)]"
          >
            {/* header: title + Switch (only when there are secondary stations) */}
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3.5 py-3">
              <div className="flex items-center gap-2.5">
                <GoalRing percent={view.percent} color={tone.ring} size={38} />
                <div className="leading-tight">
                  <p className="text-[13px] font-bold tracking-tight text-gray-900">
                    Today&apos;s {STATION_LABEL[active]} goal
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold tabular-nums text-gray-500">
                      {chipCount.value} / {chipCount.total}
                    </span>
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-px text-[8.5px] font-black uppercase tracking-wider ring-1',
                        tone.chip,
                      )}
                    >
                      {tone.label}
                    </span>
                  </p>
                </div>
              </div>
              {hasSwitch && (
                <button
                  type="button"
                  onClick={() => setSwitching((s) => !s)}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-bold transition-colors',
                    switching ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900',
                  )}
                >
                  <RotateCcw className="h-3 w-3" /> Switch
                </button>
              )}
            </div>

            <AnimatePresence mode="wait" initial={false}>
              {switching && hasSwitch ? (
                <motion.div
                  key="switch"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 16 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                  className="p-2"
                >
                  <p className="px-2 pb-1.5 pt-1 text-[9px] font-bold uppercase tracking-wider text-gray-400">
                    Your stations
                  </p>
                  {goals.map((g) => {
                    const pct = g.target <= 0 ? 0 : Math.round((g.scanCount / g.target) * 100);
                    const gt = toneFor(pct);
                    const on = g.station === active;
                    return (
                      <button
                        key={g.station}
                        type="button"
                        onClick={() => selectStation(g.station)}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors',
                          on ? 'bg-blue-50/70' : 'hover:bg-gray-50',
                        )}
                      >
                        <GoalRing percent={pct} color={gt.ring} size={30} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-bold text-gray-900">
                            {STATION_LABEL[g.station]}
                            {g.isPrimary && (
                              <span className="ml-1.5 text-[8.5px] font-black uppercase tracking-wider text-blue-500">
                                primary
                              </span>
                            )}
                          </span>
                          <span className="text-[9.5px] font-semibold tabular-nums text-gray-500">
                            {g.scanCount}/{g.target} scans
                          </span>
                        </span>
                        {on && <Check className="h-3.5 w-3.5 text-blue-600" />}
                      </button>
                    );
                  })}
                </motion.div>
              ) : (
                <motion.div
                  key="body"
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                >
                  {/* mode toggle: Scans · Auto / Recurring / To-do */}
                  <div className="px-3 pt-3">
                    <div className="flex w-full items-center gap-0.5 rounded-xl bg-gray-100 p-0.5 ring-1 ring-gray-200">
                      {(['scans', 'recurring', 'todo'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => changeMode(m)}
                          className={cn(
                            'relative flex-1 rounded-lg px-1.5 py-1.5 text-[10px] font-bold transition-colors',
                            mode === m
                              ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200'
                              : 'text-gray-500 hover:text-gray-900',
                          )}
                        >
                          {m === 'scans' ? 'Scans · auto' : m === 'recurring' ? 'Recurring' : 'To-do'}
                          {m === 'recurring' && recurDue && (
                            <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-rose-500 align-middle" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {mode === 'scans' ? (
                    <div className="px-3.5 py-3.5">
                      <div className="flex items-end justify-between">
                        <span className="text-[28px] font-extrabold leading-none tabular-nums text-gray-900">
                          {view.scanCount}
                        </span>
                        <span className="pb-0.5 text-[12px] font-bold tabular-nums text-gray-400">of {view.target}</span>
                      </div>
                      <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-gray-100 ring-1 ring-gray-200">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ backgroundColor: tone.ring }}
                          animate={{ width: `${Math.min(100, view.percent)}%` }}
                          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                        />
                      </div>
                      <p className="mt-2 flex items-center gap-1 text-[10.5px] font-semibold text-gray-500">
                        <Barcode className="h-3 w-3" />
                        Live deduped scans for this station.
                      </p>
                      <p className="mt-1 text-[10.5px] font-bold tabular-nums" style={{ color: tone.ring }}>
                        {Math.max(0, view.target - view.scanCount)} scans left to hit goal
                      </p>
                    </div>
                  ) : mode === 'recurring' ? (
                    <div>
                      {/* whole-list reset interval */}
                      <div className="flex items-center justify-between gap-2 px-3 pt-2.5">
                        <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-gray-400">
                          <Clock className="h-3 w-3" /> Resets every
                        </span>
                        <div className="flex gap-0.5 rounded-lg bg-gray-100 p-0.5 ring-1 ring-gray-200">
                          {RECUR_INTERVALS.map((opt) => (
                            <button
                              key={opt.label}
                              type="button"
                              onClick={() => changeInterval(opt.ms)}
                              className={cn(
                                'rounded-md px-1.5 py-0.5 text-[10px] font-bold transition-colors',
                                intervalMs === opt.ms
                                  ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200'
                                  : 'text-gray-500 hover:text-gray-900',
                              )}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {recurDue && (
                        <p className="mt-1.5 flex items-center gap-1 px-3.5 text-[10.5px] font-bold text-rose-600">
                          <Bell className="h-3 w-3" /> Due now — re-check these tasks.
                        </p>
                      )}

                      <div className="mt-1 max-h-[200px] overflow-y-auto px-2 pb-2">
                        <TaskList
                          items={recurItems}
                          onToggle={toggleRecur}
                          onRemove={removeRecur}
                          adding={adding}
                          draft={draft}
                          onDraft={setDraft}
                          onAdd={addRecur}
                          onStartAdd={() => setAdding(true)}
                          onCancelAdd={() => {
                            setAdding(false);
                            setDraft('');
                          }}
                          emptyHint="No recurring tasks yet. These reset on the interval above."
                          placeholder="New recurring task…"
                          addLabel="Add recurring task"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="max-h-[230px] overflow-y-auto px-2 py-2">
                      <TaskList
                        items={todoItems}
                        onToggle={toggleTodo}
                        onRemove={removeTodo}
                        adding={adding}
                        draft={draft}
                        onDraft={setDraft}
                        onAdd={addTodo}
                        onStartAdd={() => setAdding(true)}
                        onCancelAdd={() => {
                          setAdding(false);
                          setDraft('');
                        }}
                        emptyHint="No tasks yet. Add your to-dos."
                        placeholder="New task…"
                        addLabel="Add a task"
                      />
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
      </AnchoredLayer>
    </div>
  );
}
