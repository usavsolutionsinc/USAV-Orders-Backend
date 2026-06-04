'use client';

/**
 * Right-pane skeleton loader shown while a tracking scan's Zoho lookup is in
 * flight. Replaces the "Ready to receive" empty state so the operator sees
 * activity while the lookup runs.
 *
 * Wiring (see ReceivingDashboard + ReceivingSidebarPanel.submitTrackingScan):
 *   • Sidebar dispatches `receiving-scan-in-flight` with {tracking, startedAt}
 *     the moment lookup-po is POSTed.
 *   • Sidebar dispatches `receiving-scan-resolved` when the response lands
 *     (success OR failure). ReceivingDashboard auto-clears the loader 500ms
 *     after that to give the workspace open animation a moment to land —
 *     prevents a one-frame flash of the empty state during the handoff.
 *
 * Skeleton rows mimic the LineEditPanel hero column shape so the visual
 * transition from "loading" to "loaded" feels continuous, not jarring.
 *
 * Shimmer uses the same .recv-indet-bar keyframes that ReceiveProgressToast
 * (LineEditPanel.tsx:137-157) already uses for the receive-in-progress toast.
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

export interface ReceivingScanLoaderProps {
  /** Tracking number the operator scanned. Shown verbatim in monospace. */
  tracking: string;
  /** Date.now() at scan submission — drives the elapsed counter. */
  startedAt: number;
}

export function ReceivingScanLoader({ tracking, startedAt }: ReceivingScanLoaderProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 250);
    return () => window.clearInterval(interval);
  }, [startedAt]);

  // Monotonic progress: starts at 15%, grows by 15% per second for the first 3s,
  // then slows down (asymptotic) so it never quite hits 100% until the PO 
  // actually resolves and the loader unmounts. Never goes backward.
  const progress = Math.min(98, 15 + (elapsed < 3 ? elapsed * 15 : 45 + (elapsed - 3) * 2));

  // Opaque white surface (not a translucent overlay) so nothing behind bleeds
  // through. The host (ReceivingDashboard) already offsets this below the
  // workspace header chrome when one is mounted, so a plain top pad is all the
  // breathing room the hero card needs.
  return (
    <div className="flex h-full w-full items-start justify-center overflow-y-auto bg-white px-4 pb-6 pt-6">
      <div className="w-full max-w-3xl space-y-4">
        {/* Hero card — the focal point: tracking + status + progress bar */}
        <div className="rounded-2xl border border-gray-200 bg-white px-6 py-7 shadow-sm">
          <p className="text-micro font-black uppercase tracking-[0.18em] text-blue-600">
            Finding your PO
          </p>
          <h2 className="mt-1 text-lg font-extrabold tracking-tight text-gray-900">
            Opening your PO
          </h2>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-sm tracking-wide text-gray-700">
              {tracking}
            </span>
            <span className="text-caption font-semibold tabular-nums text-gray-400">
              · {elapsed}s
            </span>
          </div>

          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-gray-100 ring-1 ring-black/[0.03]">
            <motion.div 
              animate={{ width: `${progress}%` }}
              transition={{ 
                type: 'spring',
                stiffness: 100,
                damping: 20,
                restDelta: 0.001
              }}
              className="relative h-full rounded-full bg-blue-600"
            >
              {/* Aurora sweep — high-performance liquid gradient */}
              <motion.div
                animate={{ left: ['-100%', '200%'] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: 'linear' }}
                className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/40 to-transparent skew-x-12"
              />
            </motion.div>
          </div>
        </div>

        {/* Skeleton frames — mimic LineEditPanel's stack so the transition
            to the real workspace is visually continuous, not a swap. */}
        <SkeletonCard rows={2} />
        <SkeletonCard rows={3} />
        <SkeletonCard rows={2} />
      </div>
    </div>
  );
}

// ─── Subcomponent (module-scope per rerender-no-inline-components) ───────────

interface SkeletonCardProps {
  rows: number;
}

function SkeletonCard({ rows }: SkeletonCardProps) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
      <div className="mb-3 h-2.5 w-24 animate-pulse rounded-full bg-gray-200" />
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="h-3 animate-pulse rounded-full bg-gray-100"
            style={{ width: `${100 - i * 12}%` }}
          />
        ))}
      </div>
    </div>
  );
}
