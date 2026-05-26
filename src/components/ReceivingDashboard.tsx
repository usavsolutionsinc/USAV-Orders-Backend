'use client';

import { useEffect, useRef, useState } from 'react';
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
import {
  dispatchReceivingWorkspaceClose,
  dispatchReceivingWorkspaceOpen,
} from '@/utils/events';
import type { ReceivingLineRow } from './station/ReceivingLinesTable';

/**
 * Remembers the last line the operator had open so a hard refresh lands
 * them back in the same workspace instead of an empty pane. localStorage
 * (vs sessionStorage / URL / server pref) keeps the read synchronous so
 * the restore can fire from a single mount effect, survives crashes and
 * closed tabs, and stays per-device — operators sharing a login on
 * different stations don't pull each other's last view.
 */
const LAST_RECEIVING_LINE_KEY = 'usav:receiving:last-line-id';

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
      try {
        window.localStorage.setItem(
          LAST_RECEIVING_LINE_KEY,
          String(detail.row.id),
        );
      } catch {
        /* private mode / quota — non-fatal */
      }
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

  // Restore the last opened line on mount. Ref-guards against racing with a
  // scan-driven open that beats us to the workspace (we'd otherwise overwrite
  // the fresher row with a stale restore).
  const workspaceRef = useRef<WorkspaceState | null>(null);
  workspaceRef.current = workspace;
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(LAST_RECEIVING_LINE_KEY);
    } catch {
      return;
    }
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/receiving-lines?id=${id}&include=serials`,
          { cache: 'no-store' },
        );
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!data?.success || !data.receiving_line) {
          // Line was deleted or no longer accessible — drop the stale key so
          // we don't spin on every refresh.
          try {
            window.localStorage.removeItem(LAST_RECEIVING_LINE_KEY);
          } catch {
            /* non-fatal */
          }
          return;
        }
        if (workspaceRef.current) return;
        dispatchReceivingWorkspaceOpen({
          row: data.receiving_line as ReceivingLineRow,
          accordionBootstrap: 'default',
          scanDriven: false,
        });
      } catch {
        /* network blip — try again on next refresh */
      }
    })();
    return () => {
      cancelled = true;
    };
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
  // Scan loader covers the gap between the operator's scan and the
  // workspace mounting. There's no longer a separate "scan to start"
  // placeholder — on mount we restore the last opened line from
  // localStorage, so a fresh load lands directly in the workspace.
  const showScanLoader = !!scanInFlight && !workspace && !isHistoryMode;

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

