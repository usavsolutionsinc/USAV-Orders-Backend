import { AlertTriangle, ChevronDown, Loader2, Plus } from '@/components/Icons';
import { fieldLabel } from '@/design-system/tokens/typography/presets';
import { FavoriteForm } from './FavoriteForm';
import type { FavoritesWorkspaceController } from './useFavoritesWorkspace';

/** Quick-pick variant — tile grid; tap a card to use, no inline edit. */
export function FavoritesQuickPickView({ f }: { f: FavoritesWorkspaceController }) {
  const { title, emptyLabel, useLabel, onUseFavorite } = f.props;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-black uppercase tracking-[0.16em] text-gray-900">
          {title}
          {!f.isLoading && f.favorites.length > 0 && <span className="ml-1.5 tabular-nums text-gray-400">{f.favorites.length}</span>}
        </h3>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              f.resetDraft();
              f.setShowForm(true);
              f.setEditingFavoriteId(null);
              f.setIsListOpen(true);
            }}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 transition-colors hover:border-gray-900 hover:text-gray-900"
            aria-label="Add favorite"
            title="Add favorite"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => f.setIsListOpen((prev) => !prev)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 transition-colors hover:border-gray-900 hover:text-gray-900"
            aria-label={f.isListOpen ? 'Collapse favorites' : 'Expand favorites'}
            aria-expanded={f.isListOpen}
            title={f.isListOpen ? 'Collapse' : 'Expand'}
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${f.isListOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {f.showForm && f.editingFavoriteId === null && <FavoriteForm f={f} />}

      {f.error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className={fieldLabel}>{f.error}</p>
        </div>
      )}

      {f.isListOpen && (
        <>
          {f.isLoading ? (
            <div className="flex items-center justify-center rounded-xl border border-gray-200 px-3 py-10 text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : f.favorites.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-gray-400">{emptyLabel}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 p-0.5 sm:grid-cols-2">
              {f.favorites.map((favorite) => {
                const priceLabel = favorite.defaultPrice ? `$${favorite.defaultPrice}` : null;
                return (
                  <div key={`${favorite.workspaceKey}-${favorite.id}`} className="flex min-h-[132px] flex-col overflow-hidden rounded-xl border-2 border-gray-200 bg-white">
                    <div className="flex flex-1 flex-col p-4 pb-3">
                      <p className="text-sm font-bold leading-snug tracking-tight text-gray-900">{favorite.label}</p>
                      <div className="mt-2 flex min-w-0 items-baseline gap-2">
                        {priceLabel && <span className="shrink-0 text-sm font-black tabular-nums text-emerald-600">{priceLabel}</span>}
                        {favorite.sku && <span className="min-w-0 truncate text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">{favorite.sku}</span>}
                      </div>
                      {favorite.issueTemplate ? <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-gray-500">{favorite.issueTemplate}</p> : null}
                    </div>
                    <div className="border-t border-gray-100 p-2">
                      <button
                        type="button"
                        onClick={() => onUseFavorite(favorite)}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.14em] text-gray-900 transition-colors hover:border-gray-900 hover:bg-gray-50"
                      >
                        {useLabel}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
