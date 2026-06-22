import { X } from '@/components/Icons';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

interface Props {
  row: ReceivingLineRow;
  submitting: boolean;
  onClose: () => void;
}

/** Modal header — claim eyebrow + carton/PO title + cancel affordance. */
export function ClaimModalHeader({ row, submitting, onClose }: Props) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-gray-100 bg-gradient-to-r from-rose-50 to-amber-50 px-5 py-4">
      <div>
        <p className="text-micro font-black uppercase tracking-[0.14em] text-rose-700">File a claim</p>
        <p className="mt-0.5 text-base font-extrabold tracking-tight text-gray-900">
          {row.receiving_source === 'unmatched'
            ? 'Unfound'
            : row.zoho_purchaseorder_number
              ? `PO ${row.zoho_purchaseorder_number}`
              : `Receiving #${row.receiving_id ?? '—'}`}
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        disabled={submitting}
        aria-label="Cancel"
        className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white hover:text-gray-700 disabled:opacity-50"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
