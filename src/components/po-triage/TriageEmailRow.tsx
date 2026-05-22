'use client';

import { useDraggable } from '@dnd-kit/core';
import { GripVertical } from '@/components/Icons';
import { rowDragId } from './useTriageDragAndDrop';
import type { TriagePile, TriageRow } from './types';

interface TriageEmailRowProps {
  row: TriageRow;
  pile: TriagePile;
  onClick?: (row: TriageRow) => void;
  /** Hide the source row while it's being dragged — DragOverlay shows it. */
  dragging?: boolean;
  /** Compact mode for the DragOverlay card. */
  compact?: boolean;
  /** Highlight when this row's detail view is currently open. */
  selected?: boolean;
}

export function TriageEmailRow({ row, pile, onClick, dragging, compact, selected }: TriageEmailRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: rowDragId(row.id, pile),
    data: { row, from: pile },
  });

  const hidden = dragging ?? isDragging;
  const style: React.CSSProperties | undefined = hidden ? { visibility: 'hidden' } : undefined;

  return (
    <div
      ref={compact ? undefined : setNodeRef}
      style={style}
      className={
        compact
          ? 'flex items-start gap-1.5 rounded-md border border-blue-300 bg-white px-2 py-1.5 shadow-lg'
          : `group flex items-start gap-1.5 px-2 py-1.5 transition-colors ${
              selected ? 'bg-blue-50' : 'hover:bg-gray-50'
            }`
      }
    >
      {!compact && (
        <button
          type="button"
          {...listeners}
          {...attributes}
          aria-label="Drag to move"
          className="mt-0.5 flex h-4 w-4 shrink-0 cursor-grab items-center justify-center rounded text-gray-300 transition-colors hover:text-gray-600 active:cursor-grabbing"
        >
          <GripVertical className="h-3 w-3" />
        </button>
      )}

      <button
        type="button"
        onClick={onClick ? () => onClick(row) : undefined}
        disabled={!onClick}
        className={`min-w-0 flex-1 text-left ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <div className="truncate text-[12px] font-medium text-gray-900">
          {row.email_subject || '(no subject)'}
        </div>
        <div className="mt-0.5 truncate text-[10.5px] text-gray-500">{row.email_from}</div>
        {row.po_numbers.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {row.po_numbers.slice(0, 3).map((po) => (
              <span
                key={po}
                className="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] text-amber-700"
              >
                {po}
              </span>
            ))}
            {row.po_numbers.length > 3 && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
                +{row.po_numbers.length - 3}
              </span>
            )}
          </div>
        )}
      </button>
    </div>
  );
}
