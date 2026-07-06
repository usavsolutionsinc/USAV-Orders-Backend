'use client';

/**
 * Selection hub for the receiving sidebar — the source of truth for the line
 * the operator is working: `selectedLine`, the sibling `scanMatchedRows`, the
 * accordion bootstrap mode, and the scan-driven flag.
 *
 * Owns every INBOUND window-event bridge that mutates the selection (table row
 * clicks, line/package updates, workspace open, full deselect, line/carton
 * deletes) plus the on-mode-switch converge-to-empty. The OUTBOUND workspace
 * dispatch (open/close + nav-state) lives in useReceivingWorkspaceBridge so it
 * can read the navigation hook's derived values. Extracted from
 * ReceivingSidebarPanel; behaviour is unchanged.
 */

import { useEffect, useRef, useState } from 'react';
import { toast } from '@/lib/toast';
import {
  dispatchReceivingDetailsOverlay,
} from '@/utils/events';
import { receivingLineRowToDetailsSeed } from '@/lib/receiving/receiving-details-overlay';
import {
  readSelectLineDetail,
  type ReceivingMode,
  type ReceivingSelectLineDetail,
} from '@/components/sidebar/receiving/receiving-sidebar-shared';
import { mergeReceivingPackageMetaIntoRow } from '@/components/station/receiving-lines-table-helpers';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

interface UseReceivingSelectionArgs {
  mode: ReceivingMode;
  /** Reset the full scan session (PO context + serial inputs). */
  clearScanSession: () => void;
}

