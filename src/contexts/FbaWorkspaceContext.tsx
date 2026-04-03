'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PrintSelectionPayload } from '@/components/fba/table/types';
import { getPlanId, getPrimaryTrackingNumber } from '@/components/fba/table/utils';

export interface FbaPlanTrackingDraft {
  amazon: string;
  ups: string;
}

interface FbaWorkspaceSelectionState extends PrintSelectionPayload {
  ownerId: string | null;
  activePlanId: number | null;
}

interface FbaWorkspaceContextValue {
  selection: FbaWorkspaceSelectionState;
  trackingByPlan: Record<number, FbaPlanTrackingDraft>;
  clearSelectionVersion: number;
  setSelection: (ownerId: string, payload: PrintSelectionPayload) => void;
  clearSelection: (ownerId?: string) => void;
  patchTracking: (planId: number, patch: Partial<FbaPlanTrackingDraft>) => void;
}

const EMPTY_SELECTION: FbaWorkspaceSelectionState = {
  ownerId: null,
  selectedItems: [],
  planIds: [],
  readyCount: 0,
  pendingCount: 0,
  needsPrintCount: 0,
  activePlanId: null,
};

const FbaWorkspaceContext = createContext<FbaWorkspaceContextValue | undefined>(undefined);

export function FbaWorkspaceProvider({ children }: { children: ReactNode }) {
  const [selection, setSelectionState] = useState<FbaWorkspaceSelectionState>(EMPTY_SELECTION);
  const [trackingByPlan, setTrackingByPlan] = useState<Record<number, FbaPlanTrackingDraft>>({});
  const [clearSelectionVersion, setClearSelectionVersion] = useState(0);
  const selectionOwnerRef = useRef<string | null>(null);

  const setSelection = useCallback((ownerId: string, payload: PrintSelectionPayload) => {
    const activePlanId = payload.planIds.length === 1 ? payload.planIds[0] : null;
    selectionOwnerRef.current = ownerId;
    setSelectionState({
      ownerId,
      ...payload,
      activePlanId,
    });

    setTrackingByPlan((prev) => {
      if (payload.planIds.length === 0) return {};

      const allowedPlanIds = new Set(payload.planIds);
      const next: Record<number, FbaPlanTrackingDraft> = {};

      payload.planIds.forEach((planId) => {
        next[planId] = prev[planId] ? { ...prev[planId] } : { amazon: '', ups: '' };
      });

      payload.selectedItems.forEach((item) => {
        const planId = getPlanId(item);
        if (!planId || !allowedPlanIds.has(planId)) return;

        if (item.amazon_shipment_id && !next[planId]?.amazon) {
          next[planId] = {
            ...(next[planId] || { amazon: '', ups: '' }),
            amazon: String(item.amazon_shipment_id),
          };
        }

        const tracking = getPrimaryTrackingNumber(item);
        if (tracking && !next[planId]?.ups) {
          next[planId] = {
            ...(next[planId] || { amazon: '', ups: '' }),
            ups: tracking,
          };
        }
      });

      return next;
    });
  }, []);

  const clearSelection = useCallback((ownerId?: string) => {
    if (ownerId && selectionOwnerRef.current && selectionOwnerRef.current !== ownerId) return;

    selectionOwnerRef.current = null;
    setSelectionState(EMPTY_SELECTION);
    setTrackingByPlan({});

    setClearSelectionVersion((version) => version + 1);
  }, []);

  const patchTracking = useCallback((planId: number, patch: Partial<FbaPlanTrackingDraft>) => {
    if (!Number.isFinite(planId) || planId <= 0) return;

    setTrackingByPlan((prev) => {
      const current = prev[planId] || { amazon: '', ups: '' };
      return {
        ...prev,
        [planId]: {
          ...current,
          ...patch,
        },
      };
    });
  }, []);

  const value = useMemo<FbaWorkspaceContextValue>(
    () => ({
      selection,
      trackingByPlan,
      clearSelectionVersion,
      setSelection,
      clearSelection,
      patchTracking,
    }),
    [clearSelection, clearSelectionVersion, patchTracking, selection, setSelection, trackingByPlan]
  );

  return <FbaWorkspaceContext.Provider value={value}>{children}</FbaWorkspaceContext.Provider>;
}

export function useFbaWorkspace() {
  const context = useContext(FbaWorkspaceContext);
  if (!context) {
    throw new Error('useFbaWorkspace must be used within a FbaWorkspaceProvider');
  }
  return context;
}
