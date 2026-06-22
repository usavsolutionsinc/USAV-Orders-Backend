'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toDateInputValue } from '@/components/work-orders/types';
import {
  type AssignmentConfirmPayload,
  type AssignmentDraft,
  type WorkOrderAssignmentCardProps,
  compareRowsByUpdatedAtDesc,
  isDraftComplete,
  isRowNeedingAssignment,
  isRowUnassigned,
  toDraft,
  toLocalDateKey,
  toRowDateKey,
} from './work-order-assignment-shared';

/**
 * Owns the work-order assignment card's full state machine: the assignable-row
 * derivation + ordering, per-row drafts with localStorage persistence, the
 * resume-to-next-unconfirmed index logic, single-option auto-fill, debounced
 * autosave, confirm→advance, keyboard navigation, and the staff/deadline edit
 * handlers. Returns a controller bag the thin shell renders from.
 */
export function useWorkOrderAssignmentCard({
  rows,
  startIndex,
  technicianOptions,
  packerOptions,
  onConfirm,
  onClose,
  storageKey,
  allowEditConfirmed = false,
  closeWhenCompleted = true,
}: WorkOrderAssignmentCardProps) {
  const [index, setIndex] = useState(0);
  const confirmedIdsRef = useRef(new Set<string>());
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, AssignmentDraft>>({});
  const saveDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const orderedRows = useMemo(() => [...rows].sort(compareRowsByUpdatedAtDesc), [rows]);
  const assignableRows = useMemo(
    () => allowEditConfirmed ? orderedRows : orderedRows.filter((r) => isRowNeedingAssignment(r)),
    [allowEditConfirmed, orderedRows]
  );

  const todayDateKey = useMemo(() => toLocalDateKey(new Date()), []);
  const todayTotalCount = useMemo(
    () => orderedRows.filter((r) => toRowDateKey(r.createdAt ?? null) === todayDateKey).length,
    [orderedRows, todayDateKey]
  );
  const todayUnassignedCount = useMemo(
    () => orderedRows.filter((r) => toRowDateKey(r.createdAt ?? null) === todayDateKey && isRowUnassigned(r)).length,
    [orderedRows, todayDateKey]
  );

  const cancelPendingDebouncedSave = useCallback(() => {
    if (saveDebounceTimerRef.current != null) {
      clearTimeout(saveDebounceTimerRef.current);
      saveDebounceTimerRef.current = null;
    }
  }, []);

  const row = assignableRows[index];
  const [techId, setTechId] = useState<number | null>(null);
  const [packerId, setPackerId] = useState<number | null>(null);
  const [deadline, setDeadline] = useState<string>('');

  useEffect(() => {
    if (!assignableRows.length) {
      onClose();
    }
  }, [assignableRows.length, onClose]);

  useEffect(() => {
    const nextDrafts: Record<string, AssignmentDraft> = {};
    assignableRows.forEach((r) => {
      nextDrafts[r.id] = toDraft(r);
    });

    let nextIndex = 0;
    let confirmedIds = new Set<string>();

    const safeStartIndex = Math.max(0, Math.min(startIndex, Math.max(0, rows.length - 1)));
    const startRowId = rows[safeStartIndex]?.id;
    if (startRowId) {
      const mapped = assignableRows.findIndex((r) => r.id === startRowId);
      if (mapped >= 0) nextIndex = mapped;
    }

    if (storageKey && typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as {
            index?: number;
            rowId?: string;
            assignments?: Record<string, Partial<AssignmentDraft>>;
            confirmedIds?: string[];
          };

          if (parsed.assignments && typeof parsed.assignments === 'object') {
            Object.entries(parsed.assignments).forEach(([rowId, saved]) => {
              if (!nextDrafts[rowId]) return;
              nextDrafts[rowId] = {
                techId: Number.isFinite(Number(saved.techId)) && Number(saved.techId) > 0 ? Number(saved.techId) : null,
                packerId: Number.isFinite(Number(saved.packerId)) && Number(saved.packerId) > 0 ? Number(saved.packerId) : null,
                deadline: typeof saved.deadline === 'string' ? saved.deadline : nextDrafts[rowId].deadline,
              };
            });
          }

          if (typeof parsed.rowId === 'string' && parsed.rowId.trim()) {
            const byId = assignableRows.findIndex((r) => r.id === parsed.rowId);
            if (byId >= 0) nextIndex = byId;
          } else if (Number.isFinite(parsed.index)) {
            nextIndex = Math.max(0, Math.min(Number(parsed.index), Math.max(0, assignableRows.length - 1)));
          }

          if (Array.isArray(parsed.confirmedIds)) {
            const validRowIds = new Set(assignableRows.map((r) => r.id));
            confirmedIds = new Set(parsed.confirmedIds.filter((id) => validRowIds.has(id)));
          }
        }
      } catch {
        // ignore malformed storage payloads
      }
    }

    nextIndex = Math.max(0, Math.min(nextIndex, Math.max(0, assignableRows.length - 1)));

    if (!allowEditConfirmed && assignableRows.length > 0 && confirmedIds.has(assignableRows[nextIndex]?.id)) {
      let resolvedIndex: number | null = null;

      for (let i = nextIndex + 1; i < assignableRows.length; i++) {
        if (!confirmedIds.has(assignableRows[i].id)) {
          resolvedIndex = i;
          break;
        }
      }
      if (resolvedIndex === null) {
        for (let i = nextIndex - 1; i >= 0; i--) {
          if (!confirmedIds.has(assignableRows[i].id)) {
            resolvedIndex = i;
            break;
          }
        }
      }
      nextIndex = resolvedIndex ?? 0;
    }

    // Auto-fill when only one staff option is available
    if (technicianOptions.length === 1 || packerOptions.length === 1) {
      assignableRows.forEach((r) => {
        const draft = nextDrafts[r.id];
        if (draft.techId == null && technicianOptions.length === 1) {
          draft.techId = technicianOptions[0].id;
        }
        if (r.entityType !== 'SKU_STOCK' && draft.packerId == null && packerOptions.length === 1) {
          draft.packerId = packerOptions[0].id;
        }
      });
    }

    setDrafts(nextDrafts);
    setIndex(nextIndex);
    confirmedIdsRef.current = confirmedIds;
    setConfirmedCount(confirmedIds.size);
  }, [assignableRows, rows, startIndex, storageKey, allowEditConfirmed, technicianOptions, packerOptions]);

  const changed =
    techId !== (row?.techId ?? null) ||
    packerId !== (row?.packerId ?? null) ||
    deadline !== toDateInputValue(row?.deadlineAt ?? null);

  useEffect(() => {
    if (!row) return;
    const draft = drafts[row.id] || toDraft(row);
    setTechId(draft.techId);
    setPackerId(draft.packerId);
    setDeadline(draft.deadline);
  }, [index, drafts, row]);

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({
        index,
        rowId: row?.id ?? null,
        assignments: drafts,
        confirmedIds: Array.from(confirmedIdsRef.current),
      }));
    } catch {
      // ignore storage write errors
    }
  }, [storageKey, index, row?.id, drafts, confirmedCount]);

  const findNextNavigableIndex = useCallback((from: number, dir: 'next' | 'prev') => {
    const next = dir === 'next' ? from + 1 : from - 1;
    return next >= 0 && next < assignableRows.length ? next : null;
  }, [assignableRows]);

  const findNextUnconfirmedIndex = useCallback((from: number, dir: 'next' | 'prev') => {
    if (allowEditConfirmed) {
      return findNextNavigableIndex(from, dir);
    }

    if (dir === 'next') {
      for (let i = from + 1; i < assignableRows.length; i++) {
        if (!confirmedIdsRef.current.has(assignableRows[i].id)) return i;
      }
      return null;
    }
    for (let i = from - 1; i >= 0; i--) {
      if (!confirmedIdsRef.current.has(assignableRows[i].id)) return i;
    }
    return null;
  }, [allowEditConfirmed, assignableRows, confirmedCount, findNextNavigableIndex]);

  const advance = useCallback(() => {
    const next = findNextUnconfirmedIndex(index, 'next');
    if (next !== null) {
      setTimeout(() => { setIndex(next); }, 300);
      return;
    }

    const prev = findNextUnconfirmedIndex(index, 'prev');
    if (prev !== null) {
      setTimeout(() => { setIndex(prev); }, 300);
      return;
    }

    if (closeWhenCompleted) {
      if (storageKey && typeof window !== 'undefined') {
        try {
          window.localStorage.removeItem(storageKey);
        } catch {
          // no-op
        }
      }
      setTimeout(onClose, 350);
    }
  }, [findNextUnconfirmedIndex, index, closeWhenCompleted, storageKey, onClose]);

  const markConfirmed = useCallback((rowId: string) => {
    if (confirmedIdsRef.current.has(rowId)) return;
    confirmedIdsRef.current.add(rowId);
    setConfirmedCount((c) => c + 1);
  }, []);

  const save = useCallback((opts?: Partial<AssignmentConfirmPayload>) => {
    if (!row) return;
    onConfirm(row, {
      techId: opts?.techId !== undefined ? opts.techId : techId,
      packerId: opts?.packerId !== undefined ? opts.packerId : packerId,
      deadline: opts?.deadline !== undefined ? opts.deadline : (deadline || null),
      status: opts?.status,
    });
  }, [row, onConfirm, techId, packerId, deadline]);

  const commit = useCallback((opts?: Partial<AssignmentConfirmPayload>) => {
    if (!row) return;
    cancelPendingDebouncedSave();
    markConfirmed(row.id);
    const nextTech = opts?.techId !== undefined ? opts.techId : techId;
    const nextPack = opts?.packerId !== undefined ? opts.packerId : packerId;
    onConfirm(row, {
      techId: nextTech,
      packerId: nextPack,
      deadline: opts?.deadline !== undefined ? opts.deadline : (deadline || null),
      status: opts?.status,
    });
    advance();
  }, [
    row,
    onConfirm,
    techId,
    packerId,
    deadline,
    markConfirmed,
    advance,
    cancelPendingDebouncedSave,
  ]);

  useEffect(() => {
    if (!changed) return;
    cancelPendingDebouncedSave();
    saveDebounceTimerRef.current = setTimeout(() => {
      saveDebounceTimerRef.current = null;
      save();
    }, 450);
    return () => cancelPendingDebouncedSave();
  }, [techId, packerId, deadline, changed, save, cancelPendingDebouncedSave]);

  const navigate = useCallback((dir: 'next' | 'prev') => {
    const next = findNextNavigableIndex(index, dir);
    if (next === null) return;
    setIndex(next);
  }, [index, findNextNavigableIndex]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        navigate('next');
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        navigate('prev');
      }
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [navigate, onClose]);

  const currentDraft = row ? (drafts[row.id] || toDraft(row)) : null;
  const updateCurrentDraft = (next: Partial<AssignmentDraft>) => {
    if (!row || !currentDraft) return;
    setDrafts((prev) => ({
      ...prev,
      [row.id]: {
        techId: currentDraft.techId,
        packerId: currentDraft.packerId,
        deadline: currentDraft.deadline,
        ...next,
      },
    }));
  };

  const hasPrev = findNextNavigableIndex(index, 'prev') !== null;
  const hasNext = findNextNavigableIndex(index, 'next') !== null;
  const remaining = allowEditConfirmed
    ? assignableRows.filter((r) => !isDraftComplete(r, drafts[r.id] || toDraft(r))).length
    : assignableRows.filter((r) => !confirmedIdsRef.current.has(r.id)).length;

  const handleTech = (id: number) => {
    if (!row) return;
    const next = techId === id ? null : id;
    setTechId(next);
    updateCurrentDraft({ techId: next });
    if (isDraftComplete(row, { techId: next, packerId, deadline })) {
      setTimeout(() => {
        if (!row) return;
        cancelPendingDebouncedSave();
        markConfirmed(row.id);
        onConfirm(row, { techId: next, packerId, deadline: deadline || null });
        advance();
      }, 350);
    }
  };

  const handlePacker = (id: number) => {
    if (!row) return;
    const next = packerId === id ? null : id;
    setPackerId(next);
    updateCurrentDraft({ packerId: next });
    if (next != null) {
      setTimeout(() => {
        if (!row) return;
        cancelPendingDebouncedSave();
        markConfirmed(row.id);
        onConfirm(row, { techId, packerId: next, deadline: deadline || null });
        advance();
      }, 350);
    }
  };

  const handleMarkDone = () => commit({ status: 'DONE' });
  const handleMarkShipped = () => commit({ status: 'DONE', packerId: packerId ?? null });

  return {
    row,
    techId, packerId, deadline, setDeadline,
    updateCurrentDraft,
    hasPrev, hasNext, navigate,
    remaining, todayUnassignedCount, todayTotalCount,
    handleTech, handlePacker, handleMarkDone, handleMarkShipped,
  };
}
