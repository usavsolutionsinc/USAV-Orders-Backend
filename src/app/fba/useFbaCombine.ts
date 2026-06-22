'use client';

/**
 * Combine-workspace state for the FBA board. The board selection drives the
 * kanban builder, but the workspace opens only when the user presses "Combine
 * items" (not on first selection) so they can multi-select packed items first;
 * leaving combine mode resets it. Extracted from fba/page; behaviour is unchanged.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FBA_COMBINE_STARTED } from '@/lib/fba/events';
import { useFbaBoardSelection } from '@/components/fba/hooks/useFbaBoardSelection';
import type { FbaMode } from '@/lib/fba/fba-modes';

export interface FbaCombine {
  boardSelection: ReturnType<typeof useFbaBoardSelection>;
  combineOpen: boolean;
  setCombineOpen: React.Dispatch<React.SetStateAction<boolean>>;
  selectedUnits: number;
  workspaceActive: boolean;
  showCombineBar: boolean;
  handleStartCombine: () => void;
}

export function useFbaCombine(activeMode: FbaMode): FbaCombine {
  const boardSelection = useFbaBoardSelection({ includePairedSelection: true });
  const [combineOpen, setCombineOpen] = useState(false);

  useEffect(() => {
    if (activeMode !== 'combine') setCombineOpen(false);
  }, [activeMode]);

  const selectedUnits = useMemo(
    () => boardSelection.reduce((sum, i) => sum + Math.max(1, Number(i.actual_qty || 0)), 0),
    [boardSelection],
  );
  const workspaceActive = activeMode === 'combine' && combineOpen;
  // Action bar shows once items are selected but the workspace isn't open yet.
  const showCombineBar = activeMode === 'combine' && !combineOpen && boardSelection.length > 0;

  const handleStartCombine = useCallback(() => {
    setCombineOpen(true);
    // Flip the sidebar Recent/Packed pills to Packed so more packed items are
    // easy to select and add while combining.
    window.dispatchEvent(new CustomEvent(FBA_COMBINE_STARTED));
  }, []);

  return {
    boardSelection,
    combineOpen,
    setCombineOpen,
    selectedUnits,
    workspaceActive,
    showCombineBar,
    handleStartCombine,
  };
}
