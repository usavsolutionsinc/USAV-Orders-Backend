'use client';

import { useState, type Dispatch, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Clock, Minus, Plus } from '@/components/Icons';
import type { StationTheme } from '@/utils/staff-colors';
import { printQueueTableUi } from '@/utils/staff-colors';
import type { EnrichedItem, TableAction } from './types';
import { PrintTableCheckbox } from './Checkbox';
import { RemoveFromPlanButton } from './RemoveFromPlanButton';
import { ItemExpandPanel } from './ItemExpandPanel';
import { FnskuChip } from '@/components/ui/CopyChip';
import { fbaPrintTableTokens as T } from './fbaPrintTableTokens';
import { canRemoveFbaPrintQueueLine } from './utils';

function rowAccent(item: EnrichedItem): string {
  if (item.status === 'pending_out_of_stock') {
    return 'border-l-[3px] border-l-amber-400 bg-amber-50/70';
  }
  if (item.status === 'pending_qc_fail') {
    return 'border-l-[3px] border-l-red-400 bg-red-50/60';
  }
  return '';
}

export function ItemRow({
  item,
  selected,
  dispatch,
  reducedMotion,
  onRequestRemove,
  onAdjustPlannedQty,
  stationTheme = 'lightblue',
}: {
  item: EnrichedItem;
  selected: Set<number>;
  dispatch: Dispatch<TableAction>;
  reducedMotion: boolean;
  onRequestRemove: (item: EnrichedItem) => void;
  onAdjustPlannedQty: (item: EnrichedItem, delta: 1 | -1) => void | Promise<void>;
  stationTheme?: StationTheme;
}) {
  const pq = printQueueTableUi[stationTheme];
  const isChecked = selected.has(item.item_id);
  const [qtySaving, setQtySaving] = useState(false);
  const remaining = Math.max(0, item.expected_qty - item.actual_qty);
  const showRemove = item.expected_qty === 1 && item.actual_qty === 0;
  const showPrinted = Boolean(item.amazon_shipment_id);
  const pendingNote =
    item.status === 'pending_out_of_stock' || item.status === 'pending_qc_fail'
      ? item.pending_reason_note
      : null;

  const minusDeleteStyle = item.expected_qty === 1;
  const minusDisabled =
    qtySaving ||
    (item.expected_qty === 1 && !canRemoveFbaPrintQueueLine(item)) ||
    (item.expected_qty > 1 && item.expected_qty <= item.actual_qty);

  const handlePlannedDelta = async (delta: 1 | -1) => {
    if (qtySaving) return;
    if (
      delta === -1 &&
      item.expected_qty === 1 &&
      canRemoveFbaPrintQueueLine(item)
    ) {
      onAdjustPlannedQty(item, delta);
      return;
    }
    setQtySaving(true);
    try {
      await onAdjustPlannedQty(item, delta);
    } finally {
      setQtySaving(false);
    }
  };

  return (
    <>
      <motion.tr
        layout={!reducedMotion}
        transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
        onClick={() => dispatch({ type: 'TOGGLE_EXPAND', id: item.item_id })}
        onKeyDown={(event: KeyboardEvent<HTMLTableRowElement>) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            dispatch({ type: 'TOGGLE_EXPAND', id: item.item_id });
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={item.expanded}
        aria-label={`Row ${item.fnsku}`}
        className={`
          ${T.itemRowBase}
          ${pq.rowFocusRing}
          ${rowAccent(item)}
          ${isChecked ? pq.rowSelected : 'bg-white hover:bg-gray-50/80'}
        `}
      >
        <td
          className="pl-3 pr-1 py-2.5 w-8 sm:pl-4"
          onClick={(e) => e.stopPropagation()}
        >
          <PrintTableCheckbox
            checked={isChecked}
            reducedMotion={reducedMotion}
            stationTheme={stationTheme}
            label={isChecked ? `Deselect ${item.fnsku}` : `Select ${item.fnsku}`}
            onChange={() => dispatch({ type: 'TOGGLE_SELECT', id: item.item_id })}
          />
        </td>

        <td className="px-2 py-2.5">
          <div className="flex min-w-0 items-start gap-3">
            <div className="min-w-0 flex-1 flex flex-col">
              <div className="min-w-0">
                <p className={T.itemTitle}>{item.display_title}</p>
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate text-[10px] font-bold uppercase tracking-widest text-gray-400">
                  <span
                    className={`tabular-nums ${item.expected_qty > 1 ? 'text-yellow-600' : ''}`}
                    title="Planned quantity"
                  >
                    {item.expected_qty}
                  </span>
                </div>
              </div>
              {pendingNote ? <p className={T.itemNote}>{pendingNote}</p> : null}
              <div className={T.itemMetaRow}>
                {showPrinted ? (
                  <span className="inline-flex items-center gap-1" title="Printed quantity">
                    <Check className={T.itemMetaIconPrinted} />
                    <span className="tabular-nums">{item.actual_qty}</span>
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-1" title="Remaining quantity">
                  <Clock className={T.itemMetaIconRemaining} />
                  <span className="tabular-nums">{remaining}</span>
                </span>
                {showRemove ? (
                  <RemoveFromPlanButton fnsku={item.fnsku} onConfirm={() => onRequestRemove(item)} />
                ) : null}
              </div>
            </div>
          </div>
        </td>

        <td className="px-1 py-2.5" onClick={(e) => e.stopPropagation()}>
          <div className="flex h-full items-start justify-end gap-2">
            {isChecked ? (
              <div className="flex flex-col gap-0.5" role="group" aria-label="Adjust planned quantity">
                <button
                  type="button"
                  disabled={qtySaving || item.status === 'shipped'}
                  onClick={() => void handlePlannedDelta(1)}
                  title="Increase planned quantity"
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 shadow-sm transition-colors hover:border-violet-200 hover:bg-violet-50 hover:text-violet-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  disabled={minusDisabled}
                  onClick={() => void handlePlannedDelta(-1)}
                  title={
                    minusDeleteStyle && canRemoveFbaPrintQueueLine(item)
                      ? 'Remove line from plan'
                      : 'Decrease planned quantity'
                  }
                  className={`flex h-7 w-7 items-center justify-center rounded-lg border text-sm font-bold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    minusDeleteStyle
                      ? 'border-red-700 bg-red-600 text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/70'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-800'
                  }`}
                >
                  <Minus className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            ) : null}
            <FnskuChip value={item.fnsku} width="w-[58px]" />
          </div>
        </td>
      </motion.tr>

      <AnimatePresence initial={false}>
        {item.expanded && (
          <motion.tr
            key={`expand-${item.item_id}`}
            initial={
              reducedMotion
                ? false
                : { opacity: 0, filter: 'blur(3px)', y: -4 }
            }
            animate={
              reducedMotion ? undefined : { opacity: 1, filter: 'blur(0px)', y: 0 }
            }
            exit={
              reducedMotion
                ? undefined
                : { opacity: 0, height: 0, transition: { duration: 0.18 } }
            }
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <td colSpan={3} className="p-0">
              <ItemExpandPanel item={item} dispatch={dispatch} onRequestRemove={onRequestRemove} />
            </td>
          </motion.tr>
        )}
      </AnimatePresence>
    </>
  );
}
