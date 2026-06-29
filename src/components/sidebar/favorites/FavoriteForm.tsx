import { Check, Loader2, Trash2 } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { tableHeader } from '@/design-system/tokens/typography/presets';
import { matchesSkuSuffix } from './favorites-search';
import type { FavoritesWorkspaceController } from './useFavoritesWorkspace';

/** Shared create/edit form: Ecwid product search + selection + label/notes. */
export function FavoriteForm({ f }: { f: FavoritesWorkspaceController }) {
  const { allowRepairDefaults = false, searchSkuSuffixFilter, searchResultsMaxHeightClass = 'max-h-44' } = f.props;
  const { draft, setDraft, selectedProduct, setSelectedProduct, searchValue, setSearchValue, searchingProducts, searchResults, editingFavoriteId, isSaving } = f;

  return (
    <div className="space-y-2 border-y border-gray-200 py-3">
      {/* Ecwid product search */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <input
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          placeholder="Search Ecwid product by name or SKU"
          className="w-full rounded-xl border-0 bg-transparent px-3 py-2.5 text-caption font-semibold text-gray-900 outline-none placeholder:text-gray-500"
        />
        {searchingProducts ? (
          <div className="flex items-center gap-2 border-t border-gray-100 px-3 py-2.5 text-gray-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <p className={tableHeader}>Searching…</p>
          </div>
        ) : searchResults.length > 0 ? (
          <div className={`${searchResultsMaxHeightClass} divide-y divide-gray-100 overflow-y-auto border-t border-gray-100`}>
            {searchResults.map((product) => {
              const isSelected = selectedProduct?.id === product.id;
              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => {
                    setSelectedProduct(product);
                    if (!draft.label.trim()) setDraft((prev) => ({ ...prev, label: product.name }));
                  }}
                  /* ds-raw-button: multi-line text-left product result row (name + price + sku, selection bg) — not a Button shape */
                  className={`ds-raw-button flex w-full items-start gap-2 px-3 py-2 text-left transition-colors ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                >
                  {isSelected && <Check className="mt-0.5 h-3 w-3 shrink-0 text-blue-600" />}
                  <div className="min-w-0 flex-1">
                    <p className={`text-caption font-black leading-snug tracking-tight ${isSelected ? 'text-blue-700' : 'text-gray-900'}`}>
                      {product.name}
                    </p>
                    <div className="mt-0.5 flex w-full min-w-0 items-center justify-start gap-2">
                      <span className="shrink-0 text-micro font-bold tabular-nums text-emerald-600">
                        {product.price != null ? `$${product.price.toFixed(2)}` : ''}
                      </span>
                      <span className={`min-w-0 truncate text-micro font-bold uppercase tracking-[0.14em] ${isSelected ? 'text-blue-500' : 'text-gray-500'}`}>
                        {product.sku || 'No SKU'}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : searchValue.trim() ? (
          <div className={`border-t border-gray-100 px-3 py-2.5 ${tableHeader}`}>
            {searchSkuSuffixFilter ? `No ${searchSkuSuffixFilter.toUpperCase()} SKUs found` : 'No products found'}
          </div>
        ) : null}
      </div>

      {/* Selected product — two rows */}
      {selectedProduct && (
        <div className="rounded-xl border border-blue-200 bg-white px-3 py-2">
          <p className="text-caption font-black leading-snug text-blue-900">{selectedProduct.name}</p>
          <div className="mt-0.5 flex w-full min-w-0 items-center justify-start gap-2">
            <span className="shrink-0 text-micro font-bold tabular-nums text-emerald-600">
              {selectedProduct.price != null ? `$${selectedProduct.price.toFixed(2)}` : ''}
            </span>
            <span className="min-w-0 truncate text-micro font-bold uppercase tracking-[0.14em] text-blue-500">
              {selectedProduct.sku || 'No SKU'}
            </span>
          </div>
        </div>
      )}

      <input
        value={draft.label}
        onChange={(e) => setDraft((prev) => ({ ...prev, label: e.target.value }))}
        placeholder="Label"
        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-caption font-semibold text-gray-900 outline-none focus:border-blue-300"
      />

      {allowRepairDefaults && (
        <input
          value={draft.issueTemplate}
          onChange={(e) => setDraft((prev) => ({ ...prev, issueTemplate: e.target.value }))}
          placeholder="Issue template"
          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-caption font-semibold text-gray-900 outline-none focus:border-blue-300"
        />
      )}

      <textarea
        value={draft.notes}
        onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))}
        placeholder="Notes"
        rows={2}
        className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-caption font-semibold text-gray-900 outline-none focus:border-blue-300"
      />

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <Button variant="secondary" size="md" onClick={f.resetDraft}>
          Cancel
        </Button>
        <div className="flex items-center gap-2">
          {editingFavoriteId !== null && (
            <HoverTooltip label="Delete favorite" asChild>
              <IconButton
                icon={<Trash2 className="h-3.5 w-3.5 text-red-400 hover:text-red-600" />}
                ariaLabel="Delete favorite"
                onClick={() => void f.handleDelete(editingFavoriteId)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-red-100 bg-red-50 hover:border-red-300 hover:bg-red-100"
              />
            </HoverTooltip>
          )}
          <Button
            variant="primary"
            size="md"
            icon={<Check className="h-4 w-4" />}
            onClick={f.handleSave}
            disabled={
              isSaving
              || !selectedProduct
              || !selectedProduct.sku.trim()
              || !draft.label.trim()
              || (searchSkuSuffixFilter ? !matchesSkuSuffix(selectedProduct.sku, searchSkuSuffixFilter) : false)
            }
          >
            {isSaving ? 'Saving…' : editingFavoriteId !== null ? 'Update' : 'Save Favorite'}
          </Button>
        </div>
      </div>
    </div>
  );
}
