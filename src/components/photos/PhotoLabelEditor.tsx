'use client';

import { useMemo, useState } from 'react';
import { Check, Loader2, Plus, Tag, X } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { cn } from '@/utils/_cn';
import { useLabels } from '@/hooks/useLabels';
import { labelChipClasses } from '@/lib/photos/label-colors';
import { toast } from '@/lib/toast';
import type { LibraryPhoto } from './photo-library-types';

type TriState = 'all' | 'some' | 'none';

/** How many of the target photos already carry this label. */
function initialState(photos: LibraryPhoto[], labelId: number): TriState {
  if (photos.length === 0) return 'none';
  let count = 0;
  for (const p of photos) {
    if ((p.labels ?? []).some((l) => l.id === labelId)) count += 1;
  }
  if (count === 0) return 'none';
  if (count === photos.length) return 'all';
  return 'some';
}

/**
 * Label editor — applies labels to one photo (PUT replace) or many (bulk
 * add/remove diff). Vocabulary toggles as chips; a label already on ALL targets
 * shows checked, on SOME shows indeterminate (left untouched unless toggled).
 * Scoped to the active image type's labels + globals.
 */
export function PhotoLabelEditor({
  photos,
  scopeImageType,
  onClose,
}: {
  photos: LibraryPhoto[];
  scopeImageType?: string;
  onClose: () => void;
}) {
  const { labels, isLoading, createLabel, setPhotoLabels, bulkApply } = useLabels(scopeImageType);
  const single = photos.length === 1;

  // Explicit user toggles, keyed by label id; absent = "leave as-is".
  const [desired, setDesired] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);

  const initial = useMemo(() => {
    const map = new Map<number, TriState>();
    for (const l of labels) map.set(l.id, initialState(photos, l.id));
    return map;
  }, [labels, photos]);

  const isChecked = (labelId: number): boolean => {
    if (labelId in desired) return desired[labelId];
    return initial.get(labelId) === 'all';
  };
  const isIndeterminate = (labelId: number): boolean =>
    !(labelId in desired) && initial.get(labelId) === 'some';

  const toggle = (labelId: number) => {
    setDesired((prev) => {
      const next = { ...prev };
      const current = labelId in prev ? prev[labelId] : initial.get(labelId) === 'all';
      next[labelId] = !current;
      return next;
    });
  };

  const addLabel = async () => {
    const name = window.prompt('New label name')?.trim();
    if (!name) return;
    try {
      const created = await createLabel.mutateAsync({ label: name, scopeImageType });
      setDesired((prev) => ({ ...prev, [created.id]: true }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create label');
    }
  };

  const apply = async () => {
    setSaving(true);
    try {
      if (single) {
        const labelIds = labels.filter((l) => isChecked(l.id)).map((l) => l.id);
        await setPhotoLabels.mutateAsync({ photoId: photos[0].id, labelIds });
      } else {
        const addLabelIds: number[] = [];
        const removeLabelIds: number[] = [];
        for (const l of labels) {
          if (!(l.id in desired)) continue; // untouched mixed/all/none — leave alone
          (desired[l.id] ? addLabelIds : removeLabelIds).push(l.id);
        }
        if (addLabelIds.length === 0 && removeLabelIds.length === 0) {
          onClose();
          return;
        }
        await bulkApply.mutateAsync({ photoIds: photos.map((p) => p.id), addLabelIds, removeLabelIds });
      }
      toast.success(single ? 'Labels updated' : `Labels applied to ${photos.length} photos`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to apply labels');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-surface-card shadow-xl ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-hairline px-4 py-3">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-text-soft" />
            <h2 className="text-sm font-bold text-text-default">
              {single ? 'Edit labels' : `Label ${photos.length} photos`}
            </h2>
          </div>
          <IconButton
            icon={<X className="h-4 w-4" />}
            onClick={onClose}
            ariaLabel="Close"
            className="-mr-1 inline-flex h-7 w-7 items-center justify-center rounded-lg hover:bg-surface-sunken"
          />
        </div>

        <div className="max-h-[50vh] overflow-y-auto px-4 py-3">
          {isLoading && labels.length === 0 ? (
            <div className="flex items-center gap-2 py-4 text-caption text-text-faint">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading labels…
            </div>
          ) : labels.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-soft bg-surface-canvas px-4 py-6 text-center text-caption text-text-soft">
              No labels yet. Create one to get started.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {labels.map((lbl) => {
                const checked = isChecked(lbl.id);
                const indeterminate = isIndeterminate(lbl.id);
                return (
                  // ds-raw-button: tri-state label toggle chip (aria-pressed + indeterminate ring + per-label color classes), not a single-variant Button
                  <button
                    key={lbl.id}
                    type="button"
                    onClick={() => toggle(lbl.id)}
                    aria-pressed={checked}
                    className={cn(
                      'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-micro font-black uppercase tracking-widest transition',
                      labelChipClasses(lbl.color),
                      checked
                        ? 'ring-2 ring-offset-1 ring-blue-500'
                        : indeterminate
                          ? 'opacity-60 ring-1 ring-dashed ring-gray-400'
                          : 'opacity-50 hover:opacity-90',
                    )}
                  >
                    {checked ? <Check className="h-3 w-3" /> : <Tag className="h-3 w-3" />}
                    {lbl.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border-hairline px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={addLabel}
            icon={<Plus className="h-3.5 w-3.5" />}
          >
            New label
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={apply}
              disabled={saving}
              icon={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            >
              Apply
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
