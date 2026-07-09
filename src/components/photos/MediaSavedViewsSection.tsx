'use client';

import { useState } from 'react';
import { Check, Loader2, Plus, Trash2 } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import {
  useMediaLibrarySavedViews,
  readMediaViewPayload,
  type MediaViewPayload,
} from '@/hooks/useMediaLibrarySavedViews';
import type {
  PhotoLibraryFilterState,
  PhotoLibraryViewMode,
} from '@/lib/photos/library-filter-state';

interface MediaSavedViewsSectionProps {
  currentFilters: PhotoLibraryFilterState;
  currentView: PhotoLibraryViewMode;
  /** Whether the current state is worth saving (has filters or a non-default view). */
  savable: boolean;
  /** Org-wide sharing needs `photos.manage`. */
  canManage: boolean;
  onApply: (payload: MediaViewPayload) => void;
}

/**
 * "Saved views" — persistent filter/view presets for the media library. Personal
 * by default; managers can share org-wide. Applying rewrites the URL params (the
 * SoT); this section only lists + saves the named snapshots.
 */
export function MediaSavedViewsSection({
  currentFilters,
  currentView,
  savable,
  canManage,
  onApply,
}: MediaSavedViewsSectionProps) {
  const { views, isLoading, create, creating, remove } = useMediaLibrarySavedViews();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [shareWithOrg, setShareWithOrg] = useState(false);

  // Nothing to show and nothing to save — stay out of the way.
  if (!isLoading && views.length === 0 && !savable) return null;

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const payload: MediaViewPayload = {
      schemaVersion: 1,
      filters: currentFilters,
      view: currentView,
    };
    create(
      { name: trimmed, filters: payload, isShared: canManage && shareWithOrg },
      {
        onSuccess: () => {
          setName('');
          setShareWithOrg(false);
          setSaving(false);
        },
      },
    );
  };

  return (
    <div className="mb-3 space-y-1 px-1">
      <div className="flex items-center justify-between">
        <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft">Saved views</p>
        {savable && !saving ? (
          <HoverTooltip label="Save current filters as a view" focusable={false}>
            {/* ds-raw-button */}
            <button
              type="button"
              onClick={() => setSaving(true)}
              className="-my-0.5 flex items-center gap-1 rounded px-1 py-0.5 text-mini font-black uppercase tracking-widest text-blue-600 hover:bg-blue-50"
            >
              <Plus className="h-3.5 w-3.5" /> Save
            </button>
          </HoverTooltip>
        ) : null}
      </div>

      {saving ? (
        <div className="space-y-1.5 rounded-lg border border-border-soft bg-surface-canvas p-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') setSaving(false);
            }}
            placeholder="View name…"
            className="w-full rounded border border-border-soft bg-surface-card px-2 py-1 text-caption text-text-default outline-none focus:border-blue-400"
          />
          {canManage ? (
            <label className="flex items-center gap-1.5 text-mini font-semibold uppercase tracking-widest text-text-soft">
              <input
                type="checkbox"
                checked={shareWithOrg}
                onChange={(e) => setShareWithOrg(e.target.checked)}
                className="h-3 w-3 accent-blue-600"
              />
              Share with org
            </label>
          ) : null}
          <div className="flex items-center gap-1.5">
            {/* ds-raw-button */}
            <button
              type="button"
              onClick={submit}
              disabled={!name.trim() || creating}
              className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-mini font-black uppercase tracking-widest text-white disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Save
            </button>
            {/* ds-raw-button */}
            <button
              type="button"
              onClick={() => setSaving(false)}
              className="rounded px-2 py-1 text-mini font-black uppercase tracking-widest text-text-faint hover:text-text-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <p className="flex items-center gap-1.5 py-1 text-caption text-text-faint">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </p>
      ) : (
        <ul className="divide-y divide-border-hairline">
          {views.map((view) => (
            <li key={view.id} className="group flex items-center gap-2 py-1.5">
              {/* ds-raw-button */}
              <button
                type="button"
                onClick={() => onApply(readMediaViewPayload(view))}
                className="min-w-0 flex-1 truncate text-left text-caption font-bold text-text-default hover:text-blue-700"
                title={view.name}
              >
                {view.name}
              </button>
              {view.is_shared ? (
                <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-mini font-black uppercase tracking-widest text-emerald-700 ring-1 ring-inset ring-emerald-200">
                  Shared
                </span>
              ) : null}
              <HoverTooltip label="Delete view" focusable={false}>
                {/* ds-raw-button */}
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Delete saved view "${view.name}"?`)) remove(view.id);
                  }}
                  aria-label={`Delete ${view.name}`}
                  className="shrink-0 rounded p-1 text-text-faint opacity-0 transition group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </HoverTooltip>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
