'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

/**
 * Carton-level default receiving type (receiving.intake_type) — the mirror of
 * useSourcePlatform, for the carton TYPE pill. Type is now carton-default +
 * line-override: this hook owns the carton DEFAULT; per-line overrides stay on
 * receiving_lines.receiving_type. See migration 2026-06-13b.
 *
 * Seeds synchronously from the row so the pill never flashes 'PO', falls back to
 * the active line's override when no carton default is set yet (so a freshly
 * tagged line still reads correctly), and persists via PATCH /api/receiving/:id,
 * broadcasting `receiving-package-updated` so sibling surfaces stay in sync.
 */
export function useReceivingType(row: ReceivingLineRow) {
  // Carton default first; fall back to the line's own type so a carton that
  // pre-dates the carton-default column (or was just tagged on one line) still
  // shows a meaningful value instead of defaulting to 'PO'.
  const seed = () =>
    (row.carton_intake_type || row.receiving_type || 'PO').toUpperCase();
  const [intakeType, setIntakeType] = useState<string>(seed);
  const [typeSaving, setTypeSaving] = useState(false);

  // Re-seed synchronously on carton/line change — no empty frame.
  useEffect(() => {
    setIntakeType(seed());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.receiving_id, row.carton_intake_type, row.receiving_type]);

  const saveType = useCallback(
    async (next: string) => {
      if (row.receiving_id == null) return;
      const norm = (next || 'PO').toUpperCase();
      setTypeSaving(true);
      try {
        await fetch(`/api/receiving/${row.receiving_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intake_type: norm }),
        });
        window.dispatchEvent(
          new CustomEvent('receiving-package-updated', {
            detail: { receiving_id: row.receiving_id, intake_type: norm },
          }),
        );
      } catch {
        /* silent — pill already reflects the optimistic value */
      } finally {
        setTypeSaving(false);
      }
    },
    [row.receiving_id],
  );

  return { intakeType, setIntakeType, typeSaving, saveType };
}
