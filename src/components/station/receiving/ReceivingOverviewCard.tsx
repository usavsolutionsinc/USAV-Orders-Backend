'use client';

import { useStaffNameMap } from '@/hooks/useStaffNameMap';
import { DateTimeValue } from '@/design-system/components/DateTimeValue';
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

/** Triage door scan predates the Unbox-surface open by a meaningful gap. */
function doorScanPredatesUnboxOpen(
  doorAt: string | null | undefined,
  unboxOpenAt: string | null | undefined,
): boolean {
  if (!doorAt || !unboxOpenAt) return false;
  const doorMs = new Date(doorAt).getTime();
  const unboxMs = new Date(unboxOpenAt).getTime();
  if (!Number.isFinite(doorMs) || !Number.isFinite(unboxMs)) return false;
  // Same-session scans land within seconds; triage-then-unbox is minutes+ apart.
  return doorMs < unboxMs - 120_000;
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
  const unboxOpenName = resolveStaffLabel(
    log.unbox_opened_by_name,
    log.unbox_opened_by,
    getStaffName,
  );
  const unboxName = resolveStaffLabel(log.unboxed_by_name, log.unboxed_by, getStaffName);
  const receiveName = resolveStaffLabel(log.received_by_name, log.received_by, getStaffName);

  const hasUnboxOpen = Boolean(log.unbox_opened_at && String(log.unbox_opened_at).trim());
  const showDoorScan =
    Boolean(log.tracking_scanned_at && String(log.tracking_scanned_at).trim()) &&
    (!hasUnboxOpen || doorScanPredatesUnboxOpen(log.tracking_scanned_at, log.unbox_opened_at));

  return (
    <section className="rounded-2xl border border-gray-100 bg-gradient-to-br from-gray-50/90 to-white p-4 space-y-5 shadow-sm shadow-gray-100/40">
      {/* Photos first — primary operator capture surface */}
      <div className="space-y-3">
        <ReceivingPhotosSection
          receivingId={log.id}
          downloadLabel={`recv-${log.id}`}
          sectionTitle="Receiving photos"
        />
      </div>

      <div className="space-y-4 pt-1 border-t border-gray-100">
        {showDoorScan ? (
          <div>
            <p className="text-eyebrow font-black uppercase tracking-[0.2em] text-gray-500 mb-1.5">
              Tracking scanned (door scan)
            </p>
            <StaffTimestampRow
              at={log.tracking_scanned_at}
              staffName={scanName}
              emptyFallback="Not recorded"
            />
          </div>
        ) : null}

        {hasUnboxOpen ? (
          <div>
            <p className="text-eyebrow font-black uppercase tracking-[0.2em] text-gray-500 mb-1.5">
              Opened for unbox
            </p>
            <StaffTimestampRow
              at={log.unbox_opened_at}
              staffName={unboxOpenName}
              emptyFallback="—"
            />
          </div>
        ) : null}

        {!showDoorScan && !hasUnboxOpen ? (
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
        ) : null}

        <div>
          <p className="text-eyebrow font-black uppercase tracking-[0.2em] text-gray-500 mb-1.5">
            Unboxed
          </p>
          <StaffTimestampRow
            at={log.unboxed_at}
            staffName={unboxName}
            emptyFallback="—"
          />
        </div>

        <div>
          <p className="text-eyebrow font-black uppercase tracking-[0.2em] text-gray-500 mb-1.5">
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
