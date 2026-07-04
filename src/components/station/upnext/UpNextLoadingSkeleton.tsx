import { SkeletonBase, SkeletonList } from '@/design-system';

/**
 * Skeleton mirrors the loaded layout:
 *   • Sticky nav slider (rounded-full pills, h-8) — one "active" pill is
 *     filled to match the blue selected state without committing to a
 *     specific tab while data is in flight.
 *   • Urgency summary row (late / due-today eyebrow chips).
 *   • Linear-style row cards (see SkeletonOrderCard).
 */
export function UpNextLoadingSkeleton() {
  return (
    <div className="relative flex flex-col">
      <div className="sticky top-0 z-10 bg-surface-card pb-0.5">
        <div className="-mx-1 overflow-x-hidden py-2">
          <div className="flex min-w-max gap-2 px-1">
            <div className="h-8 w-20 flex-shrink-0 rounded-full bg-blue-600/90 animate-pulse" />
            <div className="h-8 w-24 flex-shrink-0 rounded-full bg-surface-card ring-1 ring-inset ring-border-soft animate-pulse" />
            <div className="h-8 w-20 flex-shrink-0 rounded-full bg-surface-card ring-1 ring-inset ring-border-soft animate-pulse" />
            <div className="h-8 w-24 flex-shrink-0 rounded-full bg-surface-card ring-1 ring-inset ring-border-soft animate-pulse" />
          </div>
        </div>
        <div className="flex items-center gap-2 px-1 pt-0.5">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-200" />
            <SkeletonBase width="44px" height="10px" />
          </span>
          <span className="text-text-faint text-eyebrow">·</span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-200" />
            <SkeletonBase width="64px" height="10px" />
          </span>
        </div>
      </div>
      <SkeletonList count={5} type="card" />
    </div>
  );
}
