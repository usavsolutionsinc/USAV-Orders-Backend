'use client';

import { LabelFacePreview } from '@/components/labels/LabelFacePreview';
import { receivingPayloadToFace, type ReceivingLabelPayload } from '@/lib/print/printReceivingLabel';

/**
 * On-screen render of the printed PO / carton label. A thin adapter over the
 * shared {@link LabelFacePreview}: maps the carton payload onto the common
 * {@link LabelFaceModel} via `receivingPayloadToFace` — the exact same model the
 * print paths use — so the preview and the printed sticker can't drift.
 * `embedded` strips the outer card chrome for use inside the print menu.
 */
export function ReceivingPoLabelPreview({
  embedded,
  ...payload
}: ReceivingLabelPayload & { embedded?: boolean }) {
  const face = receivingPayloadToFace(payload);
  if (!face.matrix.value) return null;

  if (embedded) {
    return <LabelFacePreview model={face} embedded />;
  }
  return (
    <div className="border-t border-gray-200 bg-gray-50">
      <div className="flex items-center gap-3 px-3 pt-3 pb-2">
        <span className="text-eyebrow font-black tabular-nums text-gray-500 tracking-widest">03</span>
        <span className="text-eyebrow font-black uppercase tracking-[0.18em] text-gray-600">
          Review &amp; print
        </span>
      </div>
      <div className="px-3 pb-3">
        <LabelFacePreview model={face} />
      </div>
    </div>
  );
}
