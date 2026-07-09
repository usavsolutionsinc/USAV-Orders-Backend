'use client';

import { useCallback, useEffect, useState } from 'react';
import { dispatchLineUpdated } from '@/components/station/ReceivingLinesTable';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { parseZendeskListingFromPoNotes } from '@/lib/zoho-po-prefill';

/**
 * Refresh ↔ Zoho for a single receiving line. Always searches by tracking#
 * (PO# search is a future upgrade). Flow:
 *   1. find-po by tracking# — Zoho is the source of truth.
 *   2. Reconcile the line: if Zoho's purchaseorder_id or number differs from
 *      the local line, PATCH /api/receiving-lines. No-op on match.
 *   3. Reconcile the carton (receiving row): PATCH with PO# + tracking# when
 *      `receiving_id` is set. Otherwise fall back to /api/receiving/lookup-po
 *      which creates/links a carton from the tracking#.
 *
 * Also wires the workspace header's Refresh button (the
 * `receiving-workspace-refresh-line` window event) so the panel doesn't need a
 * prop-drilled ref or to lift this up to the workspace.
 *
 * Listing/Zendesk are prefilled from PO notes only when still empty — the
 * setters are passed in so the values stay owned by the panel.
 */
export function useZohoSync(
  row: ReceivingLineRow,
  {
    staffId,
    listingLink,
    zendesk,
    setListingLink,
    setZendesk,
    dispatchLine = dispatchLineUpdated,
  }: {
    staffId: string;
    listingLink: string;
    zendesk: string;
    setListingLink: (v: string) => void;
    setZendesk: (v: string) => void;
    dispatchLine?: (patch: Partial<ReceivingLineRow> & { id: number }) => void;
  },
) {
  const [zohoSyncing, setZohoSyncing] = useState(false);

  /**
   * Pull-from-Zoho for the whole carton: re-imports the linked PO so
   * receiving.zoho_notes (PO header notes), receiving_lines.unit_price (price),
   * and receiving_lines.zoho_notes (item descriptions) all refresh from Zoho.
   * Returns the freshly-synced carton notes so a caller (the Zoho Notes tab)
   * can update its draft. No-op without a receiving id.
   */
  const syncCartonFromZoho = useCallback(async (): Promise<string | null> => {
    if (!row.receiving_id) return null;
    try {
      const res = await fetch(`/api/receiving/${row.receiving_id}/zoho-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = (await res.json().catch(() => null)) as { zoho_notes?: string | null } | null;

      // Re-fetch the line so the sidebar/table/panel pick up price + notes.
      try {
        const lineRes = await fetch(`/api/receiving-lines?id=${row.id}`);
        const lineData = await lineRes.json();
        if (lineData?.success && lineData.receiving_line) {
          dispatchLine(lineData.receiving_line as ReceivingLineRow);
        }
      } catch { /* line refetch best-effort */ }
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));

      return (data?.zoho_notes ?? null) as string | null;
    } catch {
      return null;
    }
  }, [row.receiving_id, row.id, dispatchLine]);

  const syncWithZoho = useCallback(async () => {
    if (zohoSyncing) return;
    const tracking = (row.tracking_number || '').trim();
    setZohoSyncing(true);
    try {
      const knownPoId = (row.zoho_purchaseorder_id || '').trim();

      // Fast path: PO id already known, OR no tracking to search by — skip the
      // find-po search and just refresh the line, prefill from the PO, and pull
      // the carton (notes + price + descriptions) from Zoho.
      if (knownPoId || !tracking) {
        // Re-fetch the line to pick up any server-side changes.
        const lineRes = await fetch(`/api/receiving-lines?id=${row.id}`);
        const lineData = await lineRes.json();
        if (lineData?.success && lineData.receiving_line) {
          dispatchLine(lineData.receiving_line as ReceivingLineRow);
        }

        // Fetch full PO for notes → prefill listing / zendesk (PO id required).
        if (knownPoId) {
          try {
            const poRes = await fetch(
              `/api/zoho/purchase-orders?purchaseorder_id=${encodeURIComponent(knownPoId)}`,
            );
            const poData = await poRes.json();
            if (poData?.success && poData.purchaseorder) {
              const poNotes = (poData.purchaseorder as { notes?: string | null }).notes ?? '';
              const parsed = parseZendeskListingFromPoNotes(poNotes);
              if (!listingLink.trim() && parsed.listing) setListingLink(parsed.listing);
              if (!zendesk.trim() && parsed.zendesk) setZendesk(parsed.zendesk);
            }
          } catch { /* PO fetch failed — fields stay as-is */ }
        }

        // Pull notes + price + descriptions from Zoho into the local carton.
        await syncCartonFromZoho();
        return;
      }

      // Slow path: no PO ID yet — search Zoho by tracking number.
      const findRes = await fetch('/api/zoho/find-po', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingNumber: tracking }),
      });
      const findData = await findRes.json();
      const po = findData?.success && findData.matched ? findData.purchase_order : null;

      // Reconcile the line's PO#/number only if Zoho disagrees.
      if (po) {
        const zohoId = (po.zoho_purchaseorder_id || '').trim() || null;
        const zohoNum = (po.zoho_purchaseorder_number || '').trim() || null;
        const localId = (row.zoho_purchaseorder_id || '').trim() || null;
        const localNum = (row.zoho_purchaseorder_number || '').trim() || null;
        const patchBody: Record<string, unknown> = { id: row.id };
        if (zohoId && zohoId !== localId) patchBody.zoho_purchaseorder_id = zohoId;
        if (zohoNum && zohoNum !== localNum) patchBody.zoho_purchaseorder_number = zohoNum;
        if (Object.keys(patchBody).length > 1) {
          await fetch('/api/receiving-lines', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patchBody),
          });
        }
      }

      // Reconcile the carton.
      if (row.receiving_id) {
        if (po) {
          await fetch(`/api/receiving/${row.receiving_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              zoho_purchaseorder_id: po.zoho_purchaseorder_id || null,
              zoho_purchaseorder_number: po.zoho_purchaseorder_number || null,
              reference_number: po.reference_number || tracking,
            }),
          });
        }
      } else {
        await fetch('/api/receiving/lookup-po', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackingNumber: tracking, staffId: Number(staffId) }),
        });
        window.dispatchEvent(new CustomEvent('usav-refresh-data'));
      }

      // Re-fetch the line so sidebar + table pick up every change.
      const lineRes = await fetch(`/api/receiving-lines?id=${row.id}`);
      const lineData = await lineRes.json();
      if (lineData?.success && lineData.receiving_line) {
        dispatchLine(lineData.receiving_line as ReceivingLineRow);
      }

      // Prefill listing / zendesk from PO notes if still empty.
      const resolvedPoId = (po?.zoho_purchaseorder_id || '').trim();
      if (resolvedPoId) {
        try {
          const poRes = await fetch(
            `/api/zoho/purchase-orders?purchaseorder_id=${encodeURIComponent(resolvedPoId)}`,
          );
          const poData = await poRes.json();
          if (poData?.success && poData.purchaseorder) {
            const poNotes = (poData.purchaseorder as { notes?: string | null }).notes ?? '';
            const parsed = parseZendeskListingFromPoNotes(poNotes);
            if (!listingLink.trim() && parsed.listing) setListingLink(parsed.listing);
            if (!zendesk.trim() && parsed.zendesk) setZendesk(parsed.zendesk);
          }
        } catch { /* PO fetch failed — fields stay as-is */ }
      }

      // Now that the PO link is established, pull notes + price + descriptions
      // from Zoho into the local carton.
      await syncCartonFromZoho();
    } catch {
      /* silent — user can retry */
    } finally {
      setZohoSyncing(false);
    }
  }, [
    zohoSyncing,
    row.id,
    row.receiving_id,
    row.tracking_number,
    row.zoho_purchaseorder_id,
    row.zoho_purchaseorder_number,
    staffId,
    listingLink,
    zendesk,
    setListingLink,
    setZendesk,
    syncCartonFromZoho,
  ]);

  // Workspace header's Refresh button dispatches this so we don't need a
  // prop-drilled ref or to lift syncWithZoho up to the workspace.
  useEffect(() => {
    const handler = () => { void syncWithZoho(); };
    window.addEventListener('receiving-workspace-refresh-line', handler);
    return () => window.removeEventListener('receiving-workspace-refresh-line', handler);
  }, [syncWithZoho]);

  return { zohoSyncing, syncWithZoho, syncCartonFromZoho };
}
