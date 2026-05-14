'use client';

import QRCode from 'react-qr-code';
import {
  receivingLabelPoCornerDisplay,
  resolveReceivingQrValue,
  type ReceivingLabelPayload,
} from '@/lib/print/printReceivingLabel';

/**
 * On-screen preview matching {@link printReceivingLabel}'s 2×1" layout.
 * The QR encodes the mobile carton URL ({origin}/m/r/{receivingId}) by
 * default — phones scanning it open the carton page natively.
 */
export function ReceivingCartonLabel(payload: ReceivingLabelPayload) {
  const human = payload.scanValue.trim();
  if (!human && payload.receivingId == null) return null;
  const qrPayload = resolveReceivingQrValue(payload);
  if (!qrPayload) return null;

  return (
    <div className="w-full rounded border border-gray-200 bg-white px-2 py-2 shadow-sm">
      <div className="flex flex-nowrap items-stretch gap-3 min-h-[5rem]">
        <div className="min-w-0 flex-1 flex flex-col justify-between py-0.5">
          <div className="flex items-baseline justify-between gap-2 text-[12px] leading-none">
            <span className="truncate font-bold text-gray-700">{payload.platform}</span>
            <span className="shrink-0 tabular-nums font-semibold text-gray-600">
              {payload.date}
            </span>
          </div>
          <div className="flex min-h-0 flex-[1_1_auto] min-w-0 items-center justify-center px-0.5 text-center">
            <span className="line-clamp-3 w-full break-words text-[11px] font-semibold leading-tight text-gray-900">
              {(payload.notes || '').trim()}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2 text-[13px] leading-none">
            <ConditionHeaderDisplay code={payload.conditionCode} />
            <span className="shrink-0 tabular-nums font-black text-gray-900">
              {receivingLabelPoCornerDisplay(payload)}
            </span>
          </div>
        </div>
        <div className="shrink-0 flex items-center">
          <QRCode value={qrPayload} size={80} level="M" fgColor="#000000" bgColor="#ffffff" />
        </div>
      </div>
    </div>
  );
}

function ConditionHeaderDisplay({ code }: { code: string }) {
  const c = String(code || 'BRAND_NEW').trim().toUpperCase();
  if (c === 'BRAND_NEW') return <span className="font-black text-gray-900">New</span>;
  if (c === 'PARTS') return <span className="font-black text-gray-900">Parts</span>;
  if (c.startsWith('USED_')) {
    const letter = c.replace('USED_', '');
    return (
      <span className="font-black tracking-tight text-gray-900">USED-{letter}</span>
    );
  }
  return <span className="font-semibold text-gray-800">{c.replace(/_/g, ' ')}</span>;
}
