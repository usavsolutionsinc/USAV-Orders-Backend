'use client';

/**
 * PoSuggestBanner — the auto-suggest tier's UI (§3.6). Renders ABOVE the
 * pairing tabs (the primary/first-shown path per D1); the manual "Zoho PO"
 * tab (`PoLinkTab`) stays exactly where it was as the correction tool.
 *
 * Nothing renders when there are no real candidates — this is a suggestion
 * surface, not a status card, so an empty state would just be noise above the
 * tabs the operator already has.
 */

import { Loader2, MapPin } from '@/components/Icons';
import { PairingLinkButton } from '../workspace/line-edit/PairingLinkButton';
import type { PoSuggestionsController } from './usePoSuggestions';

export function PoSuggestBanner({ suggestions }: { suggestions: PoSuggestionsController }) {
  const { candidates, loading, accept, linkingId } = suggestions;

  if (loading) {
    return (
      <div className="mb-2 flex items-center gap-2 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-eyebrow font-semibold uppercase tracking-widest text-gray-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking for a tracking match…
      </div>
    );
  }

  if (candidates.length === 0) return null;

  return (
    <div className="mb-3 space-y-1.5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-2.5">
      <p className="flex items-center gap-1.5 px-0.5 text-eyebrow font-black uppercase tracking-widest text-emerald-700">
        <MapPin className="h-3 w-3" />
        Suggested — tracking match
      </p>
      {candidates.map((po) => (
        <div
          key={po.zoho_purchaseorder_id}
          className="flex items-center gap-2 rounded-lg border border-emerald-200/70 bg-white px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-caption font-bold text-gray-900">
              {po.zoho_purchaseorder_number || `PO ${po.zoho_purchaseorder_id}`}
            </p>
            <p className="truncate text-eyebrow font-semibold uppercase tracking-widest text-gray-500">
              {po.vendor_name || 'Unknown vendor'}
              {po.reference_number ? ` · ref ${po.reference_number}` : ''}
            </p>
          </div>
          <PairingLinkButton
            loading={linkingId === po.zoho_purchaseorder_id}
            disabled={linkingId !== null}
            onClick={() => void accept(po)}
            label="Accept"
          />
        </div>
      ))}
    </div>
  );
}
