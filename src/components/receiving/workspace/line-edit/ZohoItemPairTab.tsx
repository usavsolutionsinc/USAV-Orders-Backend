'use client';

import { Search } from '@/components/Icons';
import { EcwidProductSearchInline } from '@/components/receiving/unfound/EcwidProductSearchInline';
import type { EcwidProductSelection } from '@/components/receiving/unfound/EcwidProductSearchInline';

/**
 * Zoho Item pairing tab for Package Pairing.
 *
 * This is the "add by Zoho SKU" path (no purchase-order link required). On
 * unfound cartons, this is the default leftmost pill and the quickest way to
 * record what's inside the box before the PO is known.
 */
export function ZohoItemPairTab({
  receivingId,
  onAddSku,
  allowOffPo = false,
}: {
  receivingId: number;
  onAddSku: (selection: EcwidProductSelection) => Promise<void>;
  /** Matched carton → add as an off-PO extra (not on the Zoho PO). */
  allowOffPo?: boolean;
}) {
  return (
    <section className="rounded-xl bg-blue-50/60 p-3">
      <div className="mb-2.5 flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
          <Search className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-caption font-black uppercase leading-none tracking-widest text-blue-900">
            Search &amp; add Zoho SKU
          </p>
          <p className="mt-1 text-xs leading-snug text-blue-700">
            {allowOffPo
              ? 'Find the product by name or SKU and add it to this carton — before the PO is linked, or as an off-PO extra on a matched carton.'
              : 'Find the product by name or SKU and add it to this carton. The box stays on the Unfound queue until you link a purchase order.'}
          </p>
        </div>
      </div>
      <EcwidProductSearchInline
        receivingId={receivingId}
        popoverMode="search"
        searchFieldOverride="zoho_catalog"
        onSelect={onAddSku}
        // Headerless inline search (no close ✕), so there is nothing to close —
        // `onClose` is only consumed by the header (not rendered here).
        onClose={() => {}}
      />
    </section>
  );
}

