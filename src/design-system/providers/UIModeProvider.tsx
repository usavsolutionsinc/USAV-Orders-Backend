'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useDeviceMode, type DeviceInfo } from '@/hooks';

// ─── Types ───────────────────────────────────────────────────────────────────

export type UIMode = 'desktop' | 'mobile';

export interface UIModeContextValue {
  /** Resolved display mode — the single source of truth for layout branching. */
  mode: UIMode;
  /** True when mode === 'mobile'. Convenience for ternaries. */
  isMobile: boolean;
  /** True when mode === 'desktop'. */
  isDesktop: boolean;
  /** True if the device has a camera (for gating photo/scan flows). */
  hasCamera: boolean;
  /** True if the primary input is touch (no hover). */
  isTouchPrimary: boolean;
  /** True if the hardware itself is a mobile device (UA Client Hints). */
  isMobileDevice: boolean;
  /** The current manual override, or null for auto-detect. */
  modeOverride: UIMode | null;
  /** Set a manual override ('mobile' | 'desktop') or null to return to auto. */
  setModeOverride: (override: UIMode | null) => void;
  /** True if prefers-reduced-motion is active. */
  prefersReducedMotion: boolean;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const UIModeContext = createContext<UIModeContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

interface UIModeProviderProps {
  children: ReactNode;
  /** Force a mode for testing / Storybook. Overrides all detection. */
  forceMode?: UIMode;
}

/**
 * UIModeProvider — wraps the entire app (or a subtree) and provides a single
 * `mode` value that every component can consume to decide desktop vs mobile UX.
 *
 * Detection priority:
 *   1. `forceMode` prop (testing / Storybook)
 *   2. User manual override (localStorage, via DeviceModeToggle)
 *   3. Hardware detection (UA Client Hints → UA string fallback)
 *   4. Viewport width + touch input (< 768px AND coarse pointer)
 *
 * Usage:
 *   <UIModeProvider>
 *     <App />
 *   </UIModeProvider>
 *
 * In components:
 *   const { mode, isMobile, hasCamera } = useUIMode();
 */
export function UIModeProvider({ children, forceMode }: UIModeProviderProps) {
  const device = useDeviceMode();
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setPrefersReducedMotion(mediaQuery.matches);

    sync();
    mediaQuery.addEventListener('change', sync);
    return () => mediaQuery.removeEventListener('change', sync);
  }, []);

  const mode: UIMode = forceMode ?? device.mode;

  const value = useMemo<UIModeContextValue>(
    () => ({
      mode,
      isMobile: mode === 'mobile',
      isDesktop: mode === 'desktop',
      hasCamera: device.hasCamera,
      isTouchPrimary: device.isTouchPrimary,
      isMobileDevice: device.isMobileDevice,
      modeOverride: forceMode ?? device.modeOverride,
      setModeOverride: device.setModeOverride,
      prefersReducedMotion,
    }),
    [mode, device, forceMode, prefersReducedMotion],
  );

  return <UIModeContext.Provider value={value}>{children}</UIModeContext.Provider>;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Consume the current UI mode from the nearest `UIModeProvider`.
 *
 * @example
 *   const { mode, isMobile, hasCamera } = useUIMode();
 *   if (isMobile) return <MobileLayout />;
 *   return <DesktopLayout />;
 */
export function useUIMode(): UIModeContextValue {
  const ctx = useContext(UIModeContext);
  if (!ctx) {
    throw new Error('useUIMode must be used within a <UIModeProvider>');
  }
  return ctx;
}

/**
 * Safe version — returns desktop defaults if no provider is found.
 * Use in library components that may render outside the provider tree.
 */
export function useUIModeOptional(): UIModeContextValue {
  const ctx = useContext(UIModeContext);
  if (ctx) return ctx;
  // Sensible desktop defaults
  return {
    mode: 'desktop',
    isMobile: false,
    isDesktop: true,
    hasCamera: false,
    isTouchPrimary: false,
    isMobileDevice: false,
    modeOverride: null,
    setModeOverride: () => {},
    prefersReducedMotion: false,
  };
}
