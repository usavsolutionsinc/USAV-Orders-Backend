'use client';

import { Tag } from '@/components/Icons';
import { cn } from '@/utils/_cn';
import { labelChipClasses } from '@/lib/photos/label-colors';
import type { LibraryPhotoLabel } from './photo-library-types';

/**
 * Read-only label chips for a library photo. Renders up to `max` chips, then a
 * "+N" overflow pill. Colors resolve from the semantic-token registry (never
 * inline hex). Used on cards, the list row, and the lightbox meta.
 */
export function PhotoLabelChips({
  labels,
  max = 3,
  className,
}: {
  labels: LibraryPhotoLabel[] | undefined;
  max?: number;
  className?: string;
}) {
  if (!labels || labels.length === 0) return null;
  const shown = labels.slice(0, max);
  const overflow = labels.length - shown.length;

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {shown.map((lbl) => (
        <span
          key={lbl.id}
          className={cn(
            'inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[8.5px] font-black uppercase tracking-widest',
            labelChipClasses(lbl.color),
          )}
        >
          <Tag className="h-2.5 w-2.5" />
          {lbl.label}
        </span>
      ))}
      {overflow > 0 ? (
        <span className="inline-flex items-center rounded bg-surface-sunken px-1 py-0.5 text-[8.5px] font-black uppercase tracking-widest text-text-soft">
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}
