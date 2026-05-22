'use client';

import { useDroppable } from '@dnd-kit/core';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, ChevronUp, Mail, Send, X } from '@/components/Icons';
import { TriageEmailRow } from './TriageEmailRow';
import { pileDropId } from './useTriageDragAndDrop';
import { TRIAGE_PILE_META, type TriagePile as TriagePileId, type TriagePileBucket, type TriageRow } from './types';

const PILE_ICON: Record<TriagePileId, React.ComponentType<{ className?: string }>> = {
  inbox:  Mail,
  upload: Send,
  ignore: X,
  done:   Check,
};

// Per-pile chrome: idle state, hover-while-dragging (`isOver`), and the
// chip color shown on the header count badge. Mirrors the muted-then-accent
// pattern used by FbaTrackingBucket.
const PILE_CHROME: Record<TriagePileId, { idle: string; over: string; chip: string; iconText: string }> = {
  inbox:  {
    idle: 'border-gray-200 bg-white',
    over: 'border-dashed border-amber-400 bg-amber-50/60',
    chip: 'bg-amber-50 text-amber-700',
    iconText: 'text-amber-600',
  },
  upload: {
    idle: 'border-gray-200 bg-white',
    over: 'border-dashed border-blue-400 bg-blue-50/60',
    chip: 'bg-blue-50 text-blue-700',
    iconText: 'text-blue-600',
  },
  ignore: {
    idle: 'border-gray-200 bg-white',
    over: 'border-dashed border-gray-400 bg-gray-100',
    chip: 'bg-gray-100 text-gray-600',
    iconText: 'text-gray-500',
  },
  done: {
    idle: 'border-gray-200 bg-white',
    over: 'border-dashed border-emerald-400 bg-emerald-50/60',
    chip: 'bg-emerald-50 text-emerald-700',
    iconText: 'text-emerald-600',
  },
};

interface TriagePileProps {
  pile: TriagePileId;
  bucket: TriagePileBucket;
  expanded: boolean;
  onToggleExpanded: (pile: TriagePileId) => void;
  onRowClick?: (row: TriageRow) => void;
  /** Hide a specific row while it's mid-drag (the DragOverlay paints it). */
  draggingRowId?: string | null;
  /** Row id currently open in the detail pane — highlighted in the list. */
  selectedRowId?: string | null;
}

export function TriagePile({
  pile,
  bucket,
  expanded,
  onToggleExpanded,
  onRowClick,
  draggingRowId,
  selectedRowId,
}: TriagePileProps) {
  const meta = TRIAGE_PILE_META[pile];
  const chrome = PILE_CHROME[pile];
  const Icon = PILE_ICON[pile];

  const { setNodeRef, isOver } = useDroppable({ id: pileDropId(pile) });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border transition-colors ${isOver ? chrome.over : chrome.idle}`}
    >
      <button
        type="button"
        onClick={() => onToggleExpanded(pile)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
        aria-expanded={expanded}
      >
        <Icon className={`h-3.5 w-3.5 shrink-0 ${chrome.iconText}`} />
        <span className="text-[12.5px] font-semibold text-gray-900">{meta.label}</span>
        <span
          className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${chrome.chip}`}
        >
          {bucket.count.toLocaleString()}
          {bucket.truncated ? '+' : ''}
        </span>
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 text-gray-400" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="overflow-hidden border-t border-gray-100"
          >
            {bucket.items.length === 0 ? (
              <p className="px-2.5 py-3 text-center text-[10.5px] uppercase tracking-wider text-gray-400">
                {isOver ? 'Drop here' : meta.helper}
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {bucket.items.map((row) => (
                  <li key={row.id}>
                    <TriageEmailRow
                      row={row}
                      pile={pile}
                      onClick={onRowClick}
                      dragging={draggingRowId === row.id}
                      selected={selectedRowId === row.id}
                    />
                  </li>
                ))}
                {bucket.truncated && (
                  <li className="px-2.5 py-1.5 text-center text-[10.5px] italic text-gray-400">
                    Showing newest {bucket.items.length} of {bucket.count.toLocaleString()}
                  </li>
                )}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