export interface ReceivingSelectionState {
  selectedLine: ReceivingLineRow | null;
  setSelectedLine: React.Dispatch<React.SetStateAction<ReceivingLineRow | null>>;
  scanMatchedRows: ReceivingLineRow[];
  setScanMatchedRows: React.Dispatch<React.SetStateAction<ReceivingLineRow[]>>;
  /** `'all'` when the line was chosen from the main table — expands FlowSections. */
  lineAccordionBootstrap: 'default' | 'all';
  setLineAccordionBootstrap: React.Dispatch<React.SetStateAction<'default' | 'all'>>;
  /** True when a scan (not a row click) opened the line → LineEditPanel compact. */
  scanDriven: boolean;
  setScanDriven: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useReceivingSelection({
  mode,
  clearScanSession,
}: UseReceivingSelectionArgs): ReceivingSelectionState {
  const [selectedLine, setSelectedLine] = useState<ReceivingLineRow | null>(null);
  const [lineAccordionBootstrap, setLineAccordionBootstrap] = useState<'default' | 'all'>(
    'default',
  );
  const [scanDriven, setScanDriven] = useState(false);
  const [scanMatchedRows, setScanMatchedRows] = useState<ReceivingLineRow[]>([]);

  // Workspace X-button → clear our own state so both panes converge on empty.
  useEffect(() => {
    const handler = () => {
      setSelectedLine(null);
      setLineAccordionBootstrap('default');
      setScanDriven(false);
      setScanMatchedRows([]);
      clearScanSession();
    };
    window.addEventListener('receiving-workspace-close', handler);
    return () => window.removeEventListener('receiving-workspace-close', handler);
    // clearScanSession is a stable useCallback — referenced in the handler, not
    // synchronously; mounting once mirrors the original empty-deps effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `receiving-clear-line` is a full deselect signal — fired on mode switch and
  // when the triage Found/Unfound sub-view changes. Clear the panel's selection
  // too (not just the right pane) so the rail highlight resets and the new
  // list/sub-list auto-selects its own top instead of pinning the prior pick.
  useEffect(() => {
    const handler = () => {
      setSelectedLine(null);
      setScanDriven(false);
      setScanMatchedRows([]);
      clearScanSession();
    };
    window.addEventListener('receiving-clear-line', handler);
    return () => window.removeEventListener('receiving-clear-line', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Line deleted (e.g. last item removed from a carton) → if it was the active
  // line, converge both panes on empty so the Recent rail can't re-pin it from
  // the stale `selectedLine`. Read the id from a ref to avoid re-subscribing on
  // every selection change.
  const selectedLineRef = useRef<ReceivingLineRow | null>(selectedLine);
  selectedLineRef.current = selectedLine;
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<{ id?: number }>).detail?.id;
      if (typeof id !== 'number') return;
      setScanMatchedRows((rows) => rows.filter((r) => r.id !== id));
      if (selectedLineRef.current?.id === id) {
        window.dispatchEvent(new CustomEvent('receiving-workspace-close'));
      }
    };
    window.addEventListener('receiving-line-deleted', handler);
    return () => window.removeEventListener('receiving-line-deleted', handler);
  }, []);

  // Whole carton (receiving log) deleted from the detail panel → if the active
  // line belongs to it, converge both panes on empty so the Recent rail can
  // auto-select the most-recent survivor.
  useEffect(() => {
    const handler = (e: Event) => {
      const cartonId = Number((e as CustomEvent<unknown>).detail);
      if (!Number.isFinite(cartonId)) return;
      setScanMatchedRows((rows) => rows.filter((r) => r.receiving_id !== cartonId));
      if (selectedLineRef.current?.receiving_id === cartonId) {
        window.dispatchEvent(new CustomEvent('receiving-workspace-close'));
      }
    };
    window.addEventListener('receiving-entry-deleted', handler);
    return () => window.removeEventListener('receiving-entry-deleted', handler);
  }, []);

  // ─── Selected line from table row click ──────────────────────────────────
  // The listener is mounted once and reads `mode` via a ref so it always sees
  // the current pill value — without the ref, a History-mode click captured
  // the original closure and tried to open the workspace.
  const modeRef = useRef<ReceivingMode>(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    const handleSelect = (e: Event) => {
      const { row, expandFlowSections } = readSelectLineDetail(
        (e as CustomEvent<ReceivingSelectLineDetail>).detail,
      );
      // History mode: row click is read-only. Open the existing details
      // overlay (ReceivingDetailsStack) instead of mutating sidebar state.
      //
      // Read mode from window.location.search (not modeRef) so a mid-flight
      // URL flip — e.g. Edit PO setting ?mode=receive immediately before
      // dispatching select — is honored. The ref lags by a render and
      // would route the operator back into a fresh details stack.
      const liveMode =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('mode')
          : modeRef.current;
      if (liveMode === 'history') {
        // History is read-only: the only thing a row click does is open the
        // carton details overlay, which is keyed on receiving_id. A row with no
        // receiving_id has no carton to open — stop here with feedback so the
        // click is deterministic instead of a silent dead click.
        if (row?.receiving_id != null) {
          dispatchReceivingDetailsOverlay(row.receiving_id, receivingLineRowToDetailsSeed(row));
        } else if (row != null) {
          toast.info('No receiving record for this row yet');
        }
        return;
      }
      const expand = Boolean(row != null && expandFlowSections);
      setLineAccordionBootstrap(expand ? 'all' : 'default');
      setSelectedLine(row);
      // Row clicks always open the full LineEditPanel (scan-driven → compact).
      setScanDriven(false);
      setScanMatchedRows([]);
    };
    const handleUpdated = (e: Event) => {
      const updated = (e as CustomEvent<Partial<ReceivingLineRow> & { id: number }>).detail;
      if (!updated || typeof updated.id !== 'number') return;
      setSelectedLine((prev) => (prev?.id === updated.id ? { ...prev, ...updated } : prev));
      setScanMatchedRows((rows) =>
        rows.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)),
      );
    };
    const handlePackageMeta = (e: Event) => {
      const detail = (e as CustomEvent<Parameters<typeof mergeReceivingPackageMetaIntoRow>[1]>).detail;
      if (!detail || detail.receiving_id == null) return;
      setSelectedLine((prev) => {
        if (!prev || prev.receiving_id !== detail.receiving_id) return prev;
        return mergeReceivingPackageMetaIntoRow(prev, detail) ?? prev;
      });
      setScanMatchedRows((rows) =>
        rows.map((r) => mergeReceivingPackageMetaIntoRow(r, detail) ?? r),
      );
    };
    // Mirror selectedLine from workspace-open events so the rail highlights
    // restored lines (localStorage + most-recent fallback go directly through
    // dispatchReceivingWorkspaceOpen, bypassing handleSelect). Id-compare guards
    // the setState→workspace-open useEffect from looping.
    const handleWorkspaceOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ row?: ReceivingLineRow } | null>).detail;
      const row = detail?.row;
      if (!row || typeof row.id !== 'number') return;
      // History/Incoming are table-only — never mirror a workspace pick into
      // sidebar selection while those modes are active (prevents a stale open
      // event from re-arming the unbox bridge after a mode flip).
      const liveMode =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('mode')
          : modeRef.current;
      if (liveMode === 'history' || liveMode === 'incoming') return;
      setSelectedLine((prev) => (prev?.id === row.id ? prev : row));
    };
    window.addEventListener('receiving-select-line', handleSelect);
    window.addEventListener('receiving-line-updated', handleUpdated);
    window.addEventListener('receiving-package-updated', handlePackageMeta);
    window.addEventListener('receiving-workspace-open', handleWorkspaceOpen);
    return () => {
      window.removeEventListener('receiving-select-line', handleSelect);
      window.removeEventListener('receiving-line-updated', handleUpdated);
      window.removeEventListener('receiving-package-updated', handlePackageMeta);
      window.removeEventListener('receiving-workspace-open', handleWorkspaceOpen);
    };
  }, []);

  // Selection must NOT carry across modes. On a genuine mode SWITCH (not the
  // initial mount — that would clobber a deep-linked carton), converge both
  // panes on empty so the new mode re-renders fresh and its rail auto-selects
  // the top of its OWN queue.
  const prevModeForResetRef = useRef<ReceivingMode | null>(null);
  useEffect(() => {
    const prev = prevModeForResetRef.current;
    prevModeForResetRef.current = mode;
    if (prev === null || prev === mode) return;
    setSelectedLine(null);
    setLineAccordionBootstrap('default');
    setScanDriven(false);
    setScanMatchedRows([]);
    clearScanSession();
    window.dispatchEvent(new CustomEvent('receiving-clear-line'));
  }, [mode, clearScanSession]);

  return {
    selectedLine,
    setSelectedLine,
    scanMatchedRows,
    setScanMatchedRows,
    lineAccordionBootstrap,
    setLineAccordionBootstrap,
    scanDriven,
    setScanDriven,
  };
}
