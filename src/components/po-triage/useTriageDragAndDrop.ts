'use client';

import { useCallback, useState } from 'react';
import {
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { toast } from 'sonner';
import { TRIAGE_PILES, type TriagePile, type TriagePiles, type TriageRow } from './types';

const PILE_PREFIX = 'pile-';
const ROW_PREFIX = 'row-';

export function pileDropId(pile: TriagePile): string {
  return `${PILE_PREFIX}${pile}`;
}
export function rowDragId(id: string, pile: TriagePile): string {
  return `${ROW_PREFIX}${id}-${pile}`;
}

interface UseTriageDragAndDropOptions {
  piles: TriagePiles;
  setPiles: React.Dispatch<React.SetStateAction<TriagePiles>>;
}

function moveBetweenPiles(
  piles: TriagePiles,
  rowId: string,
  from: TriagePile,
  to: TriagePile,
): { next: TriagePiles; moved: TriageRow | null } {
  if (from === to) return { next: piles, moved: null };
  const fromBucket = piles[from];
  const idx = fromBucket.items.findIndex((r) => r.id === rowId);
  if (idx === -1) return { next: piles, moved: null };
  const row = { ...fromBucket.items[idx], pile: to };
  const next: TriagePiles = {
    ...piles,
    [from]: {
      ...fromBucket,
      items: fromBucket.items.filter((_, i) => i !== idx),
      count: Math.max(0, fromBucket.count - 1),
    },
    [to]: {
      ...piles[to],
      items: [row, ...piles[to].items],
      count: piles[to].count + 1,
    },
  };
  return { next, moved: row };
}

export function useTriageDragAndDrop({ piles, setPiles }: UseTriageDragAndDropOptions) {
  const [activeRow, setActiveRow] = useState<TriageRow | null>(null);

  // PointerSensor handles mouse + non-touch pens. TouchSensor with a small
  // delay avoids hijacking scroll on phones — long-press to drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const movePile = useCallback(
    async (rowId: string, from: TriagePile, to: TriagePile) => {
      if (from === to) return;
      let snapshot: TriagePiles | null = null;
      let moved: TriageRow | null = null;
      setPiles((prev) => {
        snapshot = prev;
        const result = moveBetweenPiles(prev, rowId, from, to);
        moved = result.moved;
        return result.next;
      });
      if (!moved) return;

      try {
        const res = await fetch(`/api/admin/po-gmail/triage/${rowId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pile: to }),
        });
        if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);

        toast.success(`Moved to ${to}`, {
          action: {
            label: 'Undo',
            onClick: () => {
              void movePile(rowId, to, from);
            },
          },
        });
      } catch (err) {
        // Roll back optimistic move
        if (snapshot) setPiles(snapshot);
        toast.error(err instanceof Error ? err.message : 'Move failed');
      }
    },
    [setPiles],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as { row: TriageRow } | undefined;
    setActiveRow(data?.row ?? null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveRow(null);
      const { active, over } = event;
      if (!over) return;

      const data = active.data.current as { row: TriageRow; from: TriagePile } | undefined;
      if (!data) return;

      const overId = String(over.id);
      if (!overId.startsWith(PILE_PREFIX)) return;
      const to = overId.slice(PILE_PREFIX.length) as TriagePile;
      if (!TRIAGE_PILES.includes(to)) return;

      void movePile(data.row.id, data.from, to);
    },
    [movePile],
  );

  const handleDragCancel = useCallback(() => {
    setActiveRow(null);
  }, []);

  return {
    activeRow,
    sensors,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
    movePile,
  };
}
