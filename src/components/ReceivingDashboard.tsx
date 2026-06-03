'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import ReceivingLinesTable, { RECEIVING_SELECTION_SCOPE } from './station/ReceivingLinesTable';
import { usePageSelection } from '@/hooks/usePageHeader';
import { useTableSelection } from '@/hooks/useTableSelection';
import { emitToggleAll } from '@/lib/selection/table-selection';
import { ContextualSelectionBar } from '@/design-system/components/ContextualSelectionBar';
import type { SelectionAction } from '@/lib/selection/selection-actions';
import { ReceivingClaimModal } from './receiving/workspace/ReceivingClaimModal';
import { printProductLabel, printProductLabels } from '@/lib/print/printProductLabel';
import { Copy, Printer, MessageSquare, User, Smartphone } from '@/components/Icons';
import { toast } from '@/lib/toast';
import { LocalPickupCatalogPanel } from './work-orders/LocalPickupCatalogPanel';
import { ReceivingLineWorkspace } from './receiving/workspace/ReceivingLineWorkspace';
import { ReceivingScanLoader } from './receiving/workspace/ReceivingScanLoader';
import { ReceivingDetailsStack, type ReceivingDetailsLog } from './station/ReceivingDetailsStack';
import { IncomingDetailsPanel } from './sidebar/receiving/IncomingDetailsPanel';
import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';
import { useRealtimeToasts } from '@/hooks/useRealtimeToasts';
import { useAuth } from '@/contexts/AuthContext';
import {
  dispatchReceivingWorkspaceClose,
  dispatchReceivingWorkspaceOpen,
} from '@/utils/events';
import {
  dispatchSelectLine,
  type ReceivingLineRow,
} from './station/ReceivingLinesTable';

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
  // History + Incoming both force the table view (hide the workspace
  // overlay) regardless of whether a workspace happens to be open in
  // component state — switching back to Receiving restores the
  // workspace, so unfinished edits survive a quick peek at either tab.
  const isHistoryMode = mode === 'history';
  const isIncomingMode = mode === 'incoming';
  const isTableOnlyMode = isHistoryMode || isIncomingMode;
  const prefersReducedMotion = useReducedMotion();
  const { user } = useAuth();
  const staffId = String(user?.staffId ?? '');

  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [nav, setNav] = useState<NavState | null>(null);
  const [overlayLog, setOverlayLog] = useState<ReceivingDetailsLog | null>(null);
  // Incoming-mode details panel — populated when a row is selected in
  // mode=incoming. Stored as {po_id, po_number} so the panel can render its
  // header label immediately, then re-key its details query on po_id change.
  const [incomingDetails, setIncomingDetails] = useState<
    { poId: string; poNumber: string | null } | null
  >(null);
  // Scan-in-flight loader state. Populated by 'receiving-scan-in-flight' and
  // cleared 500ms after 'receiving-scan-resolved' to give the workspace open
  // animation a moment to land (avoids a flash of the empty state).
  const [scanInFlight, setScanInFlight] = useState<
    { tracking: string; startedAt: number } | null
  >(null);

  // ── Bulk select (History / Incoming list) ──────────────────────────────────
  // The table list is only visible in table-only modes; selection lives there.
  const [selectMode, setSelectMode] = useState(false);
  const selectedRows = useTableSelection<ReceivingLineRow>(
    RECEIVING_SELECTION_SCOPE,
    (r) => r.id,
  );
  // Single-line claim modal opened from the bulk bar's "Create support ticket".
  const [claimRow, setClaimRow] = useState<ReceivingLineRow | null>(null);

  // Leaving the list (back to the receive workspace / pickup) exits select mode.
  useEffect(() => {
    if (!isTableOnlyMode && selectMode) setSelectMode(false);
  }, [isTableOnlyMode, selectMode]);

  const exitSelectMode = useCallback(() => {
    emitToggleAll(RECEIVING_SELECTION_SCOPE, 'none');
    setSelectMode(false);
  }, []);

  const handleCopyDetails = useCallback((rows: ReceivingLineRow[]) => {
    const text = rows
      .map((r) => {
        const po = (r.zoho_purchaseorder_number || r.zoho_purchaseorder_id || '').trim();
        const sku = (r.sku || '').trim();
        const tracking = (r.tracking_number || '').trim();
        return [po && `PO ${po}`, sku && `SKU ${sku}`, tracking && `TRK ${tracking}`]
          .filter(Boolean)
          .join(' • ');
      })
      .filter(Boolean)
      .join('\n');
    void navigator.clipboard?.writeText(text).then(
      () => toast.success(`Copied ${rows.length} line${rows.length === 1 ? '' : 's'}`),
      () => toast.error('Copy failed'),
    );
  }, []);

  // Print one product label per selected line — serial-level when serials are
  // loaded on the row, else a single SKU label. Reuses the same print pipeline
  // as the workspace's Pass + Print.
  const handlePrintLabels = useCallback((rows: ReceivingLineRow[]) => {
    let printed = 0;
    for (const r of rows) {
      const sku = (r.sku || '').trim();
      if (!sku) continue;
      const serials = (r.serials ?? [])
        .map((s) => (s.serial_number || '').trim())
        .filter(Boolean);
      if (serials.length > 0) {
        printProductLabels({ sku, serialNumbers: serials });
        printed += serials.length;
      } else {
        printProductLabel({ sku });
        printed += 1;
      }
    }
    if (printed > 0) toast.success(`Printing ${printed} label${printed === 1 ? '' : 's'}`);
    else toast.error('No SKU on the selected line(s)');
  }, []);

  // Contextual bulk actions for the receiving-history selection. Declared as a
  // SelectionAction[] so the bar derives the CTA + overflow menu + disabled
  // states from the constraints (see ContextualSelectionBar).
  const receivingBulkActions = useMemo<SelectionAction<ReceivingLineRow>[]>(
    () => [
      {
        key: 'copy',
        label: 'Copy details',
        icon: <Copy className="h-4 w-4" />,
        tone: 'blue',
        primary: true,
        run: handleCopyDetails,
      },
      {
        key: 'print',
        label: 'Print labels',
        icon: <Printer className="h-4 w-4" />,
        run: handlePrintLabels,
      },
      {
        key: 'ticket',
        label: 'Create support ticket',
        icon: <MessageSquare className="h-4 w-4" />,
        maxSelected: 1,
        disabledReason: 'Select a single line to file a ticket',
        run: (rows) => {
          if (rows[0]) setClaimRow(rows[0]);
        },
      },
      {
        key: 'staff',
        label: 'Send to staff',
        icon: <User className="h-4 w-4" />,
        enabled: () => false,
        disabledReason: 'Coming next — needs assignment backend',
        run: () => {
          /* disabled until the backend lands */
        },
      },
      {
        key: 'phone',
        label: 'Send to phone',
        icon: <Smartphone className="h-4 w-4" />,
        enabled: () => false,
        disabledReason: 'Coming next — needs phone push channel',
        run: () => {
          /* disabled until the backend lands */
        },
      },
    ],
    [handleCopyDetails, handlePrintLabels],
  );

  // Selection toggle — surfaced as the pencil in the global header's right
  // actions while the list is up. No page title in the header.
  usePageSelection(
    isTableOnlyMode
      ? {
          active: selectMode,
          onToggle: () => (selectMode ? exitSelectMode() : setSelectMode(true)),
        }
      : null,
    [isTableOnlyMode, selectMode, exitSelectMode],
  );

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

  // Incoming-mode row select → open the IncomingDetailsPanel overlay.
  // Listens on the same `receiving-select-line` event the table dispatches;
  // the mode check gates so a select in Receiving keeps opening the workspace.
  useEffect(() => {
    if (!isIncomingMode) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      const row =
        detail && typeof detail === 'object' && 'row' in detail
          ? ((detail as { row: ReceivingLineRow | null }).row)
          : (detail as ReceivingLineRow | null);
      if (!row) {
        setIncomingDetails(null);
        return;
      }
      const poId = (row.zoho_purchaseorder_id || '').trim();
      if (!poId) {
        // Unmatched rows live in their own pill; skip rather than open a
        // broken panel.
        setIncomingDetails(null);
        return;
      }
      setIncomingDetails({
        poId,
        poNumber: row.zoho_purchaseorder_number ?? null,
      });
    };
    window.addEventListener('receiving-select-line', handler);
    return () => window.removeEventListener('receiving-select-line', handler);
  }, [isIncomingMode]);

  // Mode flip → close any open incoming panel so it doesn't leak into Receiving.
  useEffect(() => {
    if (!isIncomingMode) setIncomingDetails(null);
  }, [isIncomingMode]);

  // Restore the last opened line on mount. Two-tier fallback so the right
  // pane is never blank on a fresh visit:
  //   1. localStorage `LAST_RECEIVING_LINE_KEY` — the line the operator was
  //      last on (preferred so a refresh feels like nothing happened).
  //   2. Most-recent line from the same `view=activity` query the Recent rail
  //      uses — first-ever visit, cleared storage, or a deleted line.
  // Uses `dispatchSelectLine` (not a bare workspace-open) so sidebar
  // `selectedLine` and the rail highlight stay in sync with the right pane.
  const workspaceRef = useRef<WorkspaceState | null>(null);
  workspaceRef.current = workspace;
  useEffect(() => {
    const liveMode = searchParams.get('mode') ?? 'receive';
    if (liveMode !== 'receive') return;

    let cancelled = false;

    const openRow = (row: ReceivingLineRow) => {
      if (workspaceRef.current) return;
      dispatchSelectLine(row);
    };

    const fetchMostRecent = async (): Promise<ReceivingLineRow | null> => {
      try {
        const res = await fetch(
          `/api/receiving-lines?limit=1&offset=0&view=activity&include=serials`,
          { cache: 'no-store' },
        );
        const data = await res.json().catch(() => null);
        const rows = Array.isArray(data?.receiving_lines)
          ? (data.receiving_lines as ReceivingLineRow[])
          : [];
        return rows[0] ?? null;
      } catch {
        return null;
      }
    };

    void (async () => {
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(LAST_RECEIVING_LINE_KEY);
      } catch {
        /* private mode — fall through to recent */
      }
      const storedId = Number(stored);
      if (Number.isFinite(storedId) && storedId > 0) {
        try {
          const res = await fetch(
            `/api/receiving-lines?id=${storedId}&include=serials`,
            { cache: 'no-store' },
          );
          const data = await res.json().catch(() => null);
          if (cancelled) return;
          if (data?.success && data.receiving_line) {
            openRow(data.receiving_line as ReceivingLineRow);
            return;
          }
          // Line was deleted or no longer accessible — drop the stale key
          // and fall through to the most-recent fallback.
          try {
            window.localStorage.removeItem(LAST_RECEIVING_LINE_KEY);
          } catch {
            /* non-fatal */
          }
        } catch {
          /* network blip — try the recent fallback before giving up */
        }
      }

      if (cancelled || workspaceRef.current) return;
      const recent = await fetchMostRecent();
      if (cancelled || !recent || workspaceRef.current) return;
      openRow(recent);
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ receivingId: number }>).detail;
      const receivingId = Number(detail?.receivingId);
      if (!Number.isFinite(receivingId) || receivingId <= 0) return;
      void (async () => {
        try {
          const res = await fetch(`/api/receiving/${receivingId}`, { cache: 'no-store' });
          const data = await res.json().catch(() => null);
          if (!data?.success || !data.receiving) {
            setOverlayLog(null);
            return;
          }
          const carton = data.receiving as ReceivingDetailsLog & {
            id?: number | string;
            receiving_tracking_number?: string | null;
          };
          const lines = Array.isArray(data.lines)
            ? (data.lines as Array<{
                zoho_purchaseorder_id?: string | null;
                zoho_purchaseorder_number?: string | null;
                listing_url?: string | null;
              }>)
            : [];
          const first = lines[0];
          const trackingRaw = String(carton.tracking ?? carton.receiving_tracking_number ?? '').trim();
          setOverlayLog({
            ...carton,
            id: String(carton.id ?? receivingId),
            tracking: trackingRaw || carton.tracking,
            zoho_purchaseorder_id:
              first?.zoho_purchaseorder_id != null && String(first.zoho_purchaseorder_id).trim()
                ? String(first.zoho_purchaseorder_id).trim()
                : carton.zoho_purchaseorder_id ?? null,
            zoho_purchaseorder_number:
              first?.zoho_purchaseorder_number != null && String(first.zoho_purchaseorder_number).trim()
                ? String(first.zoho_purchaseorder_number).trim()
                : carton.zoho_purchaseorder_number ?? null,
            listing_url:
              first?.listing_url != null && String(first.listing_url).trim()
                ? String(first.listing_url).trim()
                : carton.listing_url ?? null,
          });
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
  const showWorkspace = !!workspace && !isTableOnlyMode;
  // Scan loader covers the gap between the operator's scan and the
  // workspace mounting. There's no longer a separate "scan to start"
  // placeholder — on mount we restore the last opened line from
  // localStorage, so a fresh load lands directly in the workspace.
  const showScanLoader = !!scanInFlight && !workspace && !isTableOnlyMode;

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
          style={{ display: isTableOnlyMode ? 'block' : 'none' }}
          aria-hidden={!isTableOnlyMode}
        >
          <ReceivingLinesTable selectMode={selectMode} />
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

        {/* Incoming details panel — right slide-over matching the shipped / FBA
            detail panels (fixed 420px + dimmed backdrop, chrome owned by the
            panel itself). A stable key keeps the panel mounted as rows are
            flipped so only the contents swap. Closing dispatches
            `receiving-clear-line` so the table row deselects. */}
        <AnimatePresence initial={false}>
          {isIncomingMode && incomingDetails ? (
            <IncomingDetailsPanel
              key="incoming-details-panel"
              zohoPurchaseOrderId={incomingDetails.poId}
              poNumberHint={incomingDetails.poNumber}
              onClose={() => {
                setIncomingDetails(null);
                window.dispatchEvent(new CustomEvent('receiving-clear-line'));
              }}
            />
          ) : null}
        </AnimatePresence>

        {/* Bulk-selection action bar — pins to the bottom of the list region
            when rows are selected in History / Incoming. */}
        {isTableOnlyMode ? (
          <ContextualSelectionBar
            scope={RECEIVING_SELECTION_SCOPE}
            rows={selectedRows}
            actions={receivingBulkActions}
          />
        ) : null}
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

      {claimRow ? (
        <ReceivingClaimModal
          open
          row={claimRow}
          onClose={() => setClaimRow(null)}
          onTicketCreated={(tk) => {
            toast.success(`Claim filed — ${tk}`);
            setClaimRow(null);
            exitSelectMode();
          }}
        />
      ) : null}
    </div>
  );
}

