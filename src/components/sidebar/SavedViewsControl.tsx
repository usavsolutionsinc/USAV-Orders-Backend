'use client';

import { useCallback, useRef, useState } from 'react';
import { AnchoredLayer } from '@/design-system';
import { Button, IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Star, Trash2, Check, Plus } from '@/components/Icons';
import { useSavedViews } from '@/hooks/useSavedViews';

/**
 * Saved filter views — name and recall a combination of sidebar filters (stage,
 * sort, status-dot chip, type) so power users skip re-dialing the same set.
 *
 * Generic + mode-agnostic: the parent passes which `paramKeys` constitute a view
 * and a `storageKey`, so the SAME control serves Unshipped and Shipped. The
 * storage + URL-apply logic lives in {@link useSavedViews} (shared with the table
 * ⋮ menu); this component is only the quiet ghost-trigger UI.
 *
 * Visually quiet by design (per the project's flat, utilitarian system): a small
 * ghost trigger that opens a compact list — no loud chrome.
 */
export function SavedViewsControl({
  storageKey,
  paramKeys,
  label = 'Views',
}: {
  storageKey: string;
  paramKeys: readonly string[];
  label?: string;
}) {
  const { views, activeView, hasActiveFilters, applyView, saveView, removeView } = useSavedViews({
    storageKey,
    paramKeys,
  });

  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const saveCurrent = useCallback(() => {
    if (!draftName.trim()) return;
    saveView(draftName);
    setDraftName('');
    setNaming(false);
  }, [draftName, saveView]);

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        onClick={() => setOpen((o) => !o)}
        icon={<Star className={`h-3.5 w-3.5 ${activeView ? 'text-amber-500' : 'text-text-faint'}`} />}
        className={`text-caption font-bold uppercase tracking-wide ${
          activeView ? 'text-text-default' : 'text-text-soft hover:text-text-default'
        }`}
        aria-expanded={open}
      >
        <span className="truncate max-w-[120px]">{activeView ? activeView.name : label}</span>
        {views.length > 0 ? <span className="tabular-nums text-text-faint">{views.length}</span> : null}
      </Button>

      <AnchoredLayer open={open} onClose={() => setOpen(false)} anchorRef={triggerRef} placement="bottom-start" gap={6}>
        <div className="w-60 rounded-xl border border-border-soft bg-surface-card py-1.5 shadow-lg">
          {views.length === 0 ? (
            <p className="px-3 py-2 text-xs italic text-text-faint">No saved views yet.</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto py-0.5">
              {views.map((view) => {
                const isActive = view.id === activeView?.id;
                return (
                  <li key={view.id} className="group flex items-center">
                    <button
                      type="button"
                      onClick={() => {
                        applyView(view);
                        setOpen(false);
                      }}
                      className={`ds-raw-button flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-surface-hover ${
                        isActive ? 'font-semibold text-text-default' : 'text-text-muted'
                      }`}
                    >
                      <Check className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'text-blue-600' : 'text-transparent'}`} />
                      <span className="truncate">{view.name}</span>
                    </button>
                    <IconButton
                      icon={<Trash2 className="h-3.5 w-3.5" />}
                      ariaLabel={`Delete view ${view.name}`}
                      onClick={() => removeView(view.id)}
                      className="mr-1.5 shrink-0 rounded p-1 text-text-faint opacity-0 transition-all hover:text-rose-500 group-hover:opacity-100"
                    />
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-1 border-t border-border-hairline pt-1.5">
            {naming ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  saveCurrent();
                }}
                className="flex items-center gap-1.5 px-2"
              >
                <input
                  ref={nameInputRef}
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="Name this view…"
                  className="min-w-0 flex-1 rounded-md border border-border-soft px-2 py-1 text-sm outline-none focus:border-blue-400"
                />
                <Button
                  type="submit"
                  variant="brand"
                  size="sm"
                  disabled={!draftName.trim()}
                  className="shrink-0"
                >
                  Save
                </Button>
              </form>
            ) : (
              <HoverTooltip
                label={
                  !hasActiveFilters
                    ? 'Set a filter first'
                    : activeView
                      ? 'These filters are already saved'
                      : 'Save the current filters as a view'
                }
                asChild
              >
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setNaming(true)}
                disabled={!hasActiveFilters || Boolean(activeView)}
                icon={<Plus className="h-3.5 w-3.5 shrink-0" />}
                className="w-full justify-start text-sm font-medium text-text-muted hover:bg-surface-hover"
              >
                Save current view
              </Button>
              </HoverTooltip>
            )}
          </div>
        </div>
      </AnchoredLayer>
    </>
  );
}
