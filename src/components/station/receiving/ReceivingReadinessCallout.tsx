'use client';

import type { ReceivingDetailsLog } from '@/components/station/receiving-details-log';
import type { CartonReadiness } from '@/lib/receiving/carton-readiness';
import { formatDateTimePST } from '@/utils/date';

export function ReceivingReadinessCallout({
  log,
  readiness,
}: {
  log: ReceivingDetailsLog;
  readiness: CartonReadiness;
}) {
  const hint =
    readiness.stage === 'awaiting_unbox' && log.tracking_scanned_at
      ? `Scanned ${formatDateTimePST(log.tracking_scanned_at)}`
      : readiness.stage === 'awaiting_receive' && log.unboxed_at
        ? `Unboxed ${formatDateTimePST(log.unboxed_at)}`
        : readiness.stage === 'lines_in_progress' && log.received_at
          ? `Received ${formatDateTimePST(log.received_at)}`
          : null;

  return (
    <div className="space-y-1">
      <p className="text-sm font-bold text-text-default">{readiness.nextStep}</p>
      {hint ? (
        <p className="text-eyebrow font-bold uppercase tracking-widest text-text-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

