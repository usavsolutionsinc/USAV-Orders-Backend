'use client';

import { ReceivingPhotoStrip } from '@/components/sidebar/ReceivingPhotoStrip';
import { receivingPriorityTone } from '@/components/receiving/workspace/line-edit/receiving-priority';

interface Props {
  receivingId: number | null;
  staffId: string;
  /**
   * Platform-derived priority rank for this carton (lower = more urgent).
   * Rendered as a fixed-width badge on the left, mirroring the Claim pill.
   */
  priorityRank?: number;
  /** Opens the claim modal — surfaced as the right-side action. */
  onMakeClaim?: () => void;
}

/**
 * Single-row strip: priority badge + photos on the left, Claim button on the
 * right. Staff / received / unboxed timestamps live in the Receiving Details
 * panel.
 */
export function ReceivingCartonStaffDropdown({ receivingId, staffId, priorityRank, onMakeClaim }: Props) {
  if (receivingId == null) return null;

  const priorityTone = priorityRank != null ? receivingPriorityTone(priorityRank) : null;

  return (
    <div className="flex items-stretch gap-2 bg-white px-4 py-2">
      {priorityTone ? (
        // Fixed 75px wide to mirror the Claim pill on the far right; `h-9` +
        // `self-center` keep it stable against the photo strip's variable height.
        <span
          className={`inline-flex h-9 w-[75px] shrink-0 items-center justify-center self-center rounded-lg text-caption font-bold shadow-sm ${priorityTone.className}`}
          title={priorityTone.title}
        >
          {priorityTone.label}
        </span>
      ) : null}
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
          // Fixed `h-9` + `self-center` decouples the button's shape from the
          // photo strip's variable height (loading text vs. loaded toolbar vs.
          // NAS dropzone). It now matches the loaded toolbar's `min-h-9` and
          // stays a stable pill across every strip state.
          className="inline-flex h-9 shrink-0 items-center gap-1 self-center rounded-lg bg-orange-500 px-3 text-micro font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-orange-600"
          title="File a damage / wrong-item / missing claim for this package"
        >
          Claim →
        </button>
      ) : null}
    </div>
  );
}
