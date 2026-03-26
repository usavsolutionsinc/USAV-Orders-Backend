'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Minus, Plus } from '@/components/Icons';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';

export interface FbaListItemRow {
  id: number | string;
  displayTitle: string;
  /** Shown in monospace below the title. */
  fnskuSubtext: string;
  /** Secondary label shown next to fnsku subtext (e.g. plan ref, status). */
  subLabel?: string | null;
  /** Tailwind class for subLabel colour. Defaults to text-gray-500. */
  subLabelClass?: string;
  qty: number;
  /** When provided, renders a fill-height +/- stepper instead of static qty. */
  onIncrease?: () => void;
  onDecrease?: () => void;
  /** Controlled by caller — defaults to qty > 0. */
  canDecrease?: boolean;
  /** Emitted when the row content area is clicked (e.g. focus plan). */
  onFocus?: () => void;
}

export interface FbaSelectionItemListProps {
  items: FbaListItemRow[];
  /** Theme-aware class for the FNSKU monospace subtext. */
  fnskuSubtextClass: string;
  /** Theme-aware focus ring class for the row button. */
  focusRingClass: string;
}

/**
 * Shared item list for:
 * - FbaWorkspaceScanField "Selected items" (static qty, focus-on-click)
 * - StationFbaInput bulk FNSKU validation (fill-height +/- stepper)
 */
export function FbaSelectionItemList({
  items,
  fnskuSubtextClass,
  focusRingClass,
}: FbaSelectionItemListProps) {
  const reduceMotion = useReducedMotion();
  const transition = reduceMotion ? { duration: 0 } : framerTransition.stationSerialRow;

  return (
    <motion.ul layout className="space-y-2">
      <AnimatePresence initial={false}>
        {items.map((item) => {
          const hasStepper = Boolean(item.onIncrease || item.onDecrease);
          const decreaseDisabled = item.canDecrease === false || item.qty <= 0;
          return (
            <motion.li
              key={item.id}
              layout
              initial={reduceMotion ? false : framerPresence.upNextRow.initial}
              animate={framerPresence.upNextRow.animate}
              exit={reduceMotion ? { opacity: 0 } : framerPresence.upNextRow.exit}
              transition={transition}
            >
              <div className="flex items-stretch gap-2 border-b border-gray-200/80 pb-2 last:border-b-0 last:pb-0">
                {/* Main content — clickable when onFocus provided */}
                {item.onFocus ? (
                  <button
                    type="button"
                    onClick={item.onFocus}
                    className={`min-w-0 flex-1 text-left ${focusRingClass}`}
                  >
                    <ItemContent item={item} fnskuSubtextClass={fnskuSubtextClass} hasStepper={hasStepper} />
                  </button>
                ) : (
                  <div className="min-w-0 flex-1">
                    <ItemContent item={item} fnskuSubtextClass={fnskuSubtextClass} hasStepper={hasStepper} />
                  </div>
                )}

                {/* Fill-height stepper */}
                {hasStepper ? (
                  <div className="flex w-7 shrink-0 flex-col self-stretch overflow-hidden rounded-md border border-gray-200">
                    <button
                      type="button"
                      onClick={item.onIncrease}
                      className="flex flex-1 items-center justify-center bg-white text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 focus-visible:outline-none"
                      aria-label="Increase quantity"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                    <span className="flex items-center justify-center border-y border-gray-200 py-0.5 text-[10px] font-black tabular-nums text-gray-900">
                      {item.qty}
                    </span>
                    <button
                      type="button"
                      onClick={item.onDecrease}
                      disabled={decreaseDisabled}
                      className="flex flex-1 items-center justify-center bg-red-50 text-red-500 transition-colors hover:bg-red-100 disabled:opacity-30 focus-visible:outline-none"
                      aria-label="Decrease quantity"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                  </div>
                ) : null}
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </motion.ul>
  );
}

function ItemContent({
  item,
  fnskuSubtextClass,
  hasStepper,
}: {
  item: FbaListItemRow;
  fnskuSubtextClass: string;
  hasStepper: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[12px] font-black uppercase leading-snug tracking-[0.12em] text-gray-900">
          {item.displayTitle}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
          <span className={fnskuSubtextClass}>{item.fnskuSubtext}</span>
          {item.subLabel ? (
            <span className={`font-semibold uppercase tracking-[0.12em] ${item.subLabelClass ?? 'text-gray-500'}`}>
              {item.subLabel}
            </span>
          ) : null}
        </div>
      </div>
      {!hasStepper ? (
        <span className="shrink-0 text-[10px] font-black tabular-nums text-gray-700">
          Qty {item.qty}
        </span>
      ) : null}
    </div>
  );
}
