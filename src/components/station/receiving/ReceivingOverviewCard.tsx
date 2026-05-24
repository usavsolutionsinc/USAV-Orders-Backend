'use client';

import { getStaffName } from '@/utils/staff';
import { formatDateTimePST } from '@/utils/date';
import type { ReceivingDetailsLog } from '@/components/station/ReceivingDetailsStack';
import { ReceivingPhotosSection } from './ReceivingPhotosSection';

interface ReceivingOverviewCardProps {
  log: ReceivingDetailsLog;
}

/** Top-of-panel context: tracking scan, unboxing, receiving photos — matches shipped packing photos viewer. */
export function ReceivingOverviewCard({ log }: ReceivingOverviewCardProps) {
  // Tracking-scan row shows the timestamp only — operator attribution lives
  // on the unboxing row below where it carries more meaning.
  const scanTime = log.tracking_scanned_at ? formatDateTimePST(log.tracking_scanned_at) : '';

  // Unboxed row carries the staff name + timestamp. Fall back to scan-time
  // attribution when unboxed_at / unboxed_by are missing — most often the
  // same operator handled both, and showing a name with no time (or vice
  // versa) reads as broken data.
  const unboxAt = log.unboxed_at ?? log.tracking_scanned_at ?? null;
  const unboxTime = unboxAt ? formatDateTimePST(unboxAt) : '';
  const unboxStaffId = log.unboxed_by ?? log.tracking_scanned_by ?? null;
  const unboxName = unboxStaffId ? getStaffName(unboxStaffId) : '';
  const unboxPart =
    unboxName && unboxTime ? `${unboxTime} · ${unboxName}` : unboxTime || unboxName;

  return (
    <section className="rounded-2xl border border-gray-100 bg-gradient-to-br from-gray-50/90 to-white p-4 space-y-5 shadow-sm shadow-gray-100/40">
      <div className="space-y-4">
        <div>
          <p className="text-eyebrow font-black uppercase tracking-[0.2em] text-gray-500 mb-1.5">
            Tracking scanned
          </p>
          <p className="text-sm font-bold text-gray-900 leading-snug">
            {scanTime || <span className="text-gray-400 font-semibold">Not recorded</span>}
          </p>
        </div>

        <div>
          <p className="text-eyebrow font-black uppercase tracking-[0.2em] text-gray-500 mb-1.5">
            Unboxed by
          </p>
          <p className="text-sm font-bold text-gray-900 leading-snug">
            {unboxPart || <span className="text-gray-400 font-semibold">—</span>}
          </p>
        </div>
      </div>

      <div className="space-y-3 pt-1 border-t border-gray-100">
        <ReceivingPhotosSection
          receivingId={log.id}
          downloadLabel={`recv-${log.id}`}
          sectionTitle="Receiving photos"
        />
      </div>
    </section>
  );
}
