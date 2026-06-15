'use client';

import { useStaffNameMap } from '@/hooks/useStaffNameMap';
import { DateTimeValue } from '@/design-system/components/DateTimeValue';
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

function StaffTimestampRow({
  at,
  staffName,
  emptyFallback,
}: {
  at: string | null | undefined;
  staffName: string;
  emptyFallback: string;
}) {
  const hasAt = Boolean(at && String(at).trim());
  if (!hasAt && !staffName) {
    return <span className="text-sm font-bold text-gray-400">{emptyFallback}</span>;
  }

  return (
    <div className="flex items-center justify-between gap-3">
      {staffName ? (
        <p className="min-w-0 truncate text-sm font-bold text-gray-900">{staffName}</p>
      ) : (
        <span className="text-sm font-bold text-gray-400">—</span>
      )}
      <DateTimeValue value={hasAt ? at : null} fallback={emptyFallback} />
    </div>
  );
}

/** Top-of-panel context: tracking scan, unboxing, receiving photos — matches shipped packing photos viewer. */
export function ReceivingOverviewCard({ log }: ReceivingOverviewCardProps) {
  const { getStaffName } = useStaffNameMap();

  const scanName = resolveStaffLabel(
    log.tracking_scanned_by_name,
    log.tracking_scanned_by,
    getStaffName,
  );
  const unboxName = resolveStaffLabel(log.unboxed_by_name, log.unboxed_by, getStaffName);

  return (
    <section className="rounded-2xl border border-gray-100 bg-gradient-to-br from-gray-50/90 to-white p-4 space-y-5 shadow-sm shadow-gray-100/40">
      <div className="space-y-4">
        <div>
          <p className="text-eyebrow font-black uppercase tracking-[0.2em] text-gray-500 mb-1.5">
            Tracking scanned
          </p>
          <StaffTimestampRow
            at={log.tracking_scanned_at}
            staffName={scanName}
            emptyFallback="Not recorded"
          />
        </div>

        <div>
          <p className="text-eyebrow font-black uppercase tracking-[0.2em] text-gray-500 mb-1.5">
            Unboxed by
          </p>
          <StaffTimestampRow
            at={log.unboxed_at}
            staffName={unboxName}
            emptyFallback="—"
          />
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
