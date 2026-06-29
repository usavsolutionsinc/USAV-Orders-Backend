'use client';

import { cn } from '@/utils/_cn';
import type { TimelineTone } from '@/lib/timeline/types';
import { SUBSTITUTION_REASONS, type SubstitutionReason } from '@/lib/fulfillment/substitution-reasons';

/**
 * Reason picker for a fulfillment substitution. Presentational + controlled —
 * the parent owns the selected code. Reasons + their tones come from the SoT
 * (substitution-reasons.ts); this component only maps a TimelineTone to the
 * house 3-layer chip classes (bg-x-50 / text-x-700 / ring-x-200) per
 * ui-design-system.md, adding a ring emphasis for the selected pill.
 */

const TONE_CHIP: Record<TimelineTone, { base: string; selected: string }> = {
  info: { base: 'bg-blue-50 text-blue-700 ring-blue-200', selected: 'bg-blue-100 ring-blue-400' },
  warning: { base: 'bg-amber-50 text-amber-700 ring-amber-200', selected: 'bg-amber-100 ring-amber-400' },
  danger: { base: 'bg-rose-50 text-rose-700 ring-rose-200', selected: 'bg-rose-100 ring-rose-400' },
  success: { base: 'bg-emerald-50 text-emerald-700 ring-emerald-200', selected: 'bg-emerald-100 ring-emerald-400' },
  muted: { base: 'bg-gray-50 text-gray-600 ring-gray-200', selected: 'bg-gray-100 ring-gray-400' },
  default: { base: 'bg-gray-50 text-gray-600 ring-gray-200', selected: 'bg-gray-100 ring-gray-400' },
};

export interface SubstituteReasonPickerProps {
  value: string | null;
  onChange: (code: string) => void;
  reasons?: readonly SubstitutionReason[];
  className?: string;
}

export function SubstituteReasonPicker({
  value,
  onChange,
  reasons = SUBSTITUTION_REASONS,
  className,
}: SubstituteReasonPickerProps) {
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)} role="radiogroup" aria-label="Substitution reason">
      {reasons.map((r) => {
        const tone = TONE_CHIP[r.tone] ?? TONE_CHIP.default;
        const selected = value === r.code;
        return (
          <button
            key={r.code}
            type="button"
            role="radio"
            aria-checked={selected}
            data-testid={`reason-${r.code}`}
            onClick={() => onChange(r.code)}
            className={cn(
              'ds-raw-button',
              'rounded-full px-2.5 py-1 text-micro font-black uppercase tracking-widest ring-1 ring-inset transition-colors',
              tone.base,
              selected ? cn(tone.selected, 'ring-2') : 'opacity-80 hover:opacity-100',
            )}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}
