'use client';

import { getStaffName } from '@/utils/staff';
import { formatDateTimePST } from '@/utils/date';
import type { ReceivingDetailsLog } from '@/components/station/ReceivingDetailsStack';
import { ReceivingPhotosSection } from './ReceivingPhotosSection';

interface ReceivingOverviewCardProps {
  log: ReceivingDetailsLog;
}

function activityLine(at: string | null | undefined, staffId: number | null | undefined): string {
  const t = at ? formatDateTimePST(at) : '';
  const name = staffId ? getStaffName(staffId) : '';
  if (name && t) return `${name} · ${t}`;
  if (t) return t;
  if (name) return name;
  return '';
}

/** Top-of-panel context: tracking scan, unboxing, receiving photos — matches shipped packing photos viewer. */
export function ReceivingOverviewCard({ log }: ReceivingOverviewCardProps) {
  const scanPart = activityLine(log.tracking_scanned_at, log.tracking_scanned_by);
  const unboxPart = activityLine(log.unboxed_at, log.unboxed_by);

  return (
    <section className="rounded-2xl border border-gray-100 bg-gradient-to-br from-gray-50/90 to-white p-4 space-y-5 shadow-sm shadow-gray-100/40">
      <div className="space-y-4">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-500 mb-1.5">
            Unboxed by
          </p>
          <p className="text-[13px] font-bold text-gray-900 leading-snug">
            {unboxPart || <span className="text-gray-400 font-semibold">—</span>}
          </p>
        </div>

        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-500 mb-1.5">
            Tracking scanned
          </p>
          <p className="text-[13px] font-bold text-gray-900 leading-snug">
            {scanPart || <span className="text-gray-400 font-semibold">Not recorded</span>}
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
