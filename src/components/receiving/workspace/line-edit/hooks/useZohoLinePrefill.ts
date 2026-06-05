'use client';

/**
 * Prefill Zendesk ticket, listing URL, and serial from the line's Zoho PO
 * (notes + matching line-item description). Extracted from LineEditPanel.
 *
 * Precedence is unchanged: a per-browser scratch value or an existing DB value
 * always wins over the Zoho-parsed one, and a local serial (from serial_units)
 * wins over the PO description. So this only fills genuinely-empty fields.
 */

import { useEffect } from 'react';
import { readReceivingLineDetailsScratch } from '@/components/sidebar/receiving/receiving-sidebar-shared';
import {
  parseSerialFromLineDescription,
  parseZendeskListingFromPoNotes,
} from '@/lib/zoho-po-prefill';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

interface UseZohoLinePrefillArgs {
  row: ReceivingLineRow;
  setZendesk: (v: string) => void;
  setListingLink: (v: string) => void;
  setSerialInput: (v: string) => void;
}

export function useZohoLinePrefill({
  row,
  setZendesk,
  setListingLink,
  setSerialInput,
}: UseZohoLinePrefillArgs) {
  useEffect(() => {
    const poId = (row.zoho_purchaseorder_id || '').trim();
    if (!poId) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/zoho/purchase-orders?purchaseorder_id=${encodeURIComponent(poId)}`,
        );
        const data = await res.json();
        if (cancelled || !data?.success || !data.purchaseorder) return;

        const po = data.purchaseorder as {
          notes?: string | null;
          line_items?: Array<{ line_item_id?: string; description?: string | null }>;
        };

        const rid = row.receiving_id;
        const scratch = readReceivingLineDetailsScratch(rid);
        const { zendesk: zPo, listing: lPo } = parseZendeskListingFromPoNotes(po.notes ?? '');
        if (!scratch.zendesk.trim() && zPo) setZendesk(zPo);
        // Listing URL: DB column (`receiving.listing_url`) is the source of
        // truth — never overwrite an existing DB value or a per-browser
        // scratch override with the Zoho-parsed value. When both are empty
        // and Zoho has one, set it locally and the debounced PATCH (in
        // useReceivingPackageSync) will persist it to the DB.
        const currentListing =
          (row.receiving_listing_url || '').trim() || scratch.listing.trim();
        if (!currentListing && lPo) setListingLink(lPo);

        const lineItemId = (row.zoho_line_item_id || '').trim();
        if (!lineItemId || !Array.isArray(po.line_items)) return;
        const li = po.line_items.find(
          (l) => String(l.line_item_id || '').trim() === lineItemId,
        );
        // Local serials (from serial_units via receiving-lines `include=serials`)
        // win over the Zoho PO description. Only fall back to Zoho when the
        // line has no local serial on file yet.
        const hasLocalSerial = (row.serials ?? []).some((s) => (s.serial_number || '').trim());
        if (hasLocalSerial) return;
        const sn = parseSerialFromLineDescription(li?.description ?? null);
        if (sn) setSerialInput(sn);
      } catch {
        /* Zoho unavailable — fields stay empty */
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id, row.receiving_id, row.zoho_purchaseorder_id, row.zoho_line_item_id]);
}
