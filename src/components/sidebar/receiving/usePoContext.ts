'use client';

/**
 * Unboxing PO context for the receiving sidebar: the carton currently being
 * unboxed (its receiving_id, PO ids, lines, package meta) plus the "armed" line
 * a serial scan targets.
 *
 * Owns the `poContext` / `armedLineId` cells and the window-event bridges that
 * mutate them from the main panel (arm/disarm a line, activate a pending
 * receiving). `clearPoContext` resets only this hook's cells — serial-input
 * resets live in useSerialScan; the panel composes the two. Extracted from
 * ReceivingSidebarPanel; behaviour is unchanged.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  mapApiLineToPoSummary,
  parseReceivingPackage,
  type PoContext,
  type PoLineSummary,
} from '@/components/sidebar/receiving/receiving-sidebar-shared';

export interface PoContextState {
  poContext: PoContext | null;
  setPoContext: React.Dispatch<React.SetStateAction<PoContext | null>>;
  armedLineId: number | null;
  setArmedLineId: React.Dispatch<React.SetStateAction<number | null>>;
  /** The armed PO line resolved from `poContext.lines` (null when none). */
  armedLine: PoLineSummary | null;
  /** Reset the PO context + armed line (does NOT touch serial inputs). */
  clearPoContext: () => void;
}

export function usePoContext(): PoContextState {
  const [poContext, setPoContext] = useState<PoContext | null>(null);
  const [armedLineId, setArmedLineId] = useState<number | null>(null);

  const armedLine = useMemo<PoLineSummary | null>(() => {
    if (armedLineId == null || !poContext) return null;
    return poContext.lines.find((l) => l.id === armedLineId) ?? null;
  }, [armedLineId, poContext]);

  const clearPoContext = useCallback(() => {
    setPoContext(null);
    setArmedLineId(null);
  }, []);

  // ── Arm / disarm events from the main panel ──────────────────────────────
  useEffect(() => {
    const handleArm = (e: Event) => {
      const detail = (
        e as CustomEvent<{ line_id?: number; sku?: string; item_name?: string }>
      ).detail;
      if (!detail?.line_id) return;
      setArmedLineId(detail.line_id);
    };
    const handleDisarm = () => setArmedLineId(null);

    window.addEventListener('receiving-arm-line', handleArm);
    window.addEventListener('receiving-disarm-line', handleDisarm);
    return () => {
      window.removeEventListener('receiving-arm-line', handleArm);
      window.removeEventListener('receiving-disarm-line', handleDisarm);
    };
  }, []);

  // ── External receiving-active: main panel selected a pending receiving ────
  useEffect(() => {
    const handleActive = async (e: Event) => {
      const detail = (e as CustomEvent<{ receiving_id?: number }>).detail;
      const id = detail?.receiving_id;
      if (!id) return;
      if (poContext?.receiving_id === id) return;

      try {
        const res = await fetch(`/api/receiving-lines?receiving_id=${id}`);
        const data = await res.json();
        if (!data?.success) return;
        const lines: PoLineSummary[] = (data.receiving_lines || []).map(
          (l: Record<string, unknown>) =>
            mapApiLineToPoSummary(l as Parameters<typeof mapApiLineToPoSummary>[0]),
        );
        const poIds = [
          ...new Set(
            lines
              .map((l) => (l.zoho_purchaseorder_id || '').trim())
              .filter((x) => x.length > 0),
          ),
        ];
        setPoContext({
          receiving_id: id,
          po_ids: poIds,
          lines,
          receiving_package: parseReceivingPackage(data.receiving_package),
        });
        setArmedLineId(null);
      } catch {
        /* ignore — sidebar stays empty */
      }
    };
    window.addEventListener('receiving-active', handleActive);
    return () => window.removeEventListener('receiving-active', handleActive);
  }, [poContext?.receiving_id]);

  return { poContext, setPoContext, armedLineId, setArmedLineId, armedLine, clearPoContext };
}
