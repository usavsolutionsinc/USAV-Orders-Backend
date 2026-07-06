import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { motionBezier } from '@/design-system/foundations/motion-framer';
import { Check, Loader2, Package, Plus, Search, X } from '@/components/Icons';
import { FbaSelectedLineRow } from '@/components/fba/sidebar/FbaSelectedLineRow';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';
import type { FnskuSearchResult } from '@/components/fba/hooks/useFnskuSearch';
import type { StationTheme } from '@/utils/staff-colors';
import type { ShipmentCardItem } from '@/lib/fba/types';

/**
 * FNSKU search popup — portaled to body so it escapes any transformed ancestor.
 * Searches the shipment catalog and adds a matching FNSKU as a 1-qty plan line.
 */
export function FnskuSearchModal({
  open,
  onClose,
  query,
  onQueryChange,
  searchInputRef,
  searching,
  results,
  items,
  addingFnsku,
  stationTheme,
  onAddFnsku,
}: {
  open: boolean;
  onClose: () => void;
  query: string;
  onQueryChange: (value: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement>;
  searching: boolean;
  results: FnskuSearchResult[];
  items: ShipmentCardItem[];
  addingFnsku: string | null;
  stationTheme: StationTheme;
  onAddFnsku: (result: FnskuSearchResult) => void;
}) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-modal flex items-stretch justify-center p-4 sm:p-6 md:p-10"
        >
          {/* ds-raw-button */}
          <button
            type="button"
            className="absolute inset-0 bg-scrim/50"
            aria-label="Close FNSKU search"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ duration: 0.18, ease: motionBezier.easeOut }}
            className="relative z-modal flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border-soft bg-surface-card shadow-2xl shadow-zinc-900/20"
          >
            {/* Header: search input */}
            <div className="border-b border-border-soft px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <p className="text-micro font-black uppercase tracking-[0.16em] text-purple-600">Add FNSKU</p>
                  <h2 className="mt-0.5 text-sm font-black text-text-default">Search shipment catalog</h2>
                </div>
                <IconButton
                  type="button"
                  onClick={onClose}
                  className="rounded-full border border-border-soft bg-surface-card p-2 text-text-soft hover:border-border-default hover:bg-surface-hover hover:text-text-default"
                  ariaLabel="Close"
                  icon={<X className="h-4 w-4" />}
                />
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={query}
                  onChange={(e) => onQueryChange(e.target.value)}
                  placeholder="Search FNSKU, ASIN, SKU, or product title..."
                  className="w-full rounded-xl border border-border-soft bg-surface-card py-2.5 pl-10 pr-3 text-sm font-semibold text-text-default outline-none transition-all placeholder:text-text-faint focus:border-purple-400 focus:ring-2 focus:ring-purple-400/30"
                />
              </div>
            </div>

            {/* Body: search results */}
            <div className="flex-1 overflow-y-auto px-3 py-3">
              {query.trim().length < 2 ? (
                <div className="py-16 text-center">
                  <Search className="mx-auto h-6 w-6 text-text-faint" />
                  <p className="mt-2 text-xs font-semibold text-text-faint">
                    Type at least 2 characters to search
                  </p>
                </div>
              ) : searching ? (
                <div className="flex items-center justify-center gap-2 py-16">
                  <Loader2 className="h-4 w-4 animate-spin text-text-faint" />
                  <p className="text-xs font-semibold text-text-soft">Searching...</p>
                </div>
              ) : results.length === 0 ? (
                <div className="py-16 text-center">
                  <p className="text-xs font-semibold text-text-faint">No matching FNSKUs found</p>
                  <p className="mt-1 text-micro text-text-faint">Try a different search term</p>
                </div>
              ) : (
                <div className="divide-y divide-border-hairline overflow-hidden rounded-lg border border-border-soft">
                  {results.map((result) => {
                    const alreadyAdded = items.some(
                      (i) => i.fnsku.toUpperCase() === result.fnsku.toUpperCase(),
                    );
                    const isAdding = addingFnsku === result.fnsku;
                    return (
                      <FbaSelectedLineRow
                        key={result.fnsku}
                        displayTitle={result.product_title || result.fnsku}
                        fnsku={result.fnsku.toUpperCase()}
                        stationTheme={stationTheme}
                        leadingSlot={
                          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-purple-50">
                            <Package className="h-3 w-3 text-purple-500" />
                          </div>
                        }
                        rightSlot={
                          <HoverTooltip label={alreadyAdded ? 'Already in shipment' : 'Add to shipment'} asChild>
                            <IconButton
                              type="button"
                              disabled={alreadyAdded || isAdding}
                              onClick={() => void onAddFnsku(result)}
                              className={[
                                'flex h-7 w-7 items-center justify-center rounded-lg border',
                                alreadyAdded
                                  ? 'cursor-default border-emerald-200 bg-emerald-50 text-emerald-600'
                                  : isAdding
                                    ? 'cursor-wait border-purple-200 bg-purple-50 text-purple-500'
                                    : 'border-purple-200 bg-surface-card text-purple-600 hover:border-purple-400 hover:bg-purple-50',
                              ].join(' ')}
                              ariaLabel={alreadyAdded ? 'Already in shipment' : `Add ${result.fnsku} to shipment`}
                              icon={
                                isAdding ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : alreadyAdded ? (
                                  <Check className="h-3.5 w-3.5" />
                                ) : (
                                  <Plus className="h-3.5 w-3.5" />
                                )
                              }
                            />
                          </HoverTooltip>
                        }
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
