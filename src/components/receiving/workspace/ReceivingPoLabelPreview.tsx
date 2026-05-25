'use client';

import { Gs1DataMatrix } from '@/components/barcode/Gs1DataMatrix';
import { receivingLabelPoCornerDisplay } from '@/lib/print/printReceivingLabel';
import {
  ConditionHeaderDisplay,
  resolveReceivingLabelQrValue,
  type ReceivingLabelPayload,
} from './receiving-label-helpers';

/**
 * On-screen render of the printed PO / carton label. Mirrors
 * `printReceivingLabel`'s output so techs can verify before printing.
 * `embedded` strips the outer card chrome for use inside the print menu.
 */
export function ReceivingPoLabelPreview({
  receivingId,
  scanValue,
  platform,
  notes,
  zendeskTicket,
  trackingNumber,
  conditionCode,
  date,
  embedded,
}: ReceivingLabelPayload & { embedded?: boolean }) {
  const safe = scanValue.trim();
  const qrPayload = resolveReceivingLabelQrValue({
    receivingId,
    scanValue,
    platform,
    notes,
    zendeskTicket,
    trackingNumber,
    conditionCode,
    date,
  });
  if (!qrPayload) return null;
  const innerShell = embedded
    ? 'w-full bg-white'
    : 'w-full rounded-lg border border-gray-200/80 bg-white px-3 py-3 shadow-sm';
  const inner = (
    <div className={innerShell}>
      <div className="flex min-h-[6.5rem] flex-nowrap items-stretch gap-4">
        <div className="min-w-0 flex flex-1 flex-col justify-between py-1">
          <div className="flex items-baseline justify-between gap-2 text-sm leading-none">
            <span className="truncate font-bold text-gray-700">{platform}</span>
            <span className="shrink-0 tabular-nums font-semibold text-gray-600">{date}</span>
          </div>
          <div className="flex min-h-0 flex-1 min-w-0 items-center justify-center px-0.5">
            <span className="line-clamp-3 w-full text-center text-caption font-semibold leading-tight tracking-normal text-gray-900 normal-case">
              {notes.trim()}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2 text-base leading-none">
            <ConditionHeaderDisplay code={conditionCode} />
            <span className="shrink-0 tabular-nums font-black text-gray-900">
              {receivingLabelPoCornerDisplay({
                receivingId,
                scanValue: safe,
                platform,
                notes,
                zendeskTicket,
                trackingNumber,
                conditionCode,
                date,
              })}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center [&_svg]:block">
          <Gs1DataMatrix value={qrPayload} size={96} symbology="datamatrix" />
        </div>
      </div>
    </div>
  );
  if (embedded) {
    return inner;
  }
  return (
    <div className="border-t border-gray-200 bg-gray-50">
      <div className="flex items-center gap-3 px-3 pt-3 pb-2">
        <span className="text-eyebrow font-black tabular-nums text-gray-500 tracking-widest">03</span>
        <span className="text-eyebrow font-black uppercase tracking-[0.18em] text-gray-600">
          Review &amp; print
        </span>
      </div>
      <div className="px-3 pb-3">{inner}</div>
    </div>
  );
}
