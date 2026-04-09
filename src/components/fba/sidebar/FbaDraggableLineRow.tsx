'use client';

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from '@/components/Icons';
import { FbaSelectedLineRow } from '@/components/fba/sidebar/FbaSelectedLineRow';
import type { FbaSelectedLineRowProps } from '@/components/fba/sidebar/FbaSelectedLineRow';

export interface FbaDraggableLineRowProps extends FbaSelectedLineRowProps {
  dragId: string;
  dragData: { itemId: number; sourceContainer: string };
}

export function FbaDraggableLineRow({
  dragId,
  dragData,
  ...rowProps
}: FbaDraggableLineRowProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: dragId,
    data: dragData,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : undefined,
    transition: isDragging ? 'opacity 120ms ease' : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative flex items-stretch">
      <button
        type="button"
        className="flex w-5 shrink-0 cursor-grab items-center justify-center text-gray-300 transition-colors hover:text-gray-500 active:cursor-grabbing"
        aria-label="Drag to move item"
        {...listeners}
        {...attributes}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <div className="min-w-0 flex-1">
        <FbaSelectedLineRow {...rowProps} />
      </div>
    </div>
  );
}
