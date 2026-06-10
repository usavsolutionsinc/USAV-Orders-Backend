/**
 * Centralized z-index scale — the single source of truth for stacking order.
 *
 * Numbers preserve the bands the codebase already converged on (panel=100,
 * modal=200, command=1000, splash=2000, tooltip=max) so a component can be
 * migrated onto a name at any time WITHOUT inverting an existing layer.
 *
 * Usage:
 *   - Tailwind:  className="z-panel"  (semantic classes are wired in
 *                tailwind.config.ts from this same object)
 *   - Inline:    style={{ zIndex: zIndex.modal }}
 *   - CSS var:   var(--ds-zIndex-modal)  (emitted by css-variables.ts)
 *
 * Rule of thumb: never hardcode a raw z-[NNN]. Pick the closest name below.
 * If two things need to stack within one band, use `+ N` off the band token
 * (e.g. zIndex.modal + 1) rather than inventing a new magic number.
 */
export const zIndex = {
  /** Default document flow. */
  base: 0,
  /** In-flow elevation: raised cards, hover lifts, sticky table sub-rows. */
  raised: 10,
  /** Sticky in-page chrome: filter bars, secondary sticky rows. */
  sticky: 30,
  /** Sticky page/section headers (the main app header band). */
  header: 40,
  /**
   * Anchored menus/popovers/dropdowns that open within normal page flow
   * (NOT over a slide-over panel). This is the old overloaded `z-50` band,
   * now reserved for true dropdowns only.
   */
  dropdown: 50,
  /** Toggle/FAB chrome that must clear page content but sit under panels. */
  fab: 90,
  /** Right-hand slide-over detail panels, mobile sidebar drawer. */
  panel: 100,
  /** Backdrop scrim sitting directly behind a slide-over panel. */
  panelBackdrop: 99,
  /** Popover/dialog launched from inside a panel — must clear `panel`. */
  panelPopover: 120,
  /** Loaders / nested sheets stacked above a panelPopover. */
  panelOverlay: 130,
  /** Dimmed scrim behind a centered modal / fullscreen surface. */
  modalBackdrop: 190,
  /** Centered modals, fullscreen scanners, drawers. */
  modal: 200,
  /** Modal-over-modal (e.g. a confirm on top of an open modal). */
  elevatedModal: 300,
  /** Always-on system banners (offline / degraded state). */
  banner: 350,
  /** Global command palette (cmdk). */
  command: 1000,
  /** Full-bleed assignment / takeover overlays. */
  takeover: 1200,
  /** Boot + auth-redirect splash that blocks the whole app. */
  splash: 2000,
  /** Toasts — visible above splashes, below only the tooltip ceiling. */
  toast: 2050,
  /** Absolute ceiling: copy/hover tooltips that must never be occluded. */
  tooltip: 2147483647,
} as const;

export type ZIndex = typeof zIndex;
export type ZIndexToken = keyof typeof zIndex;
