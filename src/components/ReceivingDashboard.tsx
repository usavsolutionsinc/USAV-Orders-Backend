'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import ReceivingLinesTable from './station/ReceivingLinesTable';
import { LocalPickupCatalogPanel } from './work-orders/LocalPickupCatalogPanel';
import { ReceivingLineWorkspace } from './receiving/workspace/ReceivingLineWorkspace';
import { ReceivingScanLoader } from './receiving/workspace/ReceivingScanLoader';
import { ReceivingDetailsStack, type ReceivingDetailsLog } from './station/ReceivingDetailsStack';
import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';
import { useRealtimeToasts } from '@/hooks/useRealtimeToasts';
import { useAuth } from '@/contexts/AuthContext';
import { dispatchReceivingWorkspaceClose } from '@/utils/events';
import type { ReceivingLineRow } from './station/ReceivingLinesTable';

interface WorkspaceState {
  row: ReceivingLineRow;
  accordionBootstrap: 'default' | 'all';
  scanDriven: boolean;
}

interface NavState {
  currentIndex: number;
  total: number;
  canPrev: boolean;
  canNext: boolean;
}

/**
 * Right-pane renderer for `/receiving`. Headerless — driven entirely by the
 * sidebar's mode pills (`?mode=receive|pickup`) + selection state.
 *
 *   ?mode=pickup            → LocalPickupCatalogPanel (catalog history)
 *   workspace open          → ReceivingLineWorkspace (focused line editor)
 *   no selection, receive   → ReceivingLinesTable (history)
 *
 * The workspace crossfades over the table when a line is selected and back
 * to the table when it closes — same pattern the `/tech` page uses.
 */
