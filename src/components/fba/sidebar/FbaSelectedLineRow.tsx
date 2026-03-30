'use client';

import type { ReactNode } from 'react';
import { FnskuChip } from '@/components/ui/CopyChip';
import { dataValue, fieldLabel } from '@/design-system/tokens/typography/presets';

export interface FbaSelectedLineRowProps {
  displayTitle: string;
  fnsku: string;
  /** Shown above the title (e.g. line already on today's FBA plan). */
  microcopyAboveTitle?: string;
  microcopyTone?: 'default' | 'success';
  /** Typically qty steppers — rendered in the right column, vertically centered with the title block. */
  rightSlot: ReactNode;
}

/** Optional microcopy + title + FNSKU below, left; optional right column (e.g. qty stepper). */
export function FbaSelectedLineRow({
  displayTitle,
  fnsku,
  microcopyAboveTitle,
  microcopyTone = 'default',
  rightSlot,
}: FbaSelectedLineRowProps) {
  const microcopyColor = microcopyTone === 'success' ? 'text-emerald-700' : 'text-gray-500';

  return (
    <div className="flex items-center gap-2 px-3 py-3">
      <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5 self-center">
        {microcopyAboveTitle ? (
          <p className={`w-full ${fieldLabel} ${microcopyColor}`}>
            {microcopyAboveTitle}
          </p>
        ) : null}
        <p className={`min-w-0 w-full whitespace-normal break-words leading-snug ${dataValue}`}>
          {displayTitle}
        </p>
        <div className="self-start">
          <FnskuChip value={fnsku} />
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-center">{rightSlot}</div>
    </div>
  );
}
