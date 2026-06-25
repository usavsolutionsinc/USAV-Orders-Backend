'use client';

/**
 * Right-pane workspace orchestration for `/receiving`. Owns the focused-line
 * workspace state, the prev/next nav mirror, and the scan-in-flight loader, and
 * keeps the pane authoritative across the full lifecycle:
 *   - workspace open/close/update + nav-state (dispatched by the sidebar)
 *   - the skeleton loader's grace-delay show / lingered clear around a scan
 *   - "never blank" auto-open of the most-recent line in Unbox mode
 *   - delete recovery (line or whole carton) onto the next survivor
 *
 * Reads the live `?mode=` so a client-side mode switch is honored without a
 * render lag. Extracted from ReceivingDashboard; behaviour is unchanged.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { dispatchReceivingWorkspaceClose } from '@/utils/events';
import {
  dispatchSelectLine,
  type ReceivingLineRow,
} from '@/components/station/ReceivingLinesTable';

export interface WorkspaceState {
  row: ReceivingLineRow;
  accordionBootstrap: 'default' | 'all';
  scanDriven: boolean;
}

export interface NavState {
  currentIndex: number;
  total: number;
  canPrev: boolean;
  canNext: boolean;
}

export interface ReceivingWorkspacePane {
  workspace: WorkspaceState | null;
  setWorkspace: React.Dispatch<React.SetStateAction<WorkspaceState | null>>;
  nav: NavState | null;
  setNav: React.Dispatch<React.SetStateAction<NavState | null>>;
  scanInFlight: { tracking: string; startedAt: number } | null;
}

export function useReceivingWorkspacePane(): ReceivingWorkspacePane {
  const searchParams = useSearchParams();
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [nav, setNav] = useState<NavState | null>(null);
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
    // resolved when the response lands. We hold the loader briefly after resolve
    // so the workspace open animation (~180ms) covers the swap.
    let clearTimer: ReturnType<typeof setTimeout> | null = null;
    // Grace delay before the full "Opening your PO" takeover mounts. A scan that
    // resolves locally (already in incoming/mirror state, a deduped re-scan, or
    // an adopted PO with no Zoho round-trip) comes back under this threshold, so
    // the row flips inline and the loader never flashes. Only a genuine cold Zoho
    // lookup outlives the delay and shows the skeleton. (Standard skeleton-delay
    // pattern: never flash a loader for sub-threshold latencies.)
    const SCAN_LOADER_GRACE_MS = 300;
    let showTimer: ReturnType<typeof setTimeout> | null = null;
    const handleInFlight = (e: Event) => {
      const detail = (e as CustomEvent<{ tracking: string; startedAt: number }>).detail;
      if (!detail?.tracking) return;
      if (clearTimer) {
        clearTimeout(clearTimer);
        clearTimer = null;
      }
      if (showTimer) clearTimeout(showTimer);
      showTimer = setTimeout(() => {
        setScanInFlight({ tracking: detail.tracking, startedAt: detail.startedAt });
        showTimer = null;
      }, SCAN_LOADER_GRACE_MS);
    };
    const handleResolved = () => {
      // Resolved before the grace delay elapsed → fast/local/deduped lookup;
      // cancel the pending show so the takeover never appears. If it already
      // showed (slow Zoho path), let it linger briefly so the workspace-open
      // animation covers the swap.
      if (showTimer) {
        clearTimeout(showTimer);
        showTimer = null;
      }
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
      if (showTimer) clearTimeout(showTimer);
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

  // Deep-link: cmd+k emits /receiving?mode=receive&openReceivingId=<receiving.id>.
  // Resolve that carton's first line (receiving.id → /api/receiving-lines
  // ?receiving_id=) and select it once via dispatchSelectLine, so the right pane
  // opens AND the sidebar/rail highlight stay in sync. Best-effort: a missing or
  // empty carton just no-ops, and the "never blank" effect (which is deferred
  // while the param is present) resumes once it clears from the URL.
  const deepLinkedReceivingRef = useRef<string | null>(null);
  useEffect(() => {
    const target = searchParams.get('openReceivingId');
    if (!target || !/^\d+$/.test(target)) return;
    if (deepLinkedReceivingRef.current === target) return;
    deepLinkedReceivingRef.current = target;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/receiving-lines?receiving_id=${target}&include=serials`,
          { cache: 'no-store' },
        );
        const data = res.ok ? await res.json().catch(() => null) : null;
        const rows = Array.isArray(data?.receiving_lines)
          ? (data.receiving_lines as ReceivingLineRow[])
          : [];
        if (!cancelled && rows[0]) dispatchSelectLine(rows[0]);
      } catch {
        /* deep-link is best-effort; a network blip just no-ops */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  // Keep the right pane from ever sitting BLANK in Unbox/Receive mode: open the
  // MOST RECENT unboxing line — the same row the Recent rail auto-selects from
  // its `view=activity` query — whenever nothing is open. Re-runs on `workspace`
  // so it covers first mount, a workspace close, and a client-side mode switch
  // back to Unbox.
  //
  // Targeting the most-recent row (not a localStorage "last opened") means BOTH
  // this effect and the rail's auto-select resolve to the SAME line, so the
  // outcome is deterministic regardless of which fires first. Uses
  // dispatchSelectLine so the sidebar selectedLine + rail highlight stay in sync.
  const workspaceRef = useRef<WorkspaceState | null>(null);
  workspaceRef.current = workspace;
  // Guards the "never blank" effect while a delete-recovery is choosing the next
  // line, so the two don't race and momentarily reopen the just-deleted line.
  const recoveringRef = useRef(false);
  useEffect(() => {
    const liveMode = searchParams.get('mode') ?? 'receive';
    if (liveMode !== 'receive') return;
    // Defer to the cmd+k deep-link (openReceivingId) for the initial open so the
    // two don't race to fill the pane; resume auto-open once the param clears.
    if (searchParams.get('openReceivingId')) return;
    if (workspace || recoveringRef.current) return;

    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(
          // sort MUST match ReceivingRecentRail's axis (unboxed_newest) so this
          // effect and the rail's auto-select resolve to the SAME "most recent"
          // line.
          `/api/receiving-lines?limit=1&offset=0&view=activity&include=serials&sort=unboxed_newest`,
          { cache: 'no-store' },
        );
        const data = await res.json().catch(() => null);
        // Re-check after the await: the rail's auto-select (or an operator click)
        // may have already opened a workspace — never clobber it.
        if (cancelled || workspaceRef.current || recoveringRef.current) return;
        const rows = Array.isArray(data?.receiving_lines)
          ? (data.receiving_lines as ReceivingLineRow[])
          : [];
        const recent = rows[0] ?? null;
        if (recent) dispatchSelectLine(recent);
      } catch {
        /* network blip — the rail's auto-select still covers the common case */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams, workspace]);

  // Recover the right pane after the line it's showing is removed — the single
  // line, or the whole carton it belongs to. In Receive mode, drop onto the
  // most-recent remaining activity line (skipping anything just deleted);
  // otherwise fall back to an empty pane.
  const recoverRightPane = useCallback(
    (isDeleted: (row: ReceivingLineRow) => boolean) => {
      // Own the next pick so the "never blank" effect doesn't race us and reopen
      // the just-deleted line while we look up its replacement.
      recoveringRef.current = true;
      // Clear immediately so the dead line can't linger during the lookup.
      setWorkspace(null);
      setNav(null);
      if ((searchParams.get('mode') ?? 'receive') !== 'receive') {
        recoveringRef.current = false;
        dispatchReceivingWorkspaceClose();
        return;
      }
      void (async () => {
        try {
          const res = await fetch(
            `/api/receiving-lines?limit=5&offset=0&view=activity&include=serials&sort=unboxed_newest`,
            { cache: 'no-store' },
          );
          const data = await res.json().catch(() => null);
          const rows = Array.isArray(data?.receiving_lines)
            ? (data.receiving_lines as ReceivingLineRow[])
            : [];
          // Guard against an eventually-consistent read still returning the
          // just-deleted line/carton — never re-open something we removed.
          const next = rows.find((r) => !isDeleted(r)) ?? null;
          if (workspaceRef.current) return; // operator already moved on
          if (next) dispatchSelectLine(next);
          else dispatchReceivingWorkspaceClose();
        } catch {
          dispatchReceivingWorkspaceClose();
        } finally {
          recoveringRef.current = false;
        }
      })();
    },
    [searchParams],
  );

  // Single line removed (e.g. last item pulled from an unmatched carton).
  useEffect(() => {
    const handler = (e: Event) => {
      const deletedId = (e as CustomEvent<{ id?: number }>).detail?.id;
      if (typeof deletedId !== 'number') return;
      if (workspaceRef.current?.row.id !== deletedId) return;
      recoverRightPane((r) => r.id === deletedId);
    };
    window.addEventListener('receiving-line-deleted', handler);
    return () => window.removeEventListener('receiving-line-deleted', handler);
  }, [recoverRightPane]);

  // Whole carton (receiving log) removed via the detail panel. Carries the
  // carton id as a bare-number detail. If the line on screen belongs to it, jump
  // to the most-recent survivor.
  useEffect(() => {
    const handler = (e: Event) => {
      const cartonId = Number((e as CustomEvent<unknown>).detail);
      if (!Number.isFinite(cartonId)) return;
      if (workspaceRef.current?.row.receiving_id !== cartonId) return;
      recoverRightPane((r) => r.receiving_id === cartonId);
    };
    window.addEventListener('receiving-entry-deleted', handler);
    return () => window.removeEventListener('receiving-entry-deleted', handler);
  }, [recoverRightPane]);

  return { workspace, setWorkspace, nav, setNav, scanInFlight };
}
