'use client';

/**
 * Local-pickup main-pane editor.
 *
 * Anchored on the receiving workspace shell (`ReceivingLineWorkspace`): a
 * sticky {@link PaneHeader} (Pickup chip + product identity + prev/next + the
 * [+ Add item] CTA) over a scrollable single-column body that edits the
 * currently-selected staged line. Selection + cart live in the shared
 * {@link localPickupStore}; the slim sidebar list (`LocalPickupSidebarList`)
 * drives `selectedKey`, this pane edits whatever it points at.
 *
 * Replaces the old `LocalPickupCatalogPanel` browse grid — adding is now a
 * search popover, and the big pane is the editor (mirroring how receiving
 * focuses a single line in the main pane).
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ChevronDown,
  ChevronUp,
  Package,
  Plus,
  ShoppingCart,
  X,
} from '@/components/Icons';
import {
  PaneHeader,
  PaneHeaderIconBadge,
  PaneHeaderLabel,
} from '@/components/ui/pane-header';
import { receivingIdentityBandClass } from '@/components/layout/header-shell';
import { ConditionPills } from '@/components/receiving/workspace/ConditionPills';
import {
  EcwidProductSearchPopover,
  type EcwidProductSelection,
} from '@/components/receiving/unfound/EcwidProductSearchPopover';
import {
  addLine,
  getSelectedLine,
  patchLine,
  removeLine,
  selectLine,
  useLocalPickupCart,
  type CartLine,
  type ConditionGrade,
} from './localPickupStore';

export function LocalPickupEditPanel() {
  const cartState = useLocalPickupCart();
  const { cart, selectedKey } = cartState;
  const selected = getSelectedLine(cartState);
  const [addOpen, setAddOpen] = useState(false);

  // Keep a selection alive whenever there are staged items (e.g. after
  // navigating away and back, or after the sidebar cleared it).
  useEffect(() => {
    if (cart.length > 0 && !selectedKey) {
      selectLine(cart[0].key);
    }
  }, [cart, selectedKey]);

  // Reuse the unfound carton's product lookup (Ecwid catalog search + the
  // "Product not added yet?" manual-title path) so pickup can stage items that
  // aren't in the system yet. The selection maps straight onto a cart line;
  // pickup persists on submit, so we ignore the receiving-line identifiers.
  const handleAddSelection = (sel: EcwidProductSelection) => {
    addLine({
      sku: sel.sku,
      product_title: sel.item_name,
      image_url: sel.image_url,
      category: null,
    });
    setAddOpen(false);
  };

  const index = selected ? cart.findIndex((l) => l.key === selected.key) : -1;
  const canPrev = index > 0;
  const canNext = index >= 0 && index < cart.length - 1;
  const goPrev = () => {
    if (canPrev) selectLine(cart[index - 1].key);
  };
  const goNext = () => {
    if (canNext) selectLine(cart[index + 1].key);
  };

  return (
    <div className="flex h-full w-full flex-col bg-gray-50">
      <PaneHeader
        className={`z-20 border-b-0 bg-white backdrop-blur-none ${receivingIdentityBandClass}`}
        rowClassName="w-full px-3"
        leftSlot={
          <>
            <PaneHeaderIconBadge
              Icon={ShoppingCart}
              bg="bg-purple-50"
              tint="text-purple-600"
            />
            <PaneHeaderLabel
              eyebrow={
                <>
                  Pickup
                  {selected && cart.length > 1 ? (
                    <span className="ml-1 text-gray-500">
                      · Item {index + 1} of {cart.length}
                    </span>
                  ) : null}
                </>
              }
              value={selected ? selected.product_title : 'New intake'}
              valueTitle={selected?.product_title}
            />
          </>
        }
        rightSlot={
          <>
            {cart.length > 1 ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={!canPrev}
                  aria-label="Previous item"
                  title="Previous item"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={!canNext}
                  aria-label="Next item"
                  title="Next item"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-caption font-bold uppercase tracking-wider text-white transition-colors hover:bg-emerald-700"
            >
              <Plus className="h-3.5 w-3.5" />
              Add item
            </button>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {selected ? (
          <div className="mx-auto w-full max-w-3xl px-4 py-5 pb-24 sm:px-6">
            <LocalPickupLineEditor key={selected.key} line={selected} />
          </div>
        ) : (
          <PickupEmptyState onAdd={() => setAddOpen(true)} />
        )}
      </div>

      {addOpen ? (
        <EcwidProductSearchPopover
          receivingId={0}
          popoverMode="search"
          onSelect={handleAddSelection}
          onClose={() => setAddOpen(false)}
        />
      ) : null}
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────

function PickupEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50">
          <ShoppingCart className="h-8 w-8 text-emerald-300" />
        </div>
        <p className="text-label font-black uppercase tracking-tight text-gray-700">
          No items yet
        </p>
        <p className="mt-1 text-micro text-gray-400">
          Add products to start a local pickup intake. Each item lands in the
          sidebar and opens here for editing.
        </p>
        <button
          type="button"
          onClick={onAdd}
          className="mx-auto mt-4 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-caption font-bold uppercase tracking-wider text-white transition-colors hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          Add item
        </button>
      </div>
    </div>
  );
}

// ── Line editor body — the modern, full-width version of the old inline card ──

function LocalPickupLineEditor({ line }: { line: CartLine }) {
  const isMissing = line.partsStatus === 'MISSING_PARTS';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5"
    >
      {/* Image + remove */}
      <div
        className="relative flex w-full items-center justify-center overflow-hidden rounded-xl bg-gray-50"
        style={{ height: 280 }}
      >
        {line.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={line.image_url} alt="" className="h-full w-full object-contain" />
        ) : (
          <Package className="h-14 w-14 text-gray-200" />
        )}
        <button
          type="button"
          onClick={() => removeLine(line.key)}
          aria-label="Remove item"
          title="Remove item"
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/90 text-gray-400 shadow-sm transition-colors hover:bg-rose-50 hover:text-rose-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Title + SKU */}
      <div>
        <h2 className="text-base font-black leading-snug text-gray-900">
          {line.product_title}
        </h2>
        <p className="mt-1 font-mono text-micro font-black uppercase text-emerald-600">
          Ecwid: {line.sku}
        </p>
      </div>

      {/* Condition Received */}
      <div>
        <label className="mb-1 block text-eyebrow font-black uppercase tracking-wider text-gray-500">
          Condition Received
        </label>
        <ConditionPills
          value={line.conditionGrade}
          onChange={(next) =>
            patchLine(line.key, { conditionGrade: next as ConditionGrade })
          }
        />
      </div>

      {/* Parts status */}
      <div>
        <label className="mb-1 block text-eyebrow font-black uppercase tracking-wider text-gray-500">
          Parts
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => patchLine(line.key, { partsStatus: 'COMPLETE' })}
            className={`h-9 rounded-lg text-caption font-black uppercase tracking-wider transition-colors ${
              !isMissing
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            Complete
          </button>
          <button
            type="button"
            onClick={() => patchLine(line.key, { partsStatus: 'MISSING_PARTS' })}
            className={`h-9 rounded-lg text-caption font-black uppercase tracking-wider transition-colors ${
              isMissing
                ? 'bg-amber-500 text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            Missing Parts
          </button>
        </div>
        {isMissing ? (
          <textarea
            value={line.missingPartsNote}
            onChange={(e) => patchLine(line.key, { missingPartsNote: e.target.value })}
            placeholder="List missing parts…"
            className="mt-2 min-h-[56px] w-full rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2 text-caption text-gray-900 placeholder:text-gray-400 focus:border-amber-400 focus:outline-none"
          />
        ) : null}
      </div>

      {/* Condition note */}
      <div>
        <label className="mb-1 block text-eyebrow font-black uppercase tracking-wider text-gray-500">
          Condition note
        </label>
        <textarea
          value={line.conditionNote}
          onChange={(e) => patchLine(line.key, { conditionNote: e.target.value })}
          placeholder="What's wrong or notable about the unit…"
          className="min-h-[56px] w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-caption text-gray-900 placeholder:text-gray-400 focus:border-emerald-400 focus:outline-none"
        />
      </div>

      {/* Total Price + Qty */}
      <div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-4">
        <div>
          <label className="mb-1 block text-eyebrow font-black uppercase tracking-wider text-gray-500">
            Total Price
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-caption font-bold text-emerald-700">
              $
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step="1"
              value={line.total}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '' || Number(v) >= 0) patchLine(line.key, { total: v });
              }}
              placeholder="0.00"
              className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-6 pr-3 text-caption font-bold text-emerald-700 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-eyebrow font-black uppercase tracking-wider text-gray-500">
            Qty
          </label>
          <input
            type="number"
            min={1}
            defaultValue={line.quantity}
            key={`${line.key}-qty-${line.quantity}`}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (v >= 1) patchLine(line.key, { quantity: Math.floor(v) });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-center text-caption font-black text-gray-900 focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </div>
    </motion.div>
  );
}
