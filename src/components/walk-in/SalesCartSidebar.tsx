'use client';

/**
 * Walk-in sales sidebar — the slim selectable item list.
 *
 * The sales counterpart to {@link ../work-orders/LocalPickupSidebarList}: each
 * staged product is a compact, selectable row (photo · title · price · qty).
 * Clicking a row points the shared store's `selectedKey` at it, which drives
 * the main-pane editor (`SalesEditPanel`). The footer carries the subtotal +
 * the "Charge $X" button that dispatches the order to the Square terminal.
 * Adding happens in the main pane's popover, so this panel is pure list +
 * checkout (no inline editing).
 */

import { AnimatePresence, motion } from 'framer-motion';
import { Check, Loader2, Package, ShoppingCart } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { getSidebarIntakeSubmitButtonClass } from '@/design-system/components';
import { formatCentsToDollars } from '@/lib/square/client';
import {
  checkout,
  selectLine,
  useSalesCart,
  type SalesCartLine,
} from './salesCartStore';

export function SalesCartSidebar() {
  const { cart, selectedKey, isSubmitting, submitError, successMessage } = useSalesCart();

  const subtotal = cart.reduce((sum, l) => sum + l.unitAmount * l.quantity, 0);
  const unitCount = cart.reduce((sum, l) => sum + l.quantity, 0);
  const canSubmit = cart.length > 0 && !isSubmitting;
  const submitClass = getSidebarIntakeSubmitButtonClass('green');

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-card">
      <div className="border-b border-border-hairline px-3 py-2.5">
        <p className="text-eyebrow font-black uppercase tracking-widest text-emerald-500">
          Walk-In Sale
        </p>
        <h3 className="mt-0.5 text-label font-black uppercase tracking-tight text-text-default">
          New Sale
        </h3>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2.5">
        {cart.length === 0 ? (
          <div className="mt-2 rounded-xl border border-dashed border-border-soft bg-surface-canvas/60 p-4 text-center">
            <ShoppingCart className="mx-auto mb-1 h-5 w-5 text-text-faint" />
            <p className="text-micro font-bold text-text-faint">
              Add items from the panel →
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <AnimatePresence initial={false}>
              {cart.map((line) => (
                <SalesListRow
                  key={line.key}
                  line={line}
                  active={line.key === selectedKey}
                  onSelect={() => selectLine(line.key)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <div className="border-t border-border-hairline bg-surface-card px-3 py-2.5">
        <div className="space-y-2">
          {cart.length > 0 ? (
            <div className="flex items-center justify-between border-b border-border-hairline pb-2">
              <span className="text-micro font-black uppercase tracking-wider text-text-soft">
                Subtotal
              </span>
              <span className="text-sm font-black text-emerald-600">
                {formatCentsToDollars(subtotal)}
              </span>
            </div>
          ) : null}
          <Button
            type="button"
            onClick={() => void checkout()}
            disabled={!canSubmit}
            icon={
              isSubmitting ? (
                <Loader2 className="animate-spin" />
              ) : successMessage ? (
                <Check />
              ) : (
                <ShoppingCart />
              )
            }
            className={`w-full ${submitClass}`}
          >
            {isSubmitting
              ? 'Sending…'
              : successMessage
                ? successMessage
                : cart.length > 0
                  ? `Charge ${formatCentsToDollars(subtotal)}`
                  : 'Add Products'}
          </Button>
          {submitError ? (
            <p className="text-center text-eyebrow font-bold text-red-600">
              {submitError}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface SalesListRowProps {
  line: SalesCartLine;
  active: boolean;
  onSelect: () => void;
}

function SalesListRow({ line, active, onSelect }: SalesListRowProps) {
  return (
    <motion.button
      type="button"
      onClick={onSelect}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18 }}
      className={`ds-raw-button w-full rounded-xl border p-2 text-left transition-colors ${
        active
          ? 'border-emerald-300 bg-emerald-50/70 ring-1 ring-emerald-200'
          : 'border-border-soft bg-surface-card hover:bg-surface-hover'
      }`}
    >
      <div className="flex items-center gap-2">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-card">
          {line.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={line.image_url} alt="" className="h-full w-full object-contain" />
          ) : (
            <Package className="h-5 w-5 text-text-faint" />
          )}
        </div>
        <p className="min-w-0 flex-1 truncate text-caption font-bold leading-snug text-text-default">
          {line.product_title}
        </p>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-eyebrow">
        <span className="font-black text-emerald-700">
          {formatCentsToDollars(line.unitAmount * line.quantity)}
        </span>
        <span className="font-black text-text-soft">x{line.quantity}</span>
        {line.sku ? (
          <span className="ml-auto min-w-0 truncate font-black text-text-faint">{line.sku}</span>
        ) : line.isManual ? (
          <span className="ml-auto font-black text-text-faint">Manual</span>
        ) : null}
      </div>
    </motion.button>
  );
}
