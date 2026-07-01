'use client';

/**
 * URL ⇄ state for the receiving sidebar's mode switcher and Unbox sub-view.
 *
 * The sidebar-mode contract keeps `mode` / `unboxview` / `triview` in the URL so
 * a refresh or deep-link is preserved. This hook centralizes the parsing + the
 * `router.replace` navigation helpers, and fires the cross-pane focus/clear
 * events that a mode change implies. Extracted from ReceivingSidebarPanel;
 * behaviour is unchanged.
 */

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { clearReceivingHistoryUrlParams } from '@/lib/receiving-history-search';
import type { ReceivingMode } from '@/components/sidebar/receiving/receiving-sidebar-shared';
import {
  resolveTriageView,
  type TriageView,
} from '@/components/sidebar/receiving/TriageSidebarBody';

export type UnboxView = 'recent' | 'queue' | 'viewed';

/**
 * Sub-view + filter params that belong to exactly one mode. Stripped on every
 * mode switch so a selection from mode A never bleeds into mode B (the project's
 * cross-mode isolation rule): `unboxview` (receive), `triview` (triage),
 * `incview` + the Incoming filter set `state`/`sort`/`po_from`/`po_to`/`page`
 * (incoming). History's own params (`q`/`field`/`scope`) keep their
 * entering-history carve-out via `clearReceivingHistoryUrlParams`.
 */
const MODE_SCOPED_PARAMS = [
  'unboxview',
  'triview',
  'incview',
  'state',
  'sort',
  'po_from',
  'po_to',
  'page',
  // Triage's carton-list filter (D1, docs/receiving-triage-redesign-plan.md
  // §0.6). A separate param from History's own `q` (kept independent so this
  // change can't touch History's existing q/field/scope deep-link handling).
  'triq',
] as const;

export interface ReceivingModeState {
  /** Active sidebar mode parsed from `?mode=` (defaults to `receive`). */
  mode: ReceivingMode;
  /** Unbox sub-view from `?unboxview=` (defaults to `recent`). */
  unboxView: UnboxView;
  /** Triage sub-view from `?triview=` (defaults to `triage`). */
  triageView: TriageView;
  /** Triage carton-list filter text from `?triq=` (D1 — finds a carton already scanned in, not a Zoho search). */
  triageQuery: string;
  /**
   * True for the two surfaces that show the scan bar + recent rail
   * (`receive` = Unbox workspace, `triage` = Receiving). Only the right pane
   * differs between them.
   */
  isScanSurface: boolean;
  /** Swap the `?mode=` param (clears History params when leaving History). */
  updateMode: (next: ReceivingMode) => void;
  /** Set the `?staffId=` param. */
  updateStaff: (id: number) => void;
  /** Swap the Unbox `?unboxview=` sub-view. Clears the current line by default. */
  updateUnboxView: (next: UnboxView, opts?: { clearLine?: boolean }) => void;
  /** Swap the Triage `?triview=` sub-view (clears the current line first). */
  updateTriageView: (next: TriageView) => void;
  /** Set (or clear, on empty string) the Triage `?triq=` carton-list filter. */
  updateTriageQuery: (next: string) => void;
}

export function useReceivingMode(): ReceivingModeState {
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawMode = searchParams.get('mode');
  const mode: ReceivingMode =
    rawMode === 'pickup'
      ? 'pickup'
      : rawMode === 'history'
        ? 'history'
        : rawMode === 'incoming'
          ? 'incoming'
          : rawMode === 'triage'
            ? 'triage'
            : 'receive';

  // Triage (label "Receiving") shares the scan-bar + recent-rail sidebar body
  // with the Unbox workspace (`receive`); only the right pane differs.
  const isScanSurface = mode === 'receive' || mode === 'triage';

  const unboxView: UnboxView =
    searchParams.get('unboxview') === 'queue'
      ? 'queue'
      : searchParams.get('unboxview') === 'viewed'
        ? 'viewed'
        : 'recent';

  const triageView = resolveTriageView(searchParams.get('triview'));
  const triageQuery = searchParams.get('triq') ?? '';

  // Returning to a scan surface from History / Pickup / Incoming → focus the
  // tracking field. Entering Pickup → clear any open line. The scan-bar +
  // selection hooks listen for these events.
  useEffect(() => {
    if (mode === 'pickup') {
      window.dispatchEvent(new CustomEvent('receiving-clear-line'));
    }
    if (isScanSurface) {
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent('receiving-focus-scan'));
      });
    }
  }, [mode, isScanSurface]);

  const updateMode = (nextMode: ReceivingMode) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('mode', nextMode);
    // Strip mode-scoped sub-view/filter params so the target mode starts at its
    // own clean default — a stale `unboxview`/`triview`/Incoming filter must not
    // ride along into a different mode.
    for (const key of MODE_SCOPED_PARAMS) nextParams.delete(key);
    const finalParams =
      nextMode !== 'history' ? clearReceivingHistoryUrlParams(nextParams) : nextParams;
    router.replace(`/receiving?${finalParams.toString()}`);
  };

  const updateStaff = (id: number) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('staffId', String(id));
    router.replace(`/receiving?${nextParams.toString()}`);
  };

  const updateUnboxView = (next: UnboxView, opts?: { clearLine?: boolean }) => {
    if (next === unboxView) return;
    // Different list = don't carry the prior pick; let the new list auto-select
    // its own top (mirrors the triage Found/Unfound toggle). Scan auto-switch
    // passes clearLine:false so the just-resolved workspace stays open.
    if (opts?.clearLine !== false) {
      window.dispatchEvent(new CustomEvent('receiving-clear-line'));
    }
    const nextParams = new URLSearchParams(searchParams.toString());
    if (next === 'recent') nextParams.delete('unboxview');
    else nextParams.set('unboxview', next);
    router.replace(`/receiving?${nextParams.toString()}`);
  };

  const updateTriageView = (next: TriageView) => {
    if (next === triageView) return;
    window.dispatchEvent(new CustomEvent('receiving-clear-line'));
    const nextParams = new URLSearchParams(searchParams.toString());
    if (next === 'triage') nextParams.delete('triview');
    else nextParams.set('triview', next);
    router.replace(`/receiving?${nextParams.toString()}`);
  };

  const updateTriageQuery = (next: string) => {
    const trimmed = next.trim();
    if (trimmed === triageQuery) return;
    const nextParams = new URLSearchParams(searchParams.toString());
    if (!trimmed) nextParams.delete('triq');
    else nextParams.set('triq', trimmed);
    router.replace(`/receiving?${nextParams.toString()}`);
  };

  return {
    mode,
    unboxView,
    triageView,
    triageQuery,
    isScanSurface,
    updateMode,
    updateStaff,
    updateUnboxView,
    updateTriageView,
    updateTriageQuery,
  };
}
