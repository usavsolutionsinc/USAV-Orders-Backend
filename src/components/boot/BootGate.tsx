'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { BootSplash } from '@/components/boot/BootSplash';

// useLayoutEffect warns during SSR; fall back to useEffect there. On the client
// the layout variant is what we want — it runs before the browser paints, so we
// can decide "hold vs reveal" without a flash of the wrong state.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export interface BootGateProps {
  children: React.ReactNode;
  /**
   * Warms the page's above-the-fold data before revealing. Receives the
   * QueryClient and returns a promise that settles when the data is ready
   * (resolve OR reject — a failed endpoint still reveals). The caller does the
   * prefetching so each `prefetchQuery` stays individually well-typed; reading
   * params (e.g. the live URL) at call time is up to the caller.
   */
  prefetch: (queryClient: QueryClient) => Promise<unknown> | void;
  /**
   * Returns true to HOLD the splash and warm the cache before revealing. When
   * false (the default check is "always hold"), children are revealed
   * immediately. Wire this to the fresh-sign-in flag so refreshes and in-app
   * navigations don't linger on the splash. Runs once, on the client only.
   */
  shouldHold?: () => boolean;
  /** Splash element. Defaults to the standard BootSplash. */
  splash?: React.ReactNode;
  /** Minimum ms to keep the splash up so a fast cache hit doesn't flash it. */
  minDurationMs?: number;
  /** Hard cap — reveal even if a query is still pending (slow/dead endpoint). */
  timeoutMs?: number;
  /** Fade-out duration for the splash, in ms. */
  fadeMs?: number;
}

/**
 * Holds a single loading splash over a route until its above-the-fold data is
 * warmed into the React Query cache, then reveals the page already-painted —
 * instead of letting each component stream in its own spinner.
 *
 * `ready` starts false on BOTH server and client, so:
 *   - there is never a hydration mismatch, and
 *   - the server-rendered HTML for a hard navigation (a fresh sign-in lands
 *     here via window.location.assign) is the splash itself — the browser
 *     paints the splash first, never the half-built dashboard.
 *
 * The reveal decision is made in a layout effect (pre-paint) so a normal
 * refresh or SPA navigation flips straight to the content without lingering.
 */
export function BootGate({
  children,
  prefetch,
  shouldHold,
  splash = <BootSplash />,
  minDurationMs = 550,
  timeoutMs = 8000,
  fadeMs = 320,
}: BootGateProps) {
  const queryClient = useQueryClient();
  // `revealed` = children are mounted (behind the splash). `splashUp` = the
  // splash is at full opacity (false → fade it out). `splashMounted` = the splash
  // is still in the tree at all; it is removed only AFTER the fade-out completes.
  // Splitting "fading" from "mounted" is what kills the flicker: with
  // AnimatePresence's exit, the wrapper reset to opacity 1 for one frame right
  // before unmounting (a visible flash). Here the element stays mounted through
  // the whole fade and is unmounted by onAnimationComplete, so opacity only ever
  // moves 1 → 0, never back.
  const [revealed, setRevealed] = useState(false);
  const [splashUp, setSplashUp] = useState(true);
  const [splashMounted, setSplashMounted] = useState(true);
  // Portal target. Starts null so SSR and the first client render agree (no
  // hydration mismatch); the layout effect points it at <body> before paint so
  // the splash escapes <main>'s stacking context and covers the global header,
  // sidebar, and drawers — not just the page content.
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);
  // Decide "hold vs reveal" exactly once. Stored in a ref (not recomputed) so
  // React StrictMode's dev mount→unmount→mount doesn't consume the one-shot
  // sign-in flag twice — the second consume would read false and skip the hold.
  const holdDecisionRef = useRef<boolean | null>(null);

  useIsoLayoutEffect(() => {
    setPortalEl(document.body);

    if (holdDecisionRef.current === null) {
      holdDecisionRef.current = shouldHold ? shouldHold() : true;
    }
    const hold = holdDecisionRef.current;

    const timers: ReturnType<typeof setTimeout>[] = [];
    let cancelled = false;

    const reveal = () => {
      if (cancelled) return;
      setRevealed(true); // mount children behind the (still-visible) splash
      setSplashUp(false); // begin the CSS opacity fade-out
      // Unmount only AFTER the fade has fully finished — primarily via the
      // element's own `transitionend` (precise), with this timer as a generous
      // fallback in case the transition never starts/ends (e.g. the heavy child
      // mount delays first paint, or reduced-motion zeroes the duration). Either
      // way the opacity-0 class stays applied until the node is removed, so
      // opacity never reverts to 1 — no end-of-fade flash.
      timers.push(
        setTimeout(() => {
          if (!cancelled) setSplashMounted(false);
        }, fadeMs + 1500),
      );
    };

    if (!hold) {
      reveal();
      return () => {
        cancelled = true;
        timers.forEach(clearTimeout);
      };
    }

    const startedAt = Date.now();
    const revealAfterMin = () => {
      const elapsed = Date.now() - startedAt;
      timers.push(setTimeout(reveal, Math.max(0, minDurationMs - elapsed)));
    };

    // Warm everything in parallel; reveal when all settle (success OR error —
    // a failed endpoint shouldn't trap the user) or when the hard cap fires.
    let settled = false;
    const onSettled = () => {
      if (settled || cancelled) return;
      settled = true;
      revealAfterMin();
    };

    // Settle on resolve OR reject — a failed endpoint shouldn't trap the user.
    Promise.resolve(prefetch(queryClient)).then(onSettled, onSettled);
    timers.push(setTimeout(onSettled, timeoutMs));

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
    // Mount-only: props are read via closures and the hold decision is cached in
    // a ref, so re-running (StrictMode) is safe and idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remove the pre-paint bridge splash (injected by BOOT_SPLASH_SCRIPT in
  // app/layout.tsx) once our own React splash is mounted on top. This runs after
  // the commit that set portalEl — i.e. after the portal splash is in the DOM —
  // so removing the identical bridge underneath is seamless, no gap.
  useEffect(() => {
    if (!portalEl) return;
    document.getElementById('__boot_splash_pre')?.remove();
  }, [portalEl]);

  return (
    <>
      {revealed && children}
      {portalEl &&
        splashMounted &&
        createPortal(
          // Plain CSS opacity fade — deliberately NOT framer-motion. framer clears
          // its inline opacity the instant its animation completes (handing the
          // value back), which reverts computed opacity to the CSS default 1 for
          // one frame before React removes the node — a visible end-of-fade flash.
          // A CSS class keeps opacity pinned at 0 right up until the node is
          // unmounted, so there is no revert frame. Held at opacity-100, then a
          // single transition to opacity-0 on reveal; pointer-events-none while
          // fading so it doesn't swallow clicks over the now-live page. No entrance
          // transition (it mounts already at opacity-100), so the hard-nav handoff
          // from the sign-in-side splash stays seamless.
          <div
            className={`fixed inset-0 z-splash transition-opacity ease-out ${
              splashUp ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            style={{ transitionDuration: `${fadeMs}ms` }}
            onTransitionEnd={(e) => {
              // Fires exactly when the fade-out completes (opacity at 0). Guard on
              // the opacity property + the faded state so neither a held splash nor
              // an unrelated transition unmounts it early.
              if (e.propertyName === 'opacity' && !splashUp) setSplashMounted(false);
            }}
          >
            {splash}
          </div>,
          portalEl,
        )}
    </>
  );
}
