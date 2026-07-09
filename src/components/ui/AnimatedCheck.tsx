'use client';

import { motion, useReducedMotion } from 'framer-motion';

/**
 * Success checkmark that draws itself on mount: the emerald disc pops in (spring)
 * and the tick strokes on via SVG `pathLength` 0→1. Built for use as a sonner
 * toast `icon` (default ~18px) but works anywhere a success glyph is wanted.
 *
 * Honors `prefers-reduced-motion` — it renders the final, fully-drawn mark with
 * no scale/draw animation (per the house reduced-motion mandate).
 *
 * Uses `framer-motion` to match the rest of the codebase (motion-framer.ts).
 */
export function AnimatedCheck({ size = 18 }: { size?: number }) {
  const reduce = useReducedMotion();

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      initial={reduce ? false : { scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 480, damping: 22, mass: 0.6 }}
    >
      <motion.circle
        cx="12"
        cy="12"
        r="11"
        className="fill-emerald-500"
        initial={reduce ? false : { scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 18, mass: 0.7 }}
        style={{ transformOrigin: 'center' }}
      />
      <motion.path
        d="M7 12.6l3.1 3.1L17 9"
        stroke="white"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={
          reduce
            ? { duration: 0 }
            : { delay: 0.12, duration: 0.28, ease: [0.22, 1, 0.36, 1] }
        }
      />
    </motion.svg>
  );
}
