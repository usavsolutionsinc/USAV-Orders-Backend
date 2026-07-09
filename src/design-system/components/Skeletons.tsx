'use client';

import { motion } from 'framer-motion';
import { framerPresence, framerTransition } from '../foundations/motion-framer';

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  circle?: boolean;
}

export function SkeletonBase({ className = '', width, height, circle }: SkeletonProps) {
  return (
    <div
      className={`bg-surface-strong animate-pulse ${circle ? 'rounded-full' : 'rounded-md'} ${className}`}
      style={{
        width: width ?? '100%',
        height: height ?? '1rem',
      }}
    />
  );
}

export function SkeletonRow() {
  return (
    <motion.div
      {...framerPresence.tableRow}
      transition={framerTransition.tableRowMount}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-3 py-2.5 border-b border-border-hairline"
    >
      <div className="flex flex-col gap-2">
        <SkeletonBase width="60%" height="0.875rem" />
        <SkeletonBase width="40%" height="0.625rem" />
      </div>
      <div className="flex items-center gap-2">
        <SkeletonBase width="40px" height="20px" />
        <SkeletonBase width="60px" height="20px" />
        <SkeletonBase width="80px" height="20px" />
      </div>
    </motion.div>
  );
}

/**
 * Mirrors the Linear-variant `OrderCard` row used in the /tech Up Next list.
 * Three stacked rows inside `px-3 py-2.5`:
 *   1. id chip · channel chip + chevron slot
 *   2. title line
 *   3. ship-by pill + urgency phrase ... condition badge + qty pill
 */
export function SkeletonOrderCard() {
  return (
    <motion.div
      {...framerPresence.upNextRow}
      transition={framerTransition.upNextRowMount}
      className="relative bg-surface-card px-3 py-2.5 border-b border-border-hairline"
    >
      {/* Row 1 — meta line */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <SkeletonBase width="48px" height="10px" />
          <span className="h-1 w-1 rounded-full bg-surface-strong" />
          <SkeletonBase width="64px" height="10px" />
        </div>
        <SkeletonBase width="14px" height="14px" />
      </div>

      {/* Row 2 — title */}
      <div className="mt-1.5">
        <SkeletonBase width="70%" height="14px" />
      </div>

      {/* Row 3 — ship-by + urgency + (right) condition + qty */}
      <div className="mt-2 flex items-center gap-1.5">
        <SkeletonBase width="48px" height="18px" className="rounded-md" />
        <SkeletonBase width="56px" height="10px" />
        <div className="ml-auto flex items-center gap-1">
          <SkeletonBase width="40px" height="16px" className="rounded" />
          <SkeletonBase width="24px" height="14px" className="rounded" />
        </div>
      </div>
    </motion.div>
  );
}

export function SkeletonList({ count = 5, type = 'row' }: { count?: number; type?: 'row' | 'card' }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: count }).map((_, i) => (
        type === 'row' ? <SkeletonRow key={i} /> : <SkeletonOrderCard key={i} />
      ))}
    </div>
  );
}
