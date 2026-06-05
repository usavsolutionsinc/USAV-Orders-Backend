'use client';

import type { ReactNode } from 'react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion';

type FeedId = string | number;

export interface MobileFeedRowContext {
  variant: 'collapsed' | 'expanded';
  fresh: boolean;
  index: number;
  isLast: boolean;
}

export interface MobileFeedProps<T> {
  rows: T[];
  isLoading?: boolean;
  scrollRef?: React.RefObject<HTMLDivElement>;
  freshIds?: Set<FeedId>;
  getId?: (row: T) => FeedId;
  /** Render the bottom (last) row as the 'expanded' card. Default true. */
  expandLast?: boolean;
  renderRow: (row: T, ctx: MobileFeedRowContext) => ReactNode;
  empty?: ReactNode;
  loading?: ReactNode;
  /** Extra classes on the scroll container. */
  className?: string;
}

const defaultGetId = <T,>(row: T): FeedId => (row as { id: FeedId }).id;

const DefaultEmpty = (
  <div className="flex h-full flex-col items-center justify-center gap-2 bg-white px-6 text-center">
    <p className="text-sm font-black uppercase tracking-[0.18em] text-gray-700">Nothing here yet</p>
  </div>
);

const DefaultLoading = (
  <div className="flex h-full items-center justify-center bg-white text-caption font-black uppercase tracking-widest text-gray-400">
    Loading…
  </div>
);

/**
 * Generic mobile feed shell. Owns the scroll container + the layout/spring
 * animation per row; callers supply `renderRow` (usually a domain row wrapped
 * in MobileRowCard). Pair with useFeedWindow for windowing + scroll + pulse.
 */
export function MobileFeed<T>({
  rows,
  isLoading = false,
  scrollRef,
  freshIds,
  getId = defaultGetId,
  expandLast = true,
  renderRow,
  empty,
  loading,
  className = '',
}: MobileFeedProps<T>) {
  const reduceMotion = useReducedMotion();

  if (isLoading && rows.length === 0) {
    return <div className="flex min-h-0 flex-1 flex-col">{loading ?? DefaultLoading}</div>;
  }
  if (rows.length === 0) {
    return <div className="flex min-h-0 flex-1 flex-col">{empty ?? DefaultEmpty}</div>;
  }

  const lastIndex = rows.length - 1;

  return (
    <div ref={scrollRef} className={`min-h-0 flex-1 overflow-y-auto ${className}`}>
      <LayoutGroup>
        <AnimatePresence initial={false}>
          {rows.map((row, i) => {
            const id = getId(row);
            const isLast = i === lastIndex;
            const variant: 'collapsed' | 'expanded' = expandLast && isLast ? 'expanded' : 'collapsed';
            const fresh = freshIds?.has(id) ?? false;
            return (
              <motion.div
                key={id}
                layout={reduceMotion ? false : 'position'}
                initial={
                  reduceMotion
                    ? false
                    : { opacity: 0, y: variant === 'expanded' ? 24 : 10, scale: variant === 'expanded' ? 0.98 : 1 }
                }
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduceMotion ? undefined : { opacity: 0, height: 0, transition: { duration: 0.18 } }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { type: 'spring', damping: 28, stiffness: 340, mass: 0.55 }
                }
              >
                {renderRow(row, { variant, fresh, index: i, isLast })}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </LayoutGroup>
    </div>
  );
}

export default MobileFeed;
