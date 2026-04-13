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
}: FbaSelectedLineRowProps) {
  const microcopyColor = microcopyTone === 'success' ? 'text-emerald-700' : 'text-gray-500';

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[auto_auto] items-start gap-x-2 gap-y-1 border-b border-gray-100 px-2 py-2 last:border-b-0">
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
      <div className="col-start-2 row-start-1 flex min-w-0 flex-col items-start gap-0.5 self-start">
        {microcopyAboveTitle ? (
          <p className={`w-full ${fieldLabel} ${microcopyColor}`}>
            {microcopyAboveTitle}
          </p>
        ) : null}
        <p className={`min-w-0 w-full whitespace-normal break-words leading-snug ${dataValue}`}>
          {displayTitle}
        </p>
      </div>
      <div className="col-start-2 row-start-2 flex items-center justify-end gap-1.5 self-end pt-0.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEditDetails?.();
          }}
          className={[
            'flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-600 transition-colors',
            onEditDetails
              ? 'hover:bg-gray-100 hover:text-gray-900'
              : 'pointer-events-none cursor-default',
          ].join(' ')}
          aria-disabled={!onEditDetails}
          aria-label={onEditDetails ? `Edit catalog details for ${fnsku}` : `FNSKU ${fnsku}`}
          title={onEditDetails ? 'Edit catalog details' : undefined}
        >
          <Pencil className="h-3 w-3" />
        </button>
        <FnskuChip value={fnsku} />
      </div>
      <div className="col-start-3 row-span-2 flex shrink-0 flex-col items-start pt-0.5">{rightSlot}</div>
    </div>
  );
}
