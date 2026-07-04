import { AnimatePresence, motion } from 'framer-motion';
import { motionBezier } from '@/design-system/foundations/motion-framer';
import { AlertTriangle, Check, ChevronRight, Loader2, Pencil, Plus, Trash2, X } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';
import { sectionLabel, fieldLabel } from '@/design-system/tokens/typography/presets';
import { FavoriteForm } from './FavoriteForm';
import type { FavoritesWorkspaceController } from './useFavoritesWorkspace';

/** Default variant — collapsible header + rows with inline edit/delete/use. */
export function FavoritesDefaultView({ f }: { f: FavoritesWorkspaceController }) {
  const { title, description, emptyLabel, useLabel, onUseFavorite, hideHeading = false, inlineRows = false, addButtonAccent = 'orange', onAddFavorite, isFavoriteAdded } = f.props;

  return (
    <section className={inlineRows ? 'space-y-2' : 'space-y-3 rounded-[1.75rem] border border-border-soft bg-surface-card p-4'}>
      {/* Header — click title area to collapse/expand list */}
      <div className="flex items-center justify-between gap-3">
        {hideHeading ? (
          <div />
        ) : (
          // ds-raw-button: multi-line text-left collapse header (animated chevron + title + description) — not a Button shape
          <button type="button" onClick={() => f.setIsListOpen((prev) => !prev)} className="group flex min-w-0 flex-1 items-center gap-1.5 text-left" aria-expanded={f.isListOpen}>
            <motion.span
              animate={{ rotate: f.isListOpen ? 90 : 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              className="shrink-0 text-text-soft group-hover:text-text-muted"
            >
              <ChevronRight className={inlineRows ? 'h-3 w-3' : 'h-4 w-4'} />
            </motion.span>
            <div className="min-w-0">
              <h3 className={`${inlineRows ? 'text-base' : 'text-sm'} font-black tracking-tight text-text-default`}>
                {title}
                {f.favorites.length > 0 && <span className="ml-1.5 text-micro font-semibold tabular-nums text-text-soft">{f.favorites.length}</span>}
              </h3>
              {description && f.isListOpen ? <p className="mt-0.5 text-caption font-semibold leading-relaxed text-text-soft">{description}</p> : null}
            </div>
          </button>
        )}
        <div className="flex shrink-0 items-center gap-1.5">
          <HoverTooltip label={f.isManageMode ? 'Done managing' : 'Manage favorites'} asChild>
            <IconButton
              onClick={() => f.setIsManageMode((prev) => !prev)}
              className={`inline-flex ${inlineRows ? 'h-7 w-7 rounded-lg' : 'h-10 w-10 rounded-2xl'} items-center justify-center border transition-colors ${
                f.isManageMode ? 'border-border-default bg-surface-sunken text-text-muted hover:bg-surface-strong' : 'border-border-soft bg-surface-card text-text-soft hover:bg-surface-hover hover:text-text-muted'
              }`}
              ariaLabel={f.isManageMode ? 'Done managing' : 'Manage favorites'}
              icon={f.isManageMode ? <X className={inlineRows ? 'h-3 w-3' : 'h-4 w-4'} /> : <Pencil className={inlineRows ? 'h-3 w-3' : 'h-4 w-4'} />}
            />
          </HoverTooltip>
          <HoverTooltip label="Add favorite" asChild>
            <IconButton
              onClick={() => {
                f.resetDraft();
                f.setShowForm((prev) => (f.editingFavoriteId === null ? !prev : true));
                f.setIsListOpen(true);
              }}
              className={`inline-flex ${inlineRows ? 'h-7 w-7 rounded-lg' : 'h-10 w-10 rounded-2xl'} items-center justify-center bg-blue-600 text-white transition-colors hover:bg-blue-700`}
              ariaLabel="Add favorite"
              icon={<Plus className={`${inlineRows ? 'h-3 w-3' : 'h-4 w-4'} text-white`} />}
            />
          </HoverTooltip>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {f.isListOpen && (
          <motion.div
            key="list-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: motionBezier.easeOut }}
            className="overflow-hidden"
          >
            <div className={inlineRows ? 'space-y-0' : 'space-y-3 pt-1'}>
              {f.showForm && f.editingFavoriteId === null && <FavoriteForm f={f} />}

              {f.error && (
                <div className="flex items-start gap-2 rounded-2xl border border-red-100 bg-red-50 px-3 py-2 text-red-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p className={fieldLabel}>{f.error}</p>
                </div>
              )}

              {f.isLoading ? (
                <div className="flex items-center justify-center rounded-2xl border border-dashed border-border-soft px-3 py-8 text-text-soft">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : f.favorites.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border-soft px-4 py-8 text-center">
                  <p className={sectionLabel}>{emptyLabel}</p>
                </div>
              ) : (
                <div className={inlineRows ? 'divide-y divide-border-soft border-t border-border-soft' : 'space-y-2'}>
                  {f.favorites.map((favorite) => {
                    const isAdded = isFavoriteAdded?.(favorite) ?? false;
                    const addButtonClassName = isAdded
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                      : addButtonAccent === 'green'
                        ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                        : 'bg-orange-500 text-white hover:bg-orange-600';
                    const addButtonSizeClass = inlineRows ? 'h-7 w-7 rounded-lg' : 'h-10 w-10 rounded-2xl';
                    const addIconSizeClass = inlineRows ? 'h-3 w-3' : 'h-4 w-4';
                    const subButtonSizeClass = inlineRows ? 'h-6 w-6 rounded-md' : 'h-10 w-10 rounded-2xl';
                    const subIconSizeClass = inlineRows ? 'h-2.5 w-2.5' : 'h-4 w-4';

                    return (
                      <div key={`${favorite.workspaceKey}-${favorite.id}`}>
                        <div className={inlineRows ? 'py-1.5' : 'rounded-2xl border border-border-soft bg-surface-canvas px-3 py-3'}>
                          <p className={`${inlineRows ? 'text-micro leading-tight' : 'text-label leading-snug'} font-black tracking-tight text-black`}>{favorite.label}</p>
                          <div className={`${inlineRows ? 'mt-0.5 gap-1' : 'mt-1 gap-2'} flex items-start`}>
                            <div className="min-w-0 flex-1">
                              <div className={`flex w-full min-w-0 items-center justify-start gap-2 font-bold ${inlineRows ? 'text-mini tracking-[0.12em]' : 'text-micro tracking-[0.16em]'}`}>
                                <span className="shrink-0 tabular-nums text-emerald-600">{favorite.defaultPrice ? `$${favorite.defaultPrice}` : ''}</span>
                                <span className="min-w-0 truncate uppercase text-text-soft">{favorite.sku || 'No SKU'}</span>
                              </div>
                              {favorite.issueTemplate ? (
                                <p className={`${inlineRows ? 'mt-0 text-mini' : 'mt-0.5 text-micro'} font-semibold uppercase tracking-[0.14em] text-text-soft`}>{favorite.issueTemplate}</p>
                              ) : null}
                              {!inlineRows && favorite.productTitle && <p className="mt-1 text-caption font-semibold text-text-soft">{favorite.productTitle}</p>}
                            </div>
                            <div className={`${inlineRows ? 'flex items-center gap-1 pt-0.5' : 'flex items-center gap-2'}`}>
                              <HoverTooltip label="Edit favorite" asChild>
                                <IconButton
                                  onClick={() => {
                                    if (f.editingFavoriteId === favorite.id && f.showForm) f.resetDraft();
                                    else f.openEditForm(favorite);
                                  }}
                                  className={`inline-flex ${subButtonSizeClass} shrink-0 items-center justify-center border transition-colors ${
                                    f.editingFavoriteId === favorite.id && f.showForm
                                      ? 'border-blue-200 bg-blue-50 text-blue-600'
                                      : 'border-border-soft bg-surface-card text-text-soft hover:border-border-default hover:bg-surface-hover hover:text-text-muted'
                                  }`}
                                  ariaLabel={`Edit ${favorite.label}`}
                                  icon={<Pencil className={`${subIconSizeClass} ${f.editingFavoriteId === favorite.id && f.showForm ? 'text-blue-600' : ''}`} />}
                                />
                              </HoverTooltip>

                              {f.isManageMode ? (
                                <HoverTooltip label="Delete favorite" asChild>
                                  <IconButton
                                    onClick={() => void f.handleDelete(favorite.id)}
                                    className={`inline-flex ${subButtonSizeClass} shrink-0 items-center justify-center border border-red-200 bg-red-50 transition-colors hover:bg-red-100 hover:text-red-700`}
                                    ariaLabel={`Delete ${favorite.label}`}
                                    icon={<Trash2 className={`${subIconSizeClass} text-red-500`} />}
                                  />
                                </HoverTooltip>
                              ) : (
                                <HoverTooltip label={useLabel} asChild>
                                  <IconButton
                                    onClick={() => {
                                      onUseFavorite(favorite);
                                      onAddFavorite?.(favorite);
                                    }}
                                    className={`inline-flex ${addButtonSizeClass} shrink-0 items-center justify-center transition-colors ${addButtonClassName}`}
                                    ariaLabel={useLabel}
                                    icon={isAdded ? <Check className={`${addIconSizeClass} text-white`} /> : <Plus className={`${addIconSizeClass} text-white`} />}
                                  />
                                </HoverTooltip>
                              )}
                            </div>
                          </div>
                        </div>

                        {f.showForm && f.editingFavoriteId === favorite.id && <FavoriteForm f={f} />}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
