'use client';

import { motion } from 'framer-motion';

/**
 * Full-screen sign-in splash. Shown by {@link BootGate} from first paint after
 * a fresh sign-in until the dashboard's above-the-fold data has been warmed
 * into the React Query cache — so the page reveals fully painted instead of
 * filling in box-by-box.
 *
 * Visual language matches `RedirectingSplash` in AuthContext (white field,
 * uppercase tracked caption) plus an indeterminate progress sweep, since this
 * moment lasts a beat longer.
 *
 * Paints settled (no entrance fade) so it's seamless across the sign-in → dest
 * hard navigation — see the `initial={false}` note below.
 */
export function BootSplash({ label = 'Loading your workspace' }: { label?: string }) {
  return (
    <div className="fixed inset-0 z-splash flex items-center justify-center bg-surface-card">
      {/* faint dotted field — same texture as the sign-in Shell */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, #000 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
        aria-hidden
      />

      {/*
        `initial={false}` — paint settled (opacity 1), never fade the whole panel
        in. This splash brackets a HARD navigation (sign-in → window.location.assign
        → destination), so two separate BootSplash instances exist: one on the
        sign-in page, one on the destination. A mount-entrance (opacity 0 → 1) would
        replay on the second instance, flashing the panel back to transparent right
        after the first one finished — the "Loading your workspace appears twice"
        flicker. Painting settled makes every instance identical and idempotent
        across the document swap, so the handoff is seamless. The breathing ring and
        sweep below stay animated (an ambient loop restart is imperceptible; a
        whole-panel re-fade is not). The fade-OUT on reveal is owned by BootGate's
        AnimatePresence wrapper, not here.
      */}
      <motion.div
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        className="relative flex flex-col items-center gap-6"
        role="status"
        aria-live="polite"
      >
        {/* breathing ring around the site favicon */}
        <div className="relative flex h-16 w-16 items-center justify-center">
          <motion.span
            className="absolute inset-0 rounded-2xl border-2 border-border-soft"
            animate={{ scale: [1, 1.12, 1], opacity: [0.6, 0.15, 0.6] }}
            transition={{ duration: 1.8, ease: 'easeInOut', repeat: Infinity }}
            aria-hidden
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/favicon.png"
            alt=""
            width={44}
            height={44}
            className="rounded-xl"
            aria-hidden
          />
        </div>

        {/* indeterminate sweep */}
        <div className="h-1 w-40 overflow-hidden rounded-full bg-surface-sunken">
          <motion.div
            className="h-full w-1/3 rounded-full bg-surface-inverse"
            animate={{ x: ['-120%', '320%'] }}
            transition={{ duration: 1.1, ease: 'easeInOut', repeat: Infinity }}
          />
        </div>

        <p className="text-caption font-bold uppercase tracking-widest text-text-faint">
          {label}…
        </p>
      </motion.div>
    </div>
  );
}
