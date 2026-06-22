'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/lib/toast';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

/** Trimmed PO# for a row — number wins over id. */
function poValueOf(row: ReceivingLineRow): string {
  return (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();
}

/**
 * PO# binding for a receiving line: the inline-editor open state, the edited
 * value, and {@link persistPoNumber} which writes the typed PO# to the carton
 * AND fans out to every existing receiving_line for it.
 *
 * The editor defaults open for unmatched cartons or any row without a PO# yet
 * (the operator's most likely next action), and is re-armed on every row
 * switch for those same cases.
 */
export function usePoBinding(row: ReceivingLineRow) {
  const [poEditorOpen, setPoEditorOpen] = useState(
    () => row.receiving_source === 'unmatched' || !poValueOf(row),
  );
  const [poNumberEdit, setPoNumberEdit] = useState(() => poValueOf(row));

  // Seed the edited value from the row on every line switch.
  useEffect(() => {
    setPoNumberEdit(poValueOf(row));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id, row.zoho_purchaseorder_number, row.zoho_purchaseorder_id]);

  // Re-arm the PO# editor for unmatched / un-bound rows so the operator
  // doesn't have to click the pencil after each switch. Don't auto-close for
  // matched rows — the operator may have deliberately opened it.
  useEffect(() => {
    if (row.receiving_source === 'unmatched' || !poValueOf(row)) {
      setPoEditorOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id, row.receiving_source, row.zoho_purchaseorder_number, row.zoho_purchaseorder_id]);

  /**
   * Save the operator-typed PO# to the carton AND every existing
   * receiving_line for it. /api/receiving/[id] auto-flips `receiving.source`
   * 'unmatched' → 'zoho_po' on a non-null PO# write, so the carton drops off
   * the Unfound queue. Fanning out to lines means mark-received-po + line
   * lookups + the PO accordion all see the link without waiting for a refresh
   * round-trip.
   */
  const persistPoNumber = useCallback(
    async (nextRaw: string) => {
      if (row.receiving_id == null) return;
      const next = String(nextRaw || '').trim();
      try {
        const res = await fetch(`/api/receiving/${row.receiving_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ zoho_purchaseorder_number: next || null }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) {
          toast.error(data?.error ?? `PO# save failed (${res.status})`);
          return;
        }
        try {
          const linesRes = await fetch(`/api/receiving-lines?receiving_id=${row.receiving_id}`);
          const linesData = await linesRes.json();
          const rows = Array.isArray(linesData?.receiving_lines) ? linesData.receiving_lines : [];
          await Promise.all(
            rows.map((r: { id?: number }) =>
              r?.id != null
                ? fetch('/api/receiving-lines', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: r.id, zoho_purchaseorder_number: next || null }),
                  }).catch(() => null)
                : null,
            ),
          );
        } catch {
          /* line fan-out is best-effort; the carton write is source of truth */
        }
        toast.success(next ? `PO# saved (${next})` : 'PO# cleared');
        window.dispatchEvent(new CustomEvent('usav-refresh-data'));
        window.dispatchEvent(
          new CustomEvent('receiving-package-updated', {
            detail: { receiving_id: row.receiving_id, zoho_purchaseorder_number: next || null },
          }),
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'PO# save failed');
      }
    },
    [row.receiving_id],
  );

  return { poEditorOpen, setPoEditorOpen, poNumberEdit, setPoNumberEdit, persistPoNumber };
}
