'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Image as ImageIcon, Loader2, Plus, Star, Trash2, X } from '@/components/Icons';
import { cn } from '@/utils/_cn';
import { Button, IconButton } from '@/design-system/primitives';
import { useListingGallery, type ListingGalleryTarget } from '@/hooks/useListingGallery';
import { PhotoThumb } from './PhotoThumb';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { toast } from '@/lib/toast';
import type { LibraryPhoto } from './photo-library-types';

/**
 * ListingPhotoGallery — the marketplace gallery composer (Workbench detail pane).
 * Drop it into a SKU or unit detail page. It owns the ordered set + cover for one
 * target via {@link useListingGallery}; the list is the stable map, edits persist
 * through the listing-gallery route. Reorder is up/down (accessible + testable);
 * "Add photos" opens a picker over the photos already linked to this SKU/unit.
 */
export function ListingPhotoGallery({
  target,
  candidateFilter,
  title = 'Listing photos',
}: {
  target: ListingGalleryTarget;
  /** Library filter used to fetch candidate photos to add (e.g. { sku } or { serial }). */
  candidateFilter?: { sku?: string; serial?: string; imageType?: string };
  title?: string;
}) {
  const { items, isLoading, addPhotos, reorder, setCover, removePhoto } = useListingGallery(target);
  const [pickerOpen, setPickerOpen] = useState(false);

  const orderedIds = useMemo(() => items.map((it) => it.photoId), [items]);

  const move = (index: number, dir: -1 | 1) => {
    const next = [...orderedIds];
    const swap = index + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[index], next[swap]] = [next[swap], next[index]];
    reorder.mutate(next, { onError: (e) => toast.error(e instanceof Error ? e.message : 'Reorder failed') });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft">{title}</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={<Plus className="h-3.5 w-3.5" />}
          onClick={() => setPickerOpen(true)}
          className="-my-1 text-blue-600 hover:bg-blue-50 hover:text-blue-600"
        >
          Add photos
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 px-3 py-4 text-caption text-text-faint">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading gallery…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-soft bg-surface-canvas px-4 py-6 text-center text-caption text-text-soft">
          No listing photos yet. Add photos to build the marketplace gallery.
        </div>
      ) : (
        <ul className="divide-y divide-border-hairline">
          {items.map((it, index) => (
            <li key={it.photoId} className="flex items-center gap-3 py-2">
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border-soft">
                <PhotoThumb src={it.thumbUrl} alt="" ratio="square" />
                {it.isCover ? (
                  <span className="absolute left-0 top-0 inline-flex items-center gap-0.5 rounded-br-lg bg-amber-500 px-1 py-0.5 text-mini font-black uppercase tracking-widest text-white">
                    <Star className="h-2.5 w-2.5" /> Cover
                  </span>
                ) : null}
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-caption font-semibold text-text-default">Photo #{it.photoId}</div>
                <div className="text-micro text-text-soft">Position {index + 1}</div>
              </div>

              <div className="flex items-center gap-0.5">
                <IconBtn label="Move up" disabled={index === 0} onClick={() => move(index, -1)}>
                  <ChevronUp className="h-4 w-4" />
                </IconBtn>
                <IconBtn label="Move down" disabled={index === items.length - 1} onClick={() => move(index, 1)}>
                  <ChevronDown className="h-4 w-4" />
                </IconBtn>
                <IconBtn
                  label="Set as cover"
                  active={it.isCover}
                  onClick={() =>
                    setCover.mutate(it.photoId, {
                      onError: (e) => toast.error(e instanceof Error ? e.message : 'Set cover failed'),
                    })
                  }
                >
                  <Star className={cn('h-4 w-4', it.isCover && 'fill-amber-400 text-amber-500')} />
                </IconBtn>
                <IconBtn
                  label="Remove"
                  danger
                  onClick={() =>
                    removePhoto.mutate(it.photoId, {
                      onError: (e) => toast.error(e instanceof Error ? e.message : 'Remove failed'),
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </IconBtn>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pickerOpen ? (
        <ListingPhotoPicker
          candidateFilter={candidateFilter}
          excludePhotoIds={new Set(orderedIds)}
          onClose={() => setPickerOpen(false)}
          onAdd={(ids) => {
            addPhotos.mutate(ids, {
              onSuccess: () => toast.success(`Added ${ids.length} photo${ids.length === 1 ? '' : 's'}`),
              onError: (e) => toast.error(e instanceof Error ? e.message : 'Add failed'),
            });
            setPickerOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  danger,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <HoverTooltip label={label} asChild>
      <IconButton
        type="button"
        onClick={onClick}
        disabled={disabled}
        ariaLabel={label}
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-lg transition disabled:opacity-30',
          danger ? 'text-text-faint hover:bg-rose-50 hover:text-rose-600' : 'text-text-faint hover:bg-surface-sunken hover:text-text-muted',
          active && 'text-amber-500',
        )}
        icon={children}
      />
    </HoverTooltip>
  );
}

/** Modal picker over the photos linked to this SKU/unit, minus ones already in the gallery. */
function ListingPhotoPicker({
  candidateFilter,
  excludePhotoIds,
  onAdd,
  onClose,
}: {
  candidateFilter?: { sku?: string; serial?: string; imageType?: string };
  excludePhotoIds: Set<number>;
  onAdd: (ids: number[]) => void;
  onClose: () => void;
}) {
  const [photos, setPhotos] = useState<LibraryPhoto[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Fetch candidates once on mount.
  useEffect(() => {
    const params = new URLSearchParams({ limit: '60' });
    if (candidateFilter?.sku) params.set('sku', candidateFilter.sku);
    if (candidateFilter?.serial) params.set('serial', candidateFilter.serial);
    if (candidateFilter?.imageType) params.set('photoType', candidateFilter.imageType);
    let cancelled = false;
    fetch(`/api/photos/library?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to load photos'))))
      .then((data: { photos: LibraryPhoto[] }) => {
        if (!cancelled) setPhotos((data.photos ?? []).filter((p) => !excludePhotoIds.has(p.id)));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load photos');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl bg-surface-card shadow-xl ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-hairline px-4 py-3">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-text-soft" />
            <h2 className="text-sm font-bold text-text-default">Add listing photos</h2>
          </div>
          <IconButton
            type="button"
            onClick={onClose}
            ariaLabel="Close"
            className="-mr-1 inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-faint hover:bg-surface-sunken hover:text-text-muted"
            icon={<X className="h-4 w-4" />}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error ? (
            <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-6 text-center text-caption text-rose-600">
              {error}
            </div>
          ) : photos === null ? (
            <div className="flex items-center gap-2 py-6 text-caption text-text-faint">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading photos…
            </div>
          ) : photos.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-soft bg-surface-canvas px-4 py-6 text-center text-caption text-text-soft">
              No more photos available to add.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {photos.map((p) => {
                const on = picked.has(p.id);
                return (
                  // ds-raw-button: selectable image/photo tile (not a label/icon button)
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggle(p.id)}
                    aria-pressed={on}
                    className={cn(
                      'relative overflow-hidden rounded-lg border-2 transition',
                      on ? 'border-blue-500 ring-2 ring-blue-200' : 'border-transparent hover:border-border-default',
                    )}
                  >
                    <PhotoThumb src={p.thumbUrl} alt="" ratio="square" />
                    {on ? (
                      <span className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white">
                        <Check className="h-3 w-3" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border-hairline px-4 py-3">
          <span className="text-caption text-text-soft">{picked.size} selected</span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              icon={<Plus className="h-3.5 w-3.5" />}
              disabled={picked.size === 0}
              onClick={() => onAdd([...picked])}
            >
              Add {picked.size > 0 ? picked.size : ''}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
