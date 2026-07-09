'use client';

import { useMemo, useState } from 'react';
import type { ReceivingDetailsLog } from '@/components/station/receiving-details-log';
import type { ReceivingDetailFormActions } from '@/hooks/useReceivingDetailForm';
import type { CartonReadiness } from '@/lib/receiving/carton-readiness';
import { CopyableValueFieldBlock } from '@/components/shipped/details-panel/blocks/CopyableValueFieldBlock';
import { ReceivingPhotosSection } from './ReceivingPhotosSection';
import { ReceivingReadinessCallout } from './ReceivingReadinessCallout';
import { ReceivingCartonPipeline } from './ReceivingCartonPipeline';
import { ReceivingInventoryLinkageSection } from './ReceivingInventoryLinkageSection';

function resolveOptionalRows(log: ReceivingDetailsLog): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  if (log.qa_status && log.qa_status !== 'PENDING') rows.push({ label: 'QA', value: log.qa_status.replace(/_/g, ' ') });
  if (log.disposition_code) rows.push({ label: 'Disposition', value: log.disposition_code.replace(/_/g, ' ') });
  if (log.condition_grade) rows.push({ label: 'Condition', value: log.condition_grade.replace(/_/g, ' ') });
  if (log.return_platform) rows.push({ label: 'Return platform', value: log.return_platform.replace(/_/g, ' ') });
  if (log.return_reason) rows.push({ label: 'Return reason', value: log.return_reason });
  if (log.target_channel) rows.push({ label: 'Target channel', value: log.target_channel });
  return rows;
}

export function ReceivingProgressTab({
  log,
  readiness,
  form,
}: {
  log: ReceivingDetailsLog;
  readiness: CartonReadiness;
  form: ReceivingDetailFormActions;
}) {
  const [showMore, setShowMore] = useState(false);
  const extraRows = useMemo(() => resolveOptionalRows(log), [log]);

  return (
    <div className="space-y-4">
      <ReceivingReadinessCallout log={log} readiness={readiness} />

      <ReceivingCartonPipeline log={log} readiness={readiness} />

      <ReceivingPhotosSection
        receivingId={log.id}
        downloadLabel={`recv-${log.id}`}
        sectionTitle="Receiving photos"
      />

      <ReceivingInventoryLinkageSection log={log} form={form} />

      {extraRows.length > 0 ? (
        <section className="space-y-2">
          {/* ds-raw-button: simple disclosure toggle for optional carton metadata. */}
          <button
            type="button"
            className="ds-raw-button text-left text-eyebrow font-black uppercase tracking-widest text-text-soft hover:text-text-default"
            onClick={() => setShowMore((v) => !v)}
          >
            {showMore ? 'Hide carton details' : 'More carton details'}
          </button>
          {showMore ? (
            <div className="space-y-0">
              {extraRows.map((r, idx) => (
                <CopyableValueFieldBlock
                  key={`${r.label}-${idx}`}
                  label={r.label}
                  value={r.value}
                  variant="flat"
                  keepBottomDivider={idx < extraRows.length - 1}
                />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

