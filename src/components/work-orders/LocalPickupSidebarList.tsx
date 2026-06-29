'use client';

/**
 * Local-pickup sidebar — the slim selectable item list.
 *
 * The pickup counterpart to the receiving sidebar's line list: each staged
 * product is a compact, selectable row (photo · title · qty · condition ·
 * Complete/Missing badge). Clicking a row points the shared store's
 * `selectedKey` at it, which drives the main-pane editor
 * (`LocalPickupEditPanel`). The footer carries the subtotal + the
 * "Log N items" submit. Adding happens in the main pane's popover, so this
 * panel is pure list + submit (no inline editing).
 */

import { AnimatePresence, motion } from 'framer-motion';
import { Check, Package, ShoppingCart } from '@/components/Icons';
import { getSidebarIntakeSubmitButtonClass } from '@/design-system/components';
import { Button } from '@/design-system/primitives';
import {
  conditionLabel,
  formatMoney,
  openReview,
  parseMoney,
  selectLine,
  useLocalPickupCart,
  type CartLine,
} from './localPickupStore';

export function LocalPickupSidebarList() {
  const { cart, selectedKey, submitError, successMessage } = useLocalPickupCart();

  const subtotal = cart.reduce((sum, l) => sum + parseMoney(l.total), 0);
  const unitCount = cart.reduce((sum, l) => sum + l.quantity, 0);
  const canSubmit = cart.length > 0;
  const submitClass = getSidebarIntakeSubmitButtonClass('green');

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
      <div className="border-b border-gray-100 px-3 py-2.5">
        <p className="text-eyebrow font-black uppercase tracking-widest text-emerald-500">
          Local Pickup
        </p>
        <h3 className="mt-0.5 text-label font-black uppercase tracking-tight text-gray-900">
          New Intake
        </h3>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2.5">
        {cart.length === 0 ? (
          <div className="mt-2 rounded-xl border border-dashed border-gray-200 bg-gray-50/60 p-4 text-center">
            <ShoppingCart className="mx-auto mb-1 h-5 w-5 text-gray-300" />
            <p className="text-micro font-bold text-gray-400">
              Add items from the panel →
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <AnimatePresence initial={false}>
              {cart.map((line) => (
                <PickupListRow
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

      <div className="border-t border-gray-100 bg-white px-3 py-2.5">
        <div className="space-y-2">
          {cart.length > 0 ? (
            <div className="flex items-center justify-between border-b border-gray-100 pb-2">
              <span className="text-micro font-black uppercase tracking-wider text-gray-500">
                Subtotal
              </span>
              <span className="text-sm font-black text-emerald-600">
                {formatMoney(subtotal)}
              </span>
            </div>
          ) : null}
          <Button
            onClick={() => openReview()}
            disabled={!canSubmit}
            className={`flex w-full items-center justify-center gap-2 ${submitClass}`}
          >
            {successMessage ? (
              <>
                <Check className="h-4 w-4" /> {successMessage}
              </>
            ) : (
              <>
                <ShoppingCart className="h-4 w-4" />
                {cart.length > 0
                  ? `Review ${unitCount} Item${unitCount === 1 ? '' : 's'}`
                  : 'Add Products'}
              </>
            )}
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

interface PickupListRowProps {
  line: CartLine;
  active: boolean;
  onSelect: () => void;
}

function PickupListRow({ line, active, onSelect }: PickupListRowProps) {
  const isMissing = line.partsStatus === 'MISSING_PARTS';

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
          : 'border-gray-200 bg-white hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center gap-2">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white">
          {line.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={line.image_url} alt="" className="h-full w-full object-contain" />
          ) : (
            <Package className="h-5 w-5 text-gray-200" />
          )}
        </div>
        <p className="min-w-0 flex-1 truncate text-caption font-bold leading-snug text-gray-900">
          {line.product_title}
        </p>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-eyebrow">
        <span className="font-black text-emerald-700">
          {line.total ? `$${line.total}` : '$0'}
        </span>
        <span className="font-black text-gray-500">x{line.quantity}</span>
        <span className="font-black text-gray-500">
          {conditionLabel(line.conditionGrade)}
        </span>
        <span
          className={`ml-auto font-black ${
            isMissing ? 'text-amber-500' : 'text-emerald-600'
          }`}
        >
          {isMissing ? 'Missing' : 'Complete'}
        </span>
      </div>
    </motion.button>
  );
}
