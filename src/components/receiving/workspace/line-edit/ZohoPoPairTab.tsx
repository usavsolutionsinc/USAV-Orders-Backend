'use client';

/**
 * Zoho PO tab for Package Pairing — two independent paths:
 *   1. Acknowledge product by Zoho SKU (no PO link; carton stays unfound).
 *   2. Link / relink the carton to a purchase order (PoLinkTab).
 *
 * Operators use (1) when the PO is still unknown but the product in the box
 * should be recorded on the unfound carton.
 */
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
      <div className="space-y-2">
        <div>
          <p className="text-eyebrow font-black uppercase tracking-widest text-text-faint">
            Acknowledge by Zoho SKU
          </p>
          <p className="mt-0.5 text-xs text-text-soft">
            {allowOffPo
              ? 'Adds the product to this carton without linking a PO — use when the PO is still unfound, or as an off-PO extra on a matched carton.'
              : 'Adds the product to this unfound carton without linking a PO — the box stays on the Unfound queue until you link a purchase order below.'}
          </p>
        </div>
        <EcwidProductSearchInline
          receivingId={receivingId}
          popoverMode="search"
          searchFieldOverride="zoho_catalog"
          onSelect={onAddSku}
        />
      </div>

      <div className="border-t border-border-hairline pt-4">
        <p className="mb-2 text-eyebrow font-black uppercase tracking-widest text-text-faint">
          Link purchase order
        </p>
        <PoLinkTab row={row} receivingId={receivingId} />
      </div>
    </div>
  );
}
