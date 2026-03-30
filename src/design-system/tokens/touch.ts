/**
 * Mobile touch tokens — sizing, safe areas, and density overrides.
 *
 * These tokens enforce iOS HIG / Material 3 minimum tap target guidelines
 * (44pt / 48dp) and provide safe-area-aware spacing for notch/home-bar devices.
 *
 * Usage:
 *   - Apply `touchTarget.min` as min-height/min-width on all tappable elements in mobile mode.
 *   - Use `safeArea.*` CSS env() values for padding at screen edges.
 *   - Use `mobileDensity.*` instead of the desktop `density` presets when in mobile mode.
 */

// ─── Touch targets ───────────────────────────────────────────────────────────

export const touchTarget = {
  /** Absolute minimum tappable area (iOS HIG: 44pt) */
  min: '44px',
  /** Comfortable tap target for primary actions */
  comfortable: '48px',
  /** Large tap target for FABs and primary CTAs */
  large: '56px',
  /** Extra-large for full-width action bars */
  xl: '64px',
} as const;

// ─── Safe area insets ────────────────────────────────────────────────────────
// These resolve to 0 on devices without notches/home bars.

export const safeArea = {
  top: 'env(safe-area-inset-top, 0px)',
  bottom: 'env(safe-area-inset-bottom, 0px)',
  left: 'env(safe-area-inset-left, 0px)',
  right: 'env(safe-area-inset-right, 0px)',
} as const;

/**
 * Tailwind-compatible safe area bottom padding.
 * Use: `pb-[max(0.75rem,env(safe-area-inset-bottom))]`
 * This ensures at least 12px padding, or the device safe area, whichever is larger.
 */
export const safeAreaBottomClass = 'pb-[max(0.75rem,env(safe-area-inset-bottom))]' as const;
export const safeAreaTopClass = 'pt-[max(0rem,env(safe-area-inset-top))]' as const;

// ─── Mobile density presets ──────────────────────────────────────────────────
// Wider padding, taller rows, larger gaps than desktop `density` tokens.

export const mobileDensity = {
  /** Compact mobile rows — still meets 44px min tap height */
  compact: { px: '0.75rem', py: '0.625rem', gap: '0.5rem', minH: '44px' },
  /** Standard mobile rows — comfortable single-thumb reach */
  standard: { px: '1rem', py: '0.75rem', gap: '0.75rem', minH: '48px' },
  /** Spacious mobile — forms, primary inputs */
  spacious: { px: '1.25rem', py: '1rem', gap: '1rem', minH: '56px' },
} as const;

// ─── Mobile icon sizing ──────────────────────────────────────────────────────

export const mobileIconSize = {
  /** Bottom nav bar icons */
  nav: 'h-6 w-6',
  /** Toolbar action icons */
  toolbar: 'h-5 w-5',
  /** FAB icon */
  fab: 'h-6 w-6',
  /** Inline action icons (copy, external link) */
  inline: 'h-5 w-5',
} as const;

// ─── Bottom nav metrics ──────────────────────────────────────────────────────

export const bottomNav = {
  /** Height of the bottom navigation bar (excluding safe area) */
  height: '56px',
  /** Height including safe area for CSS calc: calc(56px + env(...)) */
  heightWithSafeArea: 'calc(56px + env(safe-area-inset-bottom, 0px))',
  /** Max number of items */
  maxItems: 5,
} as const;

// ─── FAB metrics ─────────────────────────────────────────────────────────────

export const fab = {
  /** Standard FAB size */
  size: '56px',
  /** Mini FAB size */
  sizeSmall: '40px',
  /** Distance from bottom edge (above bottom nav) */
  bottomOffset: '72px',
  /** Distance from right edge */
  rightOffset: '16px',
} as const;

export type TouchTarget = typeof touchTarget;
export type SafeArea = typeof safeArea;
export type MobileDensity = typeof mobileDensity;
