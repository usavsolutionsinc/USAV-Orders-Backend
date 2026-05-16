'use client';

/** Pulse-skeleton card placeholder used while loading data. */
export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-3xl border border-gray-100 bg-gradient-to-br from-gray-100 to-gray-50 ${className}`}
      aria-hidden="true"
    >
      <div className="p-4">
        <div className="h-4 w-3/4 rounded-full bg-gray-200" />
        <div className="mt-2 h-2.5 w-1/2 rounded-full bg-gray-200/70" />
      </div>
    </div>
  );
}

/** Render N skeleton cards for a grid placeholder. */
export function SkeletonCardGrid({ count = 4, className = '' }: { count?: number; className?: string }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} className={className} />
      ))}
    </>
  );
}
