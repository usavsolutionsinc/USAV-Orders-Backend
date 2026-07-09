import { AlertTriangle, ChevronDown, Loader2, Plus } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button } from '@/design-system/primitives/Button';
import { IconButton } from '@/design-system/primitives/IconButton';
import { fieldLabel } from '@/design-system/tokens/typography/presets';
import { FavoriteForm } from './FavoriteForm';
import type { FavoritesWorkspaceController } from './useFavoritesWorkspace';

/** Quick-pick variant — tile grid; tap a card to use, no inline edit. */
export function FavoritesQuickPickView({ f }: { f: FavoritesWorkspaceController }) {
  const { title, emptyLabel, useLabel, onUseFavorite } = f.props;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-caption font-black uppercase tracking-[0.16em] text-text-default">
          {title}
          {!f.isLoading && f.favorites.length > 0 && <span className="ml-1.5 tabular-nums text-text-faint">{f.favorites.length}</span>}
        </h3>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <HoverTooltip label="Add favorite" asChild>
            <IconButton
              onClick={() => {
                f.resetDraft();
                f.setShowForm(true);
                f.setEditingFavoriteId(null);
                f.setIsListOpen(true);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-soft bg-surface-card text-text-muted hover:border-border-strong hover:text-text-default"
              ariaLabel="Add favorite"
              icon={<Plus className="h-3.5 w-3.5" />}
            />
          </HoverTooltip>
          <HoverTooltip label={f.isListOpen ? 'Collapse' : 'Expand'} asChild>
            <IconButton
              onClick={() => f.setIsListOpen((prev) => !prev)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-soft bg-surface-card text-text-muted hover:border-border-strong hover:text-text-default"
              ariaLabel={f.isListOpen ? 'Collapse favorites' : 'Expand favorites'}
              aria-expanded={f.isListOpen}
              icon={<ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${f.isListOpen ? 'rotate-180' : ''}`} />}
            />
          </HoverTooltip>
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
            <div className="flex items-center justify-center rounded-xl border border-border-soft px-3 py-10 text-text-faint">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : f.favorites.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-soft px-4 py-8 text-center">
              <p className="text-micro font-black uppercase tracking-[0.14em] text-text-faint">{emptyLabel}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 p-0.5 sm:grid-cols-2">
              {f.favorites.map((favorite) => {
                const priceLabel = favorite.defaultPrice ? `$${favorite.defaultPrice}` : null;
                return (
                  <div key={`${favorite.workspaceKey}-${favorite.id}`} className="flex min-h-[132px] flex-col overflow-hidden rounded-xl border-2 border-border-soft bg-surface-card">
                    <div className="flex flex-1 flex-col p-4 pb-3">
                      <p className="text-sm font-bold leading-snug tracking-tight text-text-default">{favorite.label}</p>
                      <div className="mt-2 flex min-w-0 items-baseline gap-2">
                        {priceLabel && <span className="shrink-0 text-sm font-black tabular-nums text-emerald-600">{priceLabel}</span>}
                        {favorite.sku && <span className="min-w-0 truncate text-micro font-bold uppercase tracking-[0.12em] text-text-faint">{favorite.sku}</span>}
                      </div>
                      {favorite.issueTemplate ? <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-text-soft">{favorite.issueTemplate}</p> : null}
                    </div>
                    <div className="border-t border-border-hairline p-2">
                      <Button
                        variant="secondary"
                        size="md"
                        onClick={() => onUseFavorite(favorite)}
                        className="w-full text-micro font-black uppercase tracking-[0.14em] text-text-default"
                      >
                        {useLabel}
                      </Button>
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
