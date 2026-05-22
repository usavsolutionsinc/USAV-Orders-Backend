'use client';

import { ReceivingPhotoStrip } from '@/components/sidebar/ReceivingPhotoStrip';

interface Props {
  receivingId: number | null;
  staffId: string;
  /** Opens the claim modal — surfaced as the right-side action. */
  onMakeClaim?: () => void;
}

/**
 * Single-row strip: photos on the left, Claim button on the right.
 * Staff / received / unboxed timestamps live in the Receiving Details panel.
 */
export function ReceivingCartonStaffDropdown({ receivingId, staffId, onMakeClaim }: Props) {
  if (receivingId == null) return null;

  return (
    <div className="flex items-stretch gap-3 bg-white px-4 py-3">
      <div className="min-w-0 flex-1">
        <ReceivingPhotoStrip
          receivingId={receivingId}
          staffId={Number(staffId) || 0}
        />
      </div>
      {onMakeClaim ? (
        <button
          type="button"
          onClick={onMakeClaim}
          className="inline-flex shrink-0 items-center gap-1 self-stretch rounded-lg bg-orange-500 px-4 text-[10px] font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-orange-600"
          title="File a damage / wrong-item / missing claim for this package"
        >
          Claim →
        </button>
      ) : null}
    </div>
  );
}
