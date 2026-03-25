'use client';

import type { Dispatch, KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ClipboardList, Clock } from '@/components/Icons';
import type { EnrichedItem, TableAction } from './types';
import { PrintTableCheckbox } from './Checkbox';
import { StatusBadge } from './StatusBadge';
import { RemoveFromPlanButton } from './RemoveFromPlanButton';
import { ItemExpandPanel } from './ItemExpandPanel';
import { FnskuChip } from '@/components/ui/CopyChip';

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
  onNeedsPrintClick,
}: {
  item: EnrichedItem;
  selected: Set<number>;
  dispatch: Dispatch<TableAction>;
  reducedMotion: boolean;
  onRequestRemove: (item: EnrichedItem) => void;
  onNeedsPrintClick: (item: EnrichedItem) => void;
}) {
  const isChecked = selected.has(item.item_id);
  const remaining = Math.max(0, item.expected_qty - item.actual_qty);
  const showRemove = item.expected_qty === 1 && item.actual_qty === 0;
  const showPrinted = Boolean(item.amazon_shipment_id);
  const pendingNote =
    item.status === 'pending_out_of_stock' || item.status === 'pending_qc_fail'
      ? item.pending_reason_note
      : null;

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
          cursor-pointer select-none border-b border-zinc-100/90 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40
          ${rowAccent(item)}
          ${isChecked ? 'bg-sky-100/60 hover:bg-sky-100/80' : 'bg-white hover:bg-stone-50'}
        `}
      >
        <td
          className="pl-3 pr-1 py-2.5 w-8 sm:pl-4"
          onClick={(e) => e.stopPropagation()}
        >
          <PrintTableCheckbox
            checked={isChecked}
            reducedMotion={reducedMotion}
            label={isChecked ? `Deselect ${item.fnsku}` : `Select ${item.fnsku}`}
            onChange={() => dispatch({ type: 'TOGGLE_SELECT', id: item.item_id })}
          />
        </td>

        <td className="px-2 py-2.5">
          <div className="flex min-w-0 items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-[12px] font-semibold leading-snug text-zinc-800">
                {item.display_title}
              </p>
              {pendingNote ? (
                <p className="mt-0.5 text-[10px] italic text-zinc-500">
                  {pendingNote}
                </p>
              ) : null}
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-medium text-zinc-500">
                <span className="inline-flex items-center gap-1" title="Planned quantity">
                  <ClipboardList className="h-3.5 w-3.5 text-sky-700" />
                  <span className="tabular-nums">{item.expected_qty}</span>
                </span>
                {showPrinted ? (
                  <span className="inline-flex items-center gap-1" title="Printed quantity">
                    <Check className="h-3.5 w-3.5 text-emerald-700" />
                    <span className="tabular-nums">{item.actual_qty}</span>
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-1" title="Remaining quantity">
                  <Clock className="h-3.5 w-3.5 text-amber-600" />
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
          <div className="flex h-full flex-col items-end justify-between gap-1 text-right">
            <StatusBadge
              status={item.status}
              needsReason={false}
              onBadgeClick={
                item.status === 'ready_to_print' ? () => onNeedsPrintClick(item) : undefined
              }
            />
            <div className="flex items-center justify-end gap-2">
              <FnskuChip value={item.fnsku} width="w-[58px]" />
            </div>
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
