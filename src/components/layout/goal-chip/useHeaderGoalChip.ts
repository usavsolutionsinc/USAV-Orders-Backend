'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  asMode,
  modeKey,
  readLS,
  writeLS,
  type GoalMode,
  type StationKey,
} from './goal-chip-shared';
import { useStationGoals } from './useStationGoals';
import { useGoalChecklists } from './useGoalChecklists';

/**
 * Controller for the header goal chip. Composes {@link useStationGoals} (goals +
 * active station) and {@link useGoalChecklists} (server-backed checklists), and
 * owns the popover/mode UI state plus the progress view-model. Returns one bag
 * consumed by the chip shell + popover.
 */
export function useHeaderGoalChip() {
  const { user } = useAuth();
  const staffId = user?.staffId ?? null;

  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [mode, setMode] = useState<GoalMode>('scans');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  const { goals, active, selectStation, reload } = useStationGoals(staffId);
  const checklists = useGoalChecklists(staffId, active);

  // When the active station changes, hydrate its mode (a UI pref) from LS.
  useEffect(() => {
    if (!staffId || !active) return;
    setMode(asMode(readLS<string>(modeKey(staffId, active), 'scans')));
    setAdding(false);
    setDraft('');
  }, [staffId, active]);

  // Refresh live counts each time the popover opens.
  useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  const closePopover = useCallback(() => {
    setOpen(false);
    setSwitching(false);
  }, []);

  const onSelectStation = useCallback(
    (st: StationKey) => {
      selectStation(st);
      setSwitching(false);
    },
    [selectStation],
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

  const onStartAdd = useCallback(() => setAdding(true), []);
  const onCancelAdd = useCallback(() => {
    setAdding(false);
    setDraft('');
  }, []);
  const onAddTodo = useCallback(() => {
    if (!draft.trim()) return;
    checklists.addTodo(draft);
    setDraft('');
  }, [draft, checklists]);
  const onAddRecur = useCallback(() => {
    if (!draft.trim()) return;
    checklists.addRecur(draft);
    setDraft('');
  }, [draft, checklists]);

  const activeGoal = useMemo(() => goals?.find((g) => g.station === active) ?? null, [goals, active]);

  const view = useMemo(() => {
    if (!activeGoal) return null;
    const { target, scanCount } = activeGoal;
    if (mode === 'todo' || mode === 'recurring') {
      const list = mode === 'todo' ? checklists.todoItems : checklists.recurItems;
      const done = list.filter((t) => t.done).length;
      const total = list.length;
      const percent = total === 0 ? 0 : Math.round((done / total) * 100);
      return { target, scanCount, done, total, percent };
    }
    return { target, scanCount, done: 0, total: 0, percent: target <= 0 ? 0 : Math.round((scanCount / target) * 100) };
  }, [activeGoal, checklists.todoItems, checklists.recurItems, mode]);

  return {
    user,
    goals,
    active,
    activeGoal,
    view,
    open,
    setOpen,
    switching,
    setSwitching,
    mode,
    changeMode,
    adding,
    draft,
    setDraft,
    onStartAdd,
    onCancelAdd,
    onAddTodo,
    onAddRecur,
    onSelectStation,
    closePopover,
    wrapRef,
    ...checklists,
  };
}

export type HeaderGoalChipController = ReturnType<typeof useHeaderGoalChip>;
