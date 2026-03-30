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
  /** Table row enter/exit */
  tableRowMount: 0.22,
  /** Sidebar section expand/collapse */
  sidebarExpand: 0.26,
  /** Dropdown menu open/close */
  dropdownOpen: 0.18,
  /** Overlay search bar toggle */
  overlaySearchIn: 0.2,
  /** Copy-to-clipboard feedback flash */
  chipCopyFeedback: 0.15,
} as const;

export const framerDurationTabPager = {
  x: 0.32,
  opacity: 0.2,
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

  /** Table row enter/exit */
  tableRowMount: {
    duration: framerDuration.tableRowMount,
    ease: motionBezier.easeOut,
  } satisfies Transition,

  /** Sidebar expandable section height + opacity */
  sidebarExpand: {
    height: {
      type: 'tween' as const,
      duration: framerDuration.sidebarExpand,
      ease: motionBezier.layout,
    },
    opacity: {
      type: 'tween' as const,
      duration: framerDuration.sidebarExpand * 0.7,
      ease: motionBezier.easeOut,
    },
  } satisfies Transition,

  /** Dropdown menu open/close */
  dropdownOpen: {
    duration: framerDuration.dropdownOpen,
    ease: motionBezier.easeOut,
  } satisfies Transition,

  /** Overlay search bar toggle */
  overlaySearchIn: {
    duration: framerDuration.overlaySearchIn,
    ease: motionBezier.easeOut,
  } satisfies Transition,

  /** Copy feedback flash */
  chipCopyFeedback: {
    duration: framerDuration.chipCopyFeedback,
    ease: motionBezier.easeOut,
  } satisfies Transition,

  /** Horizontal tab pager — x slide + opacity crossfade */
  tabPager: {
    x: { type: 'tween' as const, duration: framerDurationTabPager.x, ease: [0.32, 0.72, 0, 1] as const },
    opacity: { duration: framerDurationTabPager.opacity, ease: 'easeOut' as const },
  } satisfies Transition,

  /** Reduced-motion fallback for tab pager */
  tabPagerReduced: {
    x: { type: 'tween' as const, duration: 0.01, ease: [0.32, 0.72, 0, 1] as const },
    opacity: { duration: 0.01, ease: 'easeOut' as const },
  } satisfies Transition,

  /** Assignment body row change — opacity only (keeps tech/packer from sliding on X). */
  workOrderBodyCrossfade: {
    duration: 0.14,
    ease: motionBezier.easeOut,
  } satisfies Transition,

  /**
   * Assignment title block — height/position layout from bottom edge (`transformOrigin: bottom center`)
   * so multi-line titles feel like they grow upward; pair with `LayoutGroup` scoped to the title only.
   */
  workOrderTitleLayoutSpring: {
    type: 'spring' as const,
    damping: 38,
    stiffness: 320,
    mass: 0.28,
  } satisfies Transition,

  /**
   * Title row swap + layout — `layout` for line-wrap; opacity/y for keyed row changes.
   * Footer stays outside `LayoutGroup` / `AnimatePresence` so it does not crossfade or layout-shift.
   */
  workOrderAssignmentTitleBlock: {
    layout: {
      type: 'spring' as const,
      damping: 38,
      stiffness: 320,
      mass: 0.28,
    },
    opacity: {
      duration: 0.17,
      ease: motionBezier.easeOut,
    },
    y: {
      type: 'spring' as const,
      damping: 24,
      stiffness: 420,
      mass: 0.3,
    },
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
  /** Table row — simple opacity fade */
  tableRow: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  },
  /** Dropdown panel — fade + slight slide from top */
  dropdownPanel: {
    initial: { opacity: 0, y: -4 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -6 },
  },
  /** Sidebar section — height expand/collapse */
  sidebarSection: {
    initial: { height: 0, opacity: 0 },
    animate: { height: 'auto' as const, opacity: 1 },
    exit: { height: 0, opacity: 0 },
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

/**
 * Tab pager — full-width horizontal swipe.
 * Use with `custom={direction}` (+1 right, -1 left) and `initial="enter" animate="center" exit="exit"`.
 * Pair with `AnimatePresence mode="sync"` inside a single-cell grid so both panels overlap without height glitches.
 */
export const tabPagerVariants: Variants = {
  enter: (dir: number) => ({
    x: dir > 0 ? '100%' : '-100%',
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({
    x: dir > 0 ? '-100%' : '100%',
    opacity: 0,
  }),
};

// ─── Mobile-specific durations ───────────────────────────────────────────────

export const framerDurationMobile = {
  /** Bottom sheet slide up/down */
  sheetSlide: 0.32,
  /** Camera viewfinder enter */
  cameraEnter: 0.28,
  /** Camera viewfinder exit */
  cameraExit: 0.2,
  /** Scan success flash */
  scanSuccess: 0.18,
  /** Scan failure shake */
  scanFailure: 0.4,
  /** FAB mount / unmount */
  fabMount: 0.22,
  /** Bottom nav icon swap */
  navIconSwap: 0.15,
  /** Mobile card mount (slightly slower than desktop for thumb-tracking) */
  mobileCardMount: 0.3,
  /** Photo thumbnail appear */
  photoThumb: 0.2,
  /** Mobile toolbar slide */
  toolbarSlide: 0.22,
  /** Scan confirmation bottom sheet slide up */
  confirmationSlideUp: 0.35,
  /** Search bar expand/collapse in action bar */
  searchExpand: 0.28,
} as const;

// ─── Mobile-specific transitions ─────────────────────────────────────────────

export const framerTransitionMobile = {
  /** Bottom sheet — spring-damped vertical slide */
  sheetSlide: {
    type: 'spring' as const,
    damping: 30,
    stiffness: 350,
    mass: 0.5,
  } satisfies Transition,

  /** Camera fullscreen enter — opacity + scale */
  cameraEnter: {
    duration: framerDurationMobile.cameraEnter,
    ease: motionBezier.easeOut,
  } satisfies Transition,

  /** Camera exit — faster for responsiveness */
  cameraExit: {
    duration: framerDurationMobile.cameraExit,
    ease: [0.4, 0, 1, 1] as readonly number[],
  } satisfies Transition,

  /** Scan success — quick pulse feedback */
  scanSuccess: {
    duration: framerDurationMobile.scanSuccess,
    ease: motionBezier.easeOut,
  } satisfies Transition,

  /** Scan failure — horizontal shake */
  scanFailure: {
    type: 'spring' as const,
    damping: 12,
    stiffness: 600,
    mass: 0.3,
  } satisfies Transition,

  /** FAB entrance spring */
  fabMount: {
    type: 'spring' as const,
    damping: 22,
    stiffness: 400,
    mass: 0.4,
  } satisfies Transition,

  /** Bottom nav active icon crossfade */
  navIconSwap: {
    duration: framerDurationMobile.navIconSwap,
    ease: motionBezier.easeOut,
  } satisfies Transition,

  /** Mobile card mount — slightly softer than desktop */
  mobileCardMount: {
    duration: framerDurationMobile.mobileCardMount,
    ease: motionBezier.easeOut,
  } satisfies Transition,

  /** Photo thumbnail appear */
  photoThumb: {
    duration: framerDurationMobile.photoThumb,
    ease: motionBezier.easeOut,
  } satisfies Transition,

  /** Mobile toolbar slide in from top */
  toolbarSlide: {
    duration: framerDurationMobile.toolbarSlide,
    ease: motionBezier.easeOut,
  } satisfies Transition,

  /** Scan confirmation bottom sheet — spring-damped slide up */
  confirmationSlideUp: {
    type: 'spring' as const,
    damping: 28,
    stiffness: 320,
    mass: 0.5,
  } satisfies Transition,

  /** Search bar expand in bottom action bar */
  searchExpand: {
    type: 'spring' as const,
    damping: 26,
    stiffness: 380,
    mass: 0.4,
  } satisfies Transition,
} as const;

// ─── Mobile-specific presence shapes ─────────────────────────────────────────

export const framerPresenceMobile = {
  /** Bottom sheet — slides up from below viewport */
  sheet: {
    initial: { y: '100%' },
    animate: { y: 0 },
    exit: { y: '100%' },
  },
  /** Camera overlay — fades + scales from center */
  camera: {
    initial: { opacity: 0, scale: 0.95 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.95 },
  },
  /** Scan success pulse — scale bounce */
  scanSuccess: {
    initial: { scale: 1 },
    animate: { scale: [1, 1.08, 1] },
  },
  /** Scan failure shake — horizontal displacement */
  scanFailure: {
    initial: { x: 0 },
    animate: { x: [0, -8, 8, -5, 5, 0] },
  },
  /** FAB — scales up from nothing */
  fab: {
    initial: { opacity: 0, scale: 0.6 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.6 },
  },
  /** Mobile card — slides up slightly more than desktop */
  mobileCard: {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -8 },
  },
  /** Photo thumbnail grid appear */
  photoThumb: {
    initial: { opacity: 0, scale: 0.85 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.85 },
  },
  /** Toolbar slide from top */
  toolbar: {
    initial: { opacity: 0, y: -12 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -8 },
  },
  /** Scan confirmation — slides up from below viewport */
  confirmation: {
    initial: { y: '100%', opacity: 0.8 },
    animate: { y: 0, opacity: 1 },
    exit: { y: '100%', opacity: 0 },
  },
  /** Search input expand — width + opacity */
  searchInput: {
    initial: { width: 0, opacity: 0 },
    animate: { width: 'auto', opacity: 1 },
    exit: { width: 0, opacity: 0 },
  },
} as const;

/** Optional variants API — `initial="initial" animate="animate" exit="exit"` */
export const framerVariants: Record<string, Variants> = {
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
  tableRow: {
    initial: framerPresence.tableRow.initial,
    animate: framerPresence.tableRow.animate,
    exit: framerPresence.tableRow.exit,
  },
  dropdownPanel: {
    initial: framerPresence.dropdownPanel.initial,
    animate: framerPresence.dropdownPanel.animate,
    exit: framerPresence.dropdownPanel.exit,
  },
  sidebarSection: {
    initial: framerPresence.sidebarSection.initial,
    animate: framerPresence.sidebarSection.animate,
    exit: framerPresence.sidebarSection.exit,
  },
};
