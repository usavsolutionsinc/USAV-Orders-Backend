'use client';

import type { ReceivingDetailsLog } from '@/components/station/receiving-details-log';
import type { CartonReadiness, CartonPipelineKey } from '@/lib/receiving/carton-readiness';
import { LinearWorkflowStepper, type LinearStep } from '@/components/receiving/workspace/ReceivingProgressStepper';
import { useStaffNameMap } from '@/hooks/useStaffNameMap';
import { formatClockTimePST, formatDatePST } from '@/utils/date';

const STEPS: ReadonlyArray<LinearStep> = [
  { key: 'scanned', label: 'Scanned' },
  { key: 'unboxed', label: 'Unboxed' },
  { key: 'received', label: 'Received' },
];

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

function StageRow({
  label,
  at,
  staffName,
  emptyFallback,
}: {
  label: string;
  at: string | null | undefined;
  staffName: string;
  emptyFallback: string;
}) {
  const hasAt = Boolean(at && String(at).trim());
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft">{label}</p>
        {staffName ? (
          <p className="truncate text-sm font-bold text-text-default">{staffName}</p>
        ) : (
          <p className="text-sm font-bold text-text-faint">—</p>
        )}
      </div>
      {hasAt ? (
        <div className="shrink-0 text-right tabular-nums">
          <p className="text-eyebrow font-bold uppercase tracking-widest text-text-muted">
            {formatDatePST(at, { withLeadingZeros: true })}
          </p>
          <p className="text-sm font-bold text-text-default">{formatClockTimePST(at)}</p>
        </div>
      ) : (
        <p className="shrink-0 text-eyebrow font-bold uppercase tracking-widest text-text-faint">
          {emptyFallback}
        </p>
      )}
    </div>
  );
}

function keyToStepperKey(key: CartonPipelineKey): string {
  return key;
}

export function ReceivingCartonPipeline({
  log,
  readiness,
}: {
  log: ReceivingDetailsLog;
  readiness: CartonReadiness;
}) {
  const { getStaffName } = useStaffNameMap();

  const scanName = resolveStaffLabel(
    log.tracking_scanned_by_name,
    log.tracking_scanned_by,
    getStaffName,
  );
  const unboxName = resolveStaffLabel(log.unboxed_by_name, log.unboxed_by, getStaffName);
  const receiveName = resolveStaffLabel(log.received_by_name, log.received_by, getStaffName);

  const states: Record<string, 'done' | 'active' | 'pending'> = {
    scanned: readiness.pipelineStates.scanned,
    unboxed: readiness.pipelineStates.unboxed,
    received: readiness.pipelineStates.received,
  };

  return (
    <div className="space-y-3">
      <LinearWorkflowStepper
        steps={STEPS.map((s) => ({ ...s, key: keyToStepperKey(s.key as CartonPipelineKey) }))}
        states={states}
        ariaLabel="Carton progress"
        className="w-full"
        size="compact"
      />

      <div className="divide-y divide-border-hairline">
        <StageRow
          label="Scanned"
          at={log.tracking_scanned_at}
          staffName={scanName}
          emptyFallback="Pending scan"
        />
        <StageRow
          label="Unboxed"
          at={log.unboxed_at}
          staffName={unboxName}
          emptyFallback="Pending unbox"
        />
        <StageRow
          label="Received"
          at={log.received_at}
          staffName={receiveName}
          emptyFallback="Not received"
        />
      </div>
    </div>
  );
}

