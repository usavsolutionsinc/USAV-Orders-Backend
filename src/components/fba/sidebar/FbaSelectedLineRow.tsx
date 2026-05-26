'use client';

import type { ReactNode } from 'react';
import { Pencil } from '@/components/Icons';
import { FnskuChip } from '@/components/ui/CopyChip';
import { PrintTableCheckbox } from '@/components/fba/table/Checkbox';
import { dataValue, fieldLabel } from '@/design-system/tokens/typography/presets';
import type { StationTheme } from '@/utils/staff-colors';

export interface FbaSelectedLineRowProps {
  displayTitle: string;
  fnsku: string;
  /** Shown above the title (e.g. line already on today's FBA plan). */
  microcopyAboveTitle?: string;
  microcopyTone?: 'default' | 'success';
  stationTheme?: StationTheme;
  checked?: boolean;
  checkboxDisabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Opens Quick Add / catalog edit; always shown at full contrast when provided. */
  onEditDetails?: () => void;
  /** Typically qty steppers — rendered in the right column, vertically centered with the title block. */
  rightSlot: ReactNode;
  /** When provided, replaces the checkbox column with this node (e.g. a drag handle). */
  leadingSlot?: ReactNode;
  /** When true, the leading column is removed entirely (no checkbox, no slot). Read-only displays. */
  hideCheckbox?: boolean;
}

/** Optional microcopy + title + FNSKU below, left; optional right column (e.g. qty stepper). */
export function FbaSelectedLineRow({
  displayTitle,
  fnsku,
  microcopyAboveTitle,
  microcopyTone = 'default',
  stationTheme = 'green',
  checked = true,
  checkboxDisabled = false,
  onCheckedChange,
  onEditDetails,
  rightSlot,
  leadingSlot,
  hideCheckbox = false,
}: FbaSelectedLineRowProps) {
  const microcopyColor = microcopyTone === 'success' ? 'text-emerald-700' : 'text-gray-500';
  const showLeading = !hideCheckbox;
  const gridCols = showLeading
    ? 'grid-cols-[auto_minmax(0,1fr)_auto]'
    : 'grid-cols-[minmax(0,1fr)_auto]';
  const titleColStart = showLeading ? 'col-start-2' : 'col-start-1';
  const metaColStart = showLeading ? 'col-start-2' : 'col-start-1';
  const rightColStart = showLeading ? 'col-start-3' : 'col-start-2';

  return (
    <div className={`grid ${gridCols} grid-rows-[auto_auto] items-start gap-x-2.5 gap-y-1 border-b border-gray-100 px-3 py-2 last:border-b-0`}>
      {showLeading && (
        <div className="row-span-2">
          {leadingSlot ?? (
            <PrintTableCheckbox
              checked={checked}
              stationTheme={stationTheme}
              disabled={checkboxDisabled}
              onChange={(next) => onCheckedChange?.(next)}
              label={checked ? 'Unselect item' : 'Select item'}
            />
          )}
        </div>
      )}
      <div className={`${titleColStart} row-start-1 flex min-w-0 flex-col items-start gap-0.5 self-start`}>
        {microcopyAboveTitle ? (
          <p className={`w-full ${fieldLabel} ${microcopyColor}`}>
            {microcopyAboveTitle}
          </p>
        ) : null}
        <p className={`min-w-0 w-full whitespace-normal break-words leading-snug ${dataValue}`}>
          {displayTitle}
        </p>
      </div>
      <div className={`${metaColStart} row-start-2 flex items-center justify-end gap-1.5 self-end pt-0.5`}>
        {onEditDetails ? (
          <button
            type="button"
            onPointerDown={(e) => {
              /* Beat parent taps / drag handlers that might steal activation on touch */
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              onEditDetails();
            }}
            className="relative z-10 flex min-h-[2.25rem] min-w-[2.25rem] shrink-0 items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 active:bg-gray-200"
            aria-label={`Edit catalog details for ${fnsku}`}
            title="Edit catalog details"
          >
            <Pencil className="h-4 w-4 shrink-0" />
          </button>
        ) : null}
        <FnskuChip value={fnsku} />
      </div>
      <div className={`${rightColStart} row-span-2 flex shrink-0 flex-col items-start pt-0.5`}>{rightSlot}</div>
    </div>
  );
}
