'use client';

import { Image as ImageIcon } from '@/components/Icons';

/** Loading shimmer — a grid of placeholder tiles matching the small-grid rhythm. */
export function PhotoGridSkeleton() {
  return (
    <div
      className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-8"
      aria-busy="true"
      aria-label="Loading photos"
    >
      {Array.from({ length: 24 }).map((_, i) => (
        <div key={i} className="aspect-square animate-pulse rounded-lg bg-surface-sunken" />
      ))}
    </div>
  );
}

/** Teaching empty state — explains the filter, doesn't just say "nothing here". */
export function PhotoEmptyState() {
  return (
    <div className="mx-auto mt-6 flex max-w-sm flex-col items-center gap-2 rounded-xl border border-dashed border-border-soft bg-surface-canvas px-6 py-10 text-center">
      <ImageIcon className="h-6 w-6 text-text-faint" />
      <p className="text-sm font-semibold text-text-default">No photos in this view</p>
      <p className="text-xs leading-relaxed text-text-soft">
        Unboxing, packing, and claim photos land here as staff capture them. Widen the
        source or date range in the sidebar to see more.
      </p>
    </div>
  );
}
