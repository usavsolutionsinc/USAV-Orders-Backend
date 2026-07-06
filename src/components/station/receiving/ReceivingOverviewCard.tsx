'use client';

import { useStaffNameMap } from '@/hooks/useStaffNameMap';
import { formatClockTimePST, formatDatePST } from '@/utils/date';
import type { ReceivingDetailsLog } from '@/components/station/receiving-details-log';
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
    return <span className="text-sm font-bold text-text-faint">{emptyFallback}</span>;
  }

  return (
    <div className="flex items-center justify-between gap-3">
      {staffName ? (
        <p className="min-w-0 truncate text-sm font-bold text-text-default">{staffName}</p>
      ) : (
        <span className="text-sm font-bold text-text-faint">—</span>
      )}
      {hasAt ? (
        <div className="flex shrink-0 items-baseline gap-2 tabular-nums">
          <span className="text-sm font-bold text-text-muted">
            {formatDatePST(at, { withLeadingZeros: true })}
          </span>
          <span className="text-sm font-bold text-text-default">{formatClockTimePST(at)}</span>
        </div>
      ) : (
        <span className="shrink-0 text-sm font-bold tabular-nums text-text-faint">{emptyFallback}</span>
      )}
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
  const receiveName = resolveStaffLabel(log.received_by_name, log.received_by, getStaffName);

  return (
    <section className="rounded-2xl border border-border-hairline bg-gradient-to-br from-gray-50/90 to-white p-4 space-y-5 shadow-sm shadow-gray-100/40">
      {/* Photos first — primary operator capture surface */}
      <div className="space-y-3">
        <ReceivingPhotosSection
          receivingId={log.id}
          downloadLabel={`recv-${log.id}`}
          sectionTitle="Receiving photos"
        />
      </div>

      {/* 3-stage operator lifecycle: Scanned → Unboxed → Received. */}
      <div className="space-y-4 pt-1 border-t border-border-hairline">
        <div>
          <p className="text-eyebrow font-black uppercase tracking-[0.2em] text-text-soft mb-1.5">
            Scanned
          </p>
          <StaffTimestampRow
            at={log.tracking_scanned_at}
            staffName={scanName}
            emptyFallback="Not recorded"
          />
        </div>

        <div>
          <p className="text-eyebrow font-black uppercase tracking-[0.2em] text-text-soft mb-1.5">
            Unboxed
          </p>
          <StaffTimestampRow
            at={log.unboxed_at}
            staffName={unboxName}
            emptyFallback="—"
          />
        </div>

        <div>
          <p className="text-eyebrow font-black uppercase tracking-[0.2em] text-text-soft mb-1.5">
            Received
          </p>
          <StaffTimestampRow
            at={log.received_at}
            staffName={receiveName}
            emptyFallback="—"
          />
        </div>
      </div>
    </section>
  );
}
