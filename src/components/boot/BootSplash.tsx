'use client';

import { motion } from 'framer-motion';
import { motionBezier } from '@/design-system/foundations/motion-framer';

/**
 * Full-screen sign-in splash. Shown by {@link BootGate} from first paint after
 * a fresh sign-in until the dashboard's above-the-fold data has been warmed
 * into the React Query cache — so the page reveals fully painted instead of
 * filling in box-by-box.
 *
 * Visual language matches `RedirectingSplash` in AuthContext (white field,
 * uppercase tracked caption) but with a softer entrance and an indeterminate
 * progress sweep, since this moment lasts a beat longer.
 */
export function BootSplash({ label = 'Loading your workspace' }: { label?: string }) {
  return (
    <div className="fixed inset-0 z-splash flex items-center justify-center bg-white">
      {/* faint dotted field — same texture as the sign-in Shell */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, #000 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
        aria-hidden
      />

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: motionBezier.easeOut }}
        className="relative flex flex-col items-center gap-6"
        role="status"
        aria-live="polite"
      >
        {/* breathing ring around the site favicon */}
        <div className="relative flex h-16 w-16 items-center justify-center">
          <motion.span
            className="absolute inset-0 rounded-2xl border-2 border-gray-200"
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
        <div className="h-1 w-40 overflow-hidden rounded-full bg-gray-100">
          <motion.div
            className="h-full w-1/3 rounded-full bg-slate-900"
            animate={{ x: ['-120%', '320%'] }}
            transition={{ duration: 1.1, ease: 'easeInOut', repeat: Infinity }}
          />
        </div>

        <p className="text-caption font-bold uppercase tracking-widest text-gray-400">
          {label}…
        </p>
      </motion.div>
    </div>
  );
}
