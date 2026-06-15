'use client';

import { DetailsPanelRow } from '@/design-system/components/DetailsPanelRow';
import { CopyActionIcon } from '@/design-system/components/CopyActionIcon';

/**
 * Canonical serial-numbers ledger row — the single reusable display for serials
 * across the shipped details panel (Return Info + Shipping tab). Serials render
 * as one truncated CSV line, with a copy-all icon in the row actions.
 */
export function SerialNumbersRow({
  serials,
  label = 'Serial Numbers',
}: {
  serials: string[];
  label?: string;
}) {
  const serialsCsv = serials.join(', ');

  return (
    <DetailsPanelRow
      label={label}
      actions={
        serials.length > 0 ? (
          <div className="flex items-center gap-1.5 text-gray-400">
            <CopyActionIcon
              value={serialsCsv}
              ariaLabel="Copy all serial numbers"
              title="Copy all serial numbers"
            />
          </div>
        ) : undefined
      }
    >
      {serials.length > 0 ? (
        <p className="truncate font-mono text-sm font-bold text-gray-900">{serialsCsv}</p>
      ) : (
        <p className="text-sm font-bold text-gray-400">N/A</p>
      )}
    </DetailsPanelRow>
  );
}