export default function ReceivingDashboard() {
  useRealtimeInvalidation({ receiving: true });
  useRealtimeToasts('receiving');
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode') ?? 'receive';
  const isPickupMode = mode === 'pickup';
  // History mode forces the table view regardless of whether a workspace
  // happens to be open in component state — switching back to Receiving
  // restores the workspace, so unfinished edits survive a quick peek at
  // history.
  const isHistoryMode = mode === 'history';
  const prefersReducedMotion = useReducedMotion();
  const { user } = useAuth();
  const staffId = String(user?.staffId ?? '');

  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [nav, setNav] = useState<NavState | null>(null);
  const [overlayLog, setOverlayLog] = useState<ReceivingDetailsLog | null>(null);
  // Scan-in-flight loader state. Populated by 'receiving-scan-in-flight' and
  // cleared 500ms after 'receiving-scan-resolved' to give the workspace open
  // animation a moment to land (avoids a flash of the empty state).
  const [scanInFlight, setScanInFlight] = useState<
    { tracking: string; startedAt: number } | null
  >(null);

  useEffect(() => {
    const handleOpen = (e: Event) => {
      const detail = (e as CustomEvent<WorkspaceState | null>).detail;
      if (!detail || !detail.row) return;
      setWorkspace(detail);
    };
    const handleClose = () => {
      setWorkspace(null);
      setNav(null);
    };
    const handleUpdate = (e: Event) => {
      const partial = (e as CustomEvent<Partial<ReceivingLineRow> & { id: number }>).detail;
      if (!partial || typeof partial.id !== 'number') return;
      setWorkspace((prev) =>
        prev && prev.row.id === partial.id
          ? { ...prev, row: { ...prev.row, ...partial } as ReceivingLineRow }
          : prev,
      );
    };
    // Scan-loader events: sidebar dispatches in-flight when lookup-po POSTs,
    // resolved when the response lands. We hold the loader briefly after
    // resolve so the workspace open animation (~180ms) covers the swap.
    let clearTimer: ReturnType<typeof setTimeout> | null = null;
    const handleInFlight = (e: Event) => {
      const detail = (e as CustomEvent<{ tracking: string; startedAt: number }>).detail;
      if (!detail?.tracking) return;
      if (clearTimer) {
        clearTimeout(clearTimer);
        clearTimer = null;
      }
      setScanInFlight({ tracking: detail.tracking, startedAt: detail.startedAt });
    };
    const handleResolved = () => {
      if (clearTimer) clearTimeout(clearTimer);
      clearTimer = setTimeout(() => {
        setScanInFlight(null);
        clearTimer = null;
      }, 500);
    };

    window.addEventListener('receiving-workspace-open', handleOpen);
    window.addEventListener('receiving-workspace-close', handleClose);
    window.addEventListener('receiving-line-updated', handleUpdate);
    window.addEventListener('receiving-scan-in-flight', handleInFlight);
    window.addEventListener('receiving-scan-resolved', handleResolved);
    return () => {
      window.removeEventListener('receiving-workspace-open', handleOpen);
      window.removeEventListener('receiving-workspace-close', handleClose);
      window.removeEventListener('receiving-line-updated', handleUpdate);
      window.removeEventListener('receiving-scan-in-flight', handleInFlight);
      window.removeEventListener('receiving-scan-resolved', handleResolved);
      if (clearTimer) clearTimeout(clearTimer);
    };
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<NavState | null>).detail;
      setNav(detail ?? null);
    };
    window.addEventListener('receiving-workspace-nav-state', handler);
    return () => window.removeEventListener('receiving-workspace-nav-state', handler);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ receivingId: number }>).detail;
      const receivingId = Number(detail?.receivingId);
      if (!Number.isFinite(receivingId) || receivingId <= 0) return;
      void (async () => {
        try {
          const res = await fetch(`/api/receiving/${receivingId}`, { cache: 'no-store' });
          const data = await res.json().catch(() => null);
          const log = data?.success && data.receiving
            ? (data.receiving as ReceivingDetailsLog)
            : null;
          setOverlayLog(log);
        } catch {
          setOverlayLog(null);
        }
      })();
    };
    window.addEventListener('receiving-open-details-overlay', handler);
    return () => window.removeEventListener('receiving-open-details-overlay', handler);
  }, []);

  if (isPickupMode) {
    return (
      <div className="flex h-full w-full overflow-hidden bg-[linear-gradient(180deg,#f8fbfb_0%,#ffffff_16%)]">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <LocalPickupCatalogPanel />
        </div>
      </div>
    );
  }

  // Surface routing (table stays mounted so its data + scroll survive a
  // tab flip; visibility is toggled via display:none):
  //   - Receiving + workspace → workspace overlay (over the hidden table)
  //   - Receiving + no work   → "Scan to start" prompt
  //   - History               → recent-scans table visible; a tracking/PO
  //                             match opens ReceivingDetailsStack as a
  //                             right-side overlay (below).
  const showWorkspace = !!workspace && !isHistoryMode;
  // Scan loader has priority over the empty prompt — the operator just
  // scanned, the workspace is the active surface, the prompt is stale.
  // Once the workspace mounts it covers both; resolved-but-no-workspace
  // (e.g. unmatched without auto-open) drops back to the prompt.
  const showScanLoader = !!scanInFlight && !workspace && !isHistoryMode;
  const showReceivePrompt = !workspace && !isHistoryMode && !showScanLoader;

  return (
    <div className="flex h-full w-full overflow-hidden bg-[linear-gradient(180deg,#f8fbfb_0%,#ffffff_16%)]">
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* History list — always mounted to keep its react-query cache, the
            in-progress search results from a History scan, and its scroll
            position alive across tab flips. Hidden (not unmounted) when the
            operator is in Receiving so the auto-select / first-mount effects
            don't re-fire on every close. */}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ display: isHistoryMode ? 'block' : 'none' }}
          aria-hidden={!isHistoryMode}
        >
          <ReceivingLinesTable />
        </div>

        {/* Scan-in-flight skeleton loader. Shown the moment the operator
            submits a tracking scan; cleared 500ms after the response lands. */}
        {showScanLoader ? (
          <div className="absolute inset-0 overflow-hidden">
            <ReceivingScanLoader
              tracking={scanInFlight!.tracking}
              startedAt={scanInFlight!.startedAt}
            />
          </div>
        ) : null}

        {/* Receiving empty-state — deliberate "scan to start" landing so the
            operator knows the tab is for adding new events, not browsing. */}
        {showReceivePrompt ? (
          <div className="absolute inset-0 overflow-hidden">
            <ReceiveEmptyState />
          </div>
        ) : null}

        {/* Workspace — overlays everything when a line is active in
            Receiving. Same pattern Linear/Front use: peek the detail over
            the persistent list rather than evicting it. */}
        <AnimatePresence initial={false}>
          {showWorkspace ? (
            <motion.div
              key={`workspace-${workspace!.row.id}`}
              initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-0 z-10"
            >
              <ReceivingLineWorkspace
                row={workspace!.row}
                staffId={staffId}
                accordionBootstrap={workspace!.accordionBootstrap}
                scanDriven={workspace!.scanDriven}
                nav={nav}
                onPrev={() => {
                  window.dispatchEvent(
                    new CustomEvent('receiving-navigate-table', { detail: 'prev' }),
                  );
                }}
                onNext={() => {
                  window.dispatchEvent(
                    new CustomEvent('receiving-navigate-table', { detail: 'next' }),
                  );
                }}
                onClose={() => {
                  setWorkspace(null);
                  setNav(null);
                  dispatchReceivingWorkspaceClose();
                  window.dispatchEvent(new CustomEvent('receiving-clear-line'));
                  // Close goes back to the History tab — gives the operator
                  // a clear "return to the list" landing.
                  const params = new URLSearchParams(searchParams.toString());
                  params.set('mode', 'history');
                  router.replace(`/receiving?${params.toString()}`);
                }}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {overlayLog ? (
          <ReceivingDetailsStack
            log={overlayLog}
            onClose={() => setOverlayLog(null)}
            onUpdated={() => setOverlayLog(null)}
            onDeleted={() => setOverlayLog(null)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/**
 * Receiving-tab empty state: deliberate "scan to start" prompt so the
 * operator's first impression of the tab matches its purpose (adding new
 * receiving events). Sidebar contains the scan input + the Recent rail —
 * this surface just frames the next-step instruction.
 */
function ReceiveEmptyState() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-gray-50/60 px-6">
      <div className="max-w-md rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-7 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h4v4H4V4zm6 0h1v4h-1V4zm3 0h1v4h-1V4zm3 0h1v4h-1V4zm3 0h1v4h-1V4zM4 16h4v4H4v-4zm6 0h1v4h-1v-4zm3 0h1v4h-1v-4zm3 0h1v4h-1v-4zm3 0h1v4h-1v-4z" />
          </svg>
        </div>
        <p className="text-micro font-black uppercase tracking-[0.18em] text-gray-400">
          Ready to receive
        </p>
        <h2 className="mt-1 text-base font-extrabold tracking-tight text-gray-900">
          Scan a new tracking number to start
        </h2>
        <p className="mt-2 text-label font-semibold leading-snug text-gray-600">
          Or pick a recent PO from the sidebar to update it. Flip to{' '}
          <span className="font-black text-gray-900">History</span> from the
          sidebar to browse and search past entries.
        </p>
      </div>
    </div>
  );
}

