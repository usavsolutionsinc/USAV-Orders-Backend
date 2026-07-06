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
import { ReceivingWorkspaceSkeletonSections } from './ReceivingWorkspaceSkeleton';
import { RECEIVING_WORKSPACE_BODY_COLUMN } from './receiving-workspace-layout';

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
    <div className="flex h-full w-full flex-col overflow-y-auto bg-surface-card">
      <div className={RECEIVING_WORKSPACE_BODY_COLUMN}>
        {/* Hero card — the focal point: tracking + status + progress bar */}
        <div className="rounded-2xl border border-border-soft bg-surface-card px-6 py-7 shadow-sm">
          <p className="text-micro font-black uppercase tracking-[0.18em] text-blue-600">
            Finding your PO
          </p>
          <h2 className="mt-1 text-lg font-extrabold tracking-tight text-text-default">
            Opening your PO
          </h2>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-sm tracking-wide text-text-muted">
              {tracking}
            </span>
            <span className="text-caption font-semibold tabular-nums text-text-faint">
              · {elapsed}s
            </span>
          </div>

          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-surface-sunken ring-1 ring-black/[0.03]">
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
        <ReceivingWorkspaceSkeletonSections />
      </div>
    </div>
  );
}
