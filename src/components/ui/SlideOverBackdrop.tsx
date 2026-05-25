'use client';

import { motion } from 'framer-motion';

const TRANSITION = { duration: 0.18 } as const;

type SlideOverBackdropProps = {
  onClose: () => void;
};

/**
 * Full-screen dimmed layer behind right slide-over panels (`z-[100]`).
 * Pairs with `StationDrawer`; clicking dismisses the panel via `onClose`.
 */
export function SlideOverBackdrop({ onClose }: SlideOverBackdropProps) {
  return (
    <motion.div
      key="slide-over-backdrop"
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={TRANSITION}
      className="fixed inset-0 z-[99] bg-gray-950/35"
      onClick={onClose}
    />
  );
}
