'use client';

import { useStaffNameMap } from '@/hooks/useStaffNameMap';
import { formatDateTimePST } from '@/utils/date';
import type { ReceivingDetailsLog } from '@/components/station/ReceivingDetailsStack';
import { ReceivingPhotosSection } from './ReceivingPhotosSection';

interface ReceivingOverviewCardProps {
  log: ReceivingDetailsLog;
}

function resolveStaffLabel(
  nameFromApi: string | null | undefined,
  staffId: number | null | undefined,
  getStaffName: (id: number | null | undefined) => string,
): string {
  const trimmed = String(nameFromApi ?? '').trim();
  if (trimmed) return trimmed;
  if (staffId) return getStaffName(staffId);
  return '';
}

/** Top-of-panel context: tracking scan, unboxing, receiving photos — matches shipped packing photos viewer. */
export function ReceivingOverviewCard({ log }: ReceivingOverviewCardProps) {
  const { getStaffName } = useStaffNameMap();

  const scanTime = log.tracking_scanned_at ? formatDateTimePST(log.tracking_scanned_at) : '';
  const scanName = resolveStaffLabel(
    log.tracking_scanned_by_name,
    log.tracking_scanned_by,
    getStaffName,
  );
  const scanPart =
    scanName && scanTime ? `${scanTime} · ${scanName}` : scanTime || scanName;

  const unboxAt = log.unboxed_at ?? null;
  const unboxTime = unboxAt ? formatDateTimePST(unboxAt) : '';
  const unboxName = resolveStaffLabel(log.unboxed_by_name, log.unboxed_by, getStaffName);
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
            {scanPart || <span className="text-gray-400 font-semibold">Not recorded</span>}
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
