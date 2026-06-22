'use client';

/**
 * Outbound bridge from the sidebar's selection state to the right-pane
 * `ReceivingLineWorkspace`. The editor moved out of the sidebar; the sidebar
 * stays the source of truth for selection + scan flow and just dispatches the
 * events the workspace listens to:
 *   - open/close whenever the selected line, scan-driven flag, or bootstrap
 *     mode changes (null clears the pane).
 *   - nav-state (prev/next + "Line N of M") so the workspace header can render
 *     navigation without lifting `scanMatchedRows` up.
 *
 * Separated from useReceivingSelection because it depends on the navigation
 * hook's derived values, which are computed from the selection state.
 * Extracted from ReceivingSidebarPanel; behaviour is unchanged.
 */

import { useEffect } from 'react';
import {
  dispatchReceivingWorkspaceOpen,
  dispatchReceivingWorkspaceClose,
  dispatchReceivingWorkspaceNavState,
} from '@/utils/events';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

interface UseReceivingWorkspaceBridgeArgs {
  selectedLine: ReceivingLineRow | null;
  lineAccordionBootstrap: 'default' | 'all';
  scanDriven: boolean;
  scanMatchedRows: ReceivingLineRow[];
  currentIndex: number;
  canPrev: boolean;
  canNext: boolean;
}

export function useReceivingWorkspaceBridge({
  selectedLine,
  lineAccordionBootstrap,
  scanDriven,
  scanMatchedRows,
  currentIndex,
  canPrev,
  canNext,
}: UseReceivingWorkspaceBridgeArgs): void {
  // Open / close: dispatch whenever the selected line, scan-driven flag, or
  // bootstrap mode changes. Null clears the workspace pane.
  useEffect(() => {
    if (selectedLine) {
      dispatchReceivingWorkspaceOpen({
        row: selectedLine,
        accordionBootstrap: lineAccordionBootstrap,
        scanDriven,
      });
    } else {
      dispatchReceivingWorkspaceClose();
    }
  }, [selectedLine, lineAccordionBootstrap, scanDriven]);

  // Nav state mirror: workspace header reads prev/next + Line N of M from these
  // events instead of having scanMatchedRows lifted up.
  useEffect(() => {
    if (!selectedLine) return;
    dispatchReceivingWorkspaceNavState({
      currentIndex,
      total: scanMatchedRows.length,
      canPrev,
      canNext,
    });
  }, [selectedLine, currentIndex, scanMatchedRows.length, canPrev, canNext]);
}
