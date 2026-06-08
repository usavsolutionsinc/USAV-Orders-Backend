'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
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
 * There is no backend for the checklists yet, so the chosen mode, the to-dos,
 * and the recurring list (+ its interval + cycle anchor) are persisted to
 * localStorage, scoped per staff + station.
 */

type StationKey = 'TECH' | 'PACK' | 'UNBOX' | 'SALES' | 'FBA';
type GoalMode = 'scans' | 'recurring' | 'todo';
type Todo = { id: string; text: string; done: boolean };
/** Recurring checklist: one reset interval for the whole list, anchored to the
 *  start of the current cycle so it rolls over even while the popover is shut. */
type RecurringState = { intervalMs: number; anchor: number; items: Todo[] };

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
function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }
}

const activeKey = (staffId: number) => `usav.hgoal.active.${staffId}`;
const modeKey = (staffId: number, st: StationKey) => `usav.hgoal.mode.${staffId}.${st}`;
const todoKey = (staffId: number, st: StationKey) => `usav.hgoal.todo.${staffId}.${st}`;
const recurKey = (staffId: number, st: StationKey) => `usav.hgoal.recurring.${staffId}.${st}`;

function defaultRecurring(now: number): RecurringState {
  return { intervalMs: DEFAULT_INTERVAL_MS, anchor: now, items: [] };
}

/** Accept whatever the mode key holds (incl. the legacy 'checklist' value). */
function asMode(v: string | null | undefined): GoalMode {
  if (v === 'recurring' || v === 'todo' || v === 'scans') return v;
  if (v === 'checklist') return 'todo'; // legacy v1 single-checklist → general to-do
  return 'scans';
}

/** Advance the recurring list across any elapsed interval cycles, un-checking
 *  every item when at least one full interval has passed since the anchor. */
function rollRecurring(state: RecurringState, now: number): RecurringState {
  if (state.intervalMs <= 0 || state.items.length === 0) return state;
  const elapsed = now - state.anchor;
  if (elapsed < state.intervalMs) return state;
  const cycles = Math.floor(elapsed / state.intervalMs);
  const anchor = state.anchor + cycles * state.intervalMs;
  if (!state.items.some((i) => i.done)) return { ...state, anchor };
  return { ...state, anchor, items: state.items.map((i) => ({ ...i, done: false })) };
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

  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  // Admin-assigned stations for this staffer, primary first, with live counts.
  const [goals, setGoals] = useState<StationGoal[] | null>(null);

  const [active, setActive] = useState<StationKey | null>(null);
  const [mode, setMode] = useState<GoalMode>('scans');
  const [todos, setTodos] = useState<Todo[]>([]);
  const [recurring, setRecurring] = useState<RecurringState>(() => defaultRecurring(Date.now()));
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const wrapRef = useRef<HTMLDivElement>(null);

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

  /* when the active station changes, hydrate its mode + checklists from LS */
  useEffect(() => {
    if (!staffId || !active) return;
    setMode(asMode(readLS<string>(modeKey(staffId, active), 'scans')));
    setTodos(readLS<Todo[]>(todoKey(staffId, active), []));
    const storedRecur = readLS<RecurringState>(recurKey(staffId, active), defaultRecurring(Date.now()));
    const rolled = rollRecurring(storedRecur, Date.now());
    setRecurring(rolled);
    if (rolled !== storedRecur) writeLS(recurKey(staffId, active), rolled);
    setAdding(false);
    setDraft('');
  }, [staffId, active]);

  /* tick the recurring list over even while the popover is closed, so the chip
     can surface the red "due" reminder the moment an interval rolls over */
  useEffect(() => {
    if (!staffId || !active) return;
    const tick = () => {
      setRecurring((cur) => {
        const next = rollRecurring(cur, Date.now());
        if (next !== cur) writeLS(recurKey(staffId, active), next);
        return next;
      });
    };
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [staffId, active]);

  /* refresh live counts each time the popover opens */
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  /* click-outside + Escape close */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSwitching(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setSwitching(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

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

  /* ── general to-do CRUD ──────────────────────────────────────────────────── */
  const persistTodos = useCallback(
    (next: Todo[]) => {
      if (!staffId || !active) return;
      setTodos(next);
      writeLS(todoKey(staffId, active), next);
    },
    [staffId, active],
  );
  const toggleTodo = (id: string) =>
    persistTodos(todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const removeTodo = (id: string) => persistTodos(todos.filter((t) => t.id !== id));
  const addTodo = () => {
    const text = draft.trim();
    if (!text) return;
    persistTodos([...todos, { id: newId(), text, done: false }]);
    setDraft('');
  };

  /* ── recurring CRUD + interval ───────────────────────────────────────────── */
  const persistRecurring = useCallback(
    (next: RecurringState) => {
      if (!staffId || !active) return;
      setRecurring(next);
      writeLS(recurKey(staffId, active), next);
    },
    [staffId, active],
  );
  const toggleRecur = (id: string) =>
    persistRecurring({ ...recurring, items: recurring.items.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) });
  const removeRecur = (id: string) =>
    persistRecurring({ ...recurring, items: recurring.items.filter((t) => t.id !== id) });
  const addRecur = () => {
    const text = draft.trim();
    if (!text) return;
    persistRecurring({ ...recurring, items: [...recurring.items, { id: newId(), text, done: false }] });
    setDraft('');
  };
  // Changing the interval restarts the cycle from now so it doesn't fire instantly.
  const changeInterval = (ms: number) => persistRecurring({ ...recurring, intervalMs: ms, anchor: Date.now() });

  const activeGoal = useMemo(
    () => goals?.find((g) => g.station === active) ?? null,
    [goals, active],
  );

  // Recurring items are "due" whenever any is unchecked — after an interval roll
  // they all un-check, so this lights up the moment the cycle turns over.
  const recurDue = recurring.items.length > 0 && recurring.items.some((t) => !t.done);

  const view = useMemo(() => {
    if (!activeGoal) return null;
    const { target, scanCount } = activeGoal;
    if (mode === 'todo' || mode === 'recurring') {
      const list = mode === 'todo' ? todos : recurring.items;
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
  }, [activeGoal, todos, recurring, mode]);

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

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="absolute left-0 top-[calc(100%+8px)] z-50 w-[290px] origin-top-left overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_12px_40px_rgba(20,30,55,0.16)]"
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
                                recurring.intervalMs === opt.ms
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
                          items={recurring.items}
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
                        items={todos}
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
        )}
      </AnimatePresence>
    </div>
  );
}
