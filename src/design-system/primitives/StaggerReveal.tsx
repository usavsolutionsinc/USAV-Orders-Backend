'use client';

import type { ReactNode } from 'react';
import { motion, type Variants } from 'framer-motion';
import { motionBezier } from '../foundations/motion-framer';

/**
 * Stagger reveal — list items cascade in for freshly-loaded queues.
 *
 * Two layers:
 *   • {@link staggerRevealContainer} / {@link staggerRevealItem} — the raw
 *     variants, for wiring straight onto an existing `motion.ul` + `motion.li`
 *     pair (used by SidebarRailShell, which owns its own list/row markup and
 *     AnimatePresence). The container orchestrates the cascade; each item
 *     inherits `hidden → show` and lands with a short slide-in.
 *   • {@link StaggerReveal} / {@link StaggerRevealItem} — turnkey wrappers for
 *     the common case (showroom, simple lists). Set `replayKey` to re-run.
 *
 * The cascade fires once on mount (when the parent transitions hidden → show).
 * Children mounted later — e.g. a freshly-scanned row arriving via
 * AnimatePresence — slide in individually rather than re-orchestrating the
 * whole list, so steady-state updates stay calm.
 */

/** Default cascade step (seconds) between consecutive children. */
export const STAGGER_REVEAL_STEP = 0.05;

/** Container variants — drive `initial="hidden" animate="show"` on the list. */
export const staggerRevealContainer = (step: number = STAGGER_REVEAL_STEP): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: step, delayChildren: 0.02 } },
});

/**
 * Item variants — each child fades + slides in from the left, matching the
 * station scan bar's "arriving" entrance (`spring, damping 25, stiffness 120`,
 * from `x: -20`) so the rail and the scan bar feel like one motion language.
 */
export const staggerRevealItem: Variants = {
  hidden: { opacity: 0, x: -20 },
  show: { opacity: 1, x: 0, transition: { type: 'spring', damping: 25, stiffness: 120 } },
  exit: { opacity: 0, transition: { duration: 0.12, ease: motionBezier.easeOut } },
};

const CONTAINER_TAGS = { ul: motion.ul, ol: motion.ol, div: motion.div } as const;
const ITEM_TAGS = { li: motion.li, div: motion.div } as const;

export interface StaggerRevealProps {
  children: ReactNode;
  /** Seconds between each child. */
  step?: number;
  className?: string;
  /** Container element — defaults to `ul`. */
  as?: keyof typeof CONTAINER_TAGS;
  /** Change this value to replay the cascade (remounts the container). */
  replayKey?: string | number;
}

/** Cascade container. Pair its children with {@link StaggerRevealItem}. */
export function StaggerReveal({ children, step, className, as = 'ul', replayKey }: StaggerRevealProps) {
  const Tag = CONTAINER_TAGS[as];
  return (
    <Tag
      key={replayKey}
      initial="hidden"
      animate="show"
      variants={staggerRevealContainer(step)}
      className={className}
    >
      {children}
    </Tag>
  );
}

export interface StaggerRevealItemProps {
  children: ReactNode;
  className?: string;
  /** Item element — defaults to `li`. */
  as?: keyof typeof ITEM_TAGS;
}

/** A single cascading row — inherits the parent {@link StaggerReveal}'s timeline. */
export function StaggerRevealItem({ children, className, as = 'li' }: StaggerRevealItemProps) {
  const Tag = ITEM_TAGS[as];
  return (
    <Tag variants={staggerRevealItem} className={className}>
      {children}
    </Tag>
  );
}
