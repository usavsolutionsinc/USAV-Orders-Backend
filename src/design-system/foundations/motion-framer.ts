import type { Transition, Variants } from 'framer-motion';

/**
 * Cubic-bezier tuples for Framer Motion `ease`.
 * Primary curve matches station / Up Next cards (kinetic ledger rhythm).
 */
export const motionBezier = {
  /** Cards, chevrons, list rows, opacity */
  easeOut: [0.22, 1, 0.36, 1] as const,
  /** Height / layout — softer than easeOut */
  layout: [0.25, 0.1, 0.25, 1] as const,
} as const;

/** Durations in seconds — pair with `motionBezier` */
export const framerDuration = {
  /** Active station order card mount */
  stationCardMount: 0.26,
  /** Up Next list row mount */
  upNextRowMount: 0.18,
  stationChevron: 0.28,
  upNextChevron: 0.2,
  stationCollapseHeight: 0.32,
  stationCollapseOpacity: 0.26,
  upNextCollapseHeight: 0.22,
  upNextCollapseOpacity: 0.14,
  stationSerialRow: 0.22,
  stationAddedBadge: 0.18,
  /** Modal scrim fade — aligns with CSS `motionDurations.fast` */
  overlayScrim: 0.15,
} as const;

/** Named Framer `transition` presets */
export const framerTransition = {
  stationCardMount: {
    duration: framerDuration.stationCardMount,
    ease: motionBezier.easeOut,
  } satisfies Transition,

  upNextRowMount: {
    duration: framerDuration.upNextRowMount,
    ease: motionBezier.easeOut,
  } satisfies Transition,

  stationChevron: {
    type: 'tween' as const,
    duration: framerDuration.stationChevron,
    ease: motionBezier.easeOut,
  } satisfies Transition,

  upNextChevron: {
    type: 'tween' as const,
    duration: framerDuration.upNextChevron,
    ease: motionBezier.easeOut,
  } satisfies Transition,

  /** Height + opacity synced for expand/collapse (active order panel) */
  stationCollapse: {
    height: {
      type: 'tween' as const,
      duration: framerDuration.stationCollapseHeight,
      ease: motionBezier.layout,
    },
    opacity: {
      type: 'tween' as const,
      duration: framerDuration.stationCollapseOpacity,
      ease: motionBezier.easeOut,
    },
  } satisfies Transition,

  /** Up Next expanded block — snappier height, quick opacity */
  upNextCollapse: {
    height: {
      type: 'tween' as const,
      duration: framerDuration.upNextCollapseHeight,
      ease: motionBezier.easeOut,
    },
    opacity: {
      type: 'tween' as const,
      duration: framerDuration.upNextCollapseOpacity,
      ease: 'easeOut' as const,
    },
  } satisfies Transition,

  stationSerialRow: {
    type: 'tween' as const,
    duration: framerDuration.stationSerialRow,
    ease: motionBezier.easeOut,
  } satisfies Transition,

  stationAddedBadge: {
    type: 'tween' as const,
    duration: framerDuration.stationAddedBadge,
    ease: motionBezier.easeOut,
  } satisfies Transition,

  /** Work order assignment overlay backdrop */
  overlayScrim: {
    duration: framerDuration.overlayScrim,
    ease: motionBezier.easeOut,
  } satisfies Transition,

  /** Centered assignment modal shell */
  workOrderModalSpring: {
    type: 'spring' as const,
    damping: 26,
    stiffness: 400,
    mass: 0.4,
  } satisfies Transition,

  /** Horizontal slide between rows inside the modal */
  workOrderSlideSpring: {
    type: 'spring' as const,
    damping: 28,
    stiffness: 380,
    mass: 0.42,
  } satisfies Transition,
} as const;

/**
 * Common `initial` / `animate` / `exit` shapes for `motion.*` + `AnimatePresence`.
 * Use: `initial={presets.stationCard.initial}` etc.
 */
export const framerPresence = {
  stationCard: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -6 },
  },
  upNextRow: {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4 },
  },
  collapseHeight: {
    initial: { height: 0, opacity: 0 },
    animate: { height: 'auto', opacity: 1 },
    exit: { height: 0, opacity: 0 },
  },
  stationSerialRow: {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4 },
  },
  stationAddedBadge: {
    initial: { opacity: 0, x: 6 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: 4 },
  },
  workOrderScrim: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  },
  workOrderModal: {
    initial: { opacity: 0, scale: 0.94, y: 14 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.94, y: 8 },
  },
} as const;

/** Tech / packer grid chips — shared `whileTap` target */
export const framerGesture = {
  tapPress: { scale: 0.9 },
} as const;

/**
 * Row-to-row slide inside `WorkOrderAssignmentCard`.
 * Use with `custom={direction}` and `initial="enter" animate="center" exit="exit"`.
 */
export const workOrderAssignmentSlideVariants: Variants = {
  enter: (dir: 'next' | 'prev' | undefined) => ({
    x: dir === 'prev' ? '-55%' : '55%',
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (dir: 'next' | 'prev' | undefined) => ({
    x: dir === 'prev' ? '55%' : '-55%',
    opacity: 0,
  }),
};

/** Optional variants API — `initial="initial" animate="animate" exit="exit"` */
export const framerVariants: {
  stationCard: Variants;
  upNextRow: Variants;
  collapseHeight: Variants;
  stationSerialRow: Variants;
  stationAddedBadge: Variants;
} = {
  stationCard: {
    initial: framerPresence.stationCard.initial,
    animate: framerPresence.stationCard.animate,
    exit: framerPresence.stationCard.exit,
  },
  upNextRow: {
    initial: framerPresence.upNextRow.initial,
    animate: framerPresence.upNextRow.animate,
    exit: framerPresence.upNextRow.exit,
  },
  collapseHeight: {
    initial: framerPresence.collapseHeight.initial,
    animate: framerPresence.collapseHeight.animate,
    exit: framerPresence.collapseHeight.exit,
  },
  stationSerialRow: {
    initial: framerPresence.stationSerialRow.initial,
    animate: framerPresence.stationSerialRow.animate,
    exit: framerPresence.stationSerialRow.exit,
  },
  stationAddedBadge: {
    initial: framerPresence.stationAddedBadge.initial,
    animate: framerPresence.stationAddedBadge.animate,
    exit: framerPresence.stationAddedBadge.exit,
  },
};
