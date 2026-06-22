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

export type UnboxView = 'recent' | 'queue' | 'viewed';

export interface ReceivingModeState {
  /** Active sidebar mode parsed from `?mode=` (defaults to `receive`). */
  mode: ReceivingMode;
  /** Unbox sub-view from `?unboxview=` (defaults to `recent`). */
  unboxView: UnboxView;
  /** Raw triage Found/Unfound sub-view from `?triview=` (`''` when absent). */
  triageView: string;
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
  /** Swap the Unbox `?unboxview=` sub-view (clears the current line first). */
  updateUnboxView: (next: UnboxView) => void;
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

  const triageView = searchParams.get('triview') ?? '';

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
    const finalParams =
      nextMode !== 'history' ? clearReceivingHistoryUrlParams(nextParams) : nextParams;
    router.replace(`/receiving?${finalParams.toString()}`);
  };

  const updateStaff = (id: number) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('staffId', String(id));
    router.replace(`/receiving?${nextParams.toString()}`);
  };

  const updateUnboxView = (next: UnboxView) => {
    if (next === unboxView) return;
    // Different list = don't carry the prior pick; let the new list auto-select
    // its own top (mirrors the triage Found/Unfound toggle).
    window.dispatchEvent(new CustomEvent('receiving-clear-line'));
    const nextParams = new URLSearchParams(searchParams.toString());
    if (next === 'recent') nextParams.delete('unboxview');
    else nextParams.set('unboxview', next);
    router.replace(`/receiving?${nextParams.toString()}`);
  };

  return {
    mode,
    unboxView,
    triageView,
    isScanSurface,
    updateMode,
    updateStaff,
    updateUnboxView,
  };
}
