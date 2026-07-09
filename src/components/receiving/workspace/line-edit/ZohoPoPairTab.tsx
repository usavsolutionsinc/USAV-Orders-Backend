'use client';

/**
 * Zoho PO tab for Package Pairing — two independent paths:
 *   1. Search & add product by Zoho SKU (no PO link; carton stays unfound) —
 *      rendered as the prominent, dedicated search/add CTA (the primary action).
 *   2. Link / relink the carton to a purchase order (PoLinkTab) — secondary.
 *
 * Operators use (1) when the PO is still unknown but the product in the box
 * should be recorded on the unfound carton.
 */
import { Search } from '@/components/Icons';
import { EcwidProductSearchInline } from '@/components/receiving/unfound/EcwidProductSearchInline';
import type { EcwidProductSelection } from '@/components/receiving/unfound/EcwidProductSearchInline';
import { PoLinkTab } from '@/components/receiving/workspace/line-edit/PoLinkTab';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

export function ZohoPoPairTab({
  row,
  receivingId,
  onAddSku,
  allowOffPo = false,
}: {
  row: ReceivingLineRow;
  receivingId: number;
  onAddSku: (selection: EcwidProductSelection) => Promise<void>;
  /** Matched carton → add as an off-PO extra (not on the Zoho PO). */
  allowOffPo?: boolean;
}) {
  return (
    <div className="space-y-4">
      {/* Primary action — a dedicated, prominent search/add control. The blue
          tint + icon-led title mark it as THE way to find the product and put it
          on the PO, so it reads as a CTA rather than a plain field. */}
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
                : 'Find the product by name or SKU and add it to this PO. The box stays on the Unfound queue until you link a purchase order below.'}
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

      <div className="border-t border-border-hairline pt-4">
        <p className="mb-2 text-eyebrow font-black uppercase tracking-widest text-text-faint">
          Link purchase order
        </p>
        <PoLinkTab row={row} receivingId={receivingId} />
      </div>
    </div>
  );
}
