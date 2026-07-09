'use client';

import { Check } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { cn } from '@/utils/_cn';

/** PO/ticket group select-all — matches {@link SelectionMark} tile styling. */
export function GroupSelectionMark({
  allSelected,
  someSelected,
  label,
  onToggle,
}: {
  allSelected: boolean;
  someSelected: boolean;
  label: string;
  onToggle: () => void;
}) {
  const tooltip = allSelected ? `Deselect all in ${label}` : `Select all in ${label}`;

  return (
    <HoverTooltip label={tooltip} asChild>
      <button
        type="button"
        aria-pressed={allSelected}
        aria-label={tooltip}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggle();
        }}
        className={cn(
          'ds-raw-button inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border shadow-sm transition',
          allSelected
            ? 'border-blue-600 bg-blue-600 text-white'
            : someSelected
              ? 'border-blue-600 bg-blue-50 text-blue-600'
              : 'border-border-soft bg-surface-card text-text-faint hover:border-blue-200 hover:text-blue-600',
        )}
      >
        {allSelected ? <Check className="h-3.5 w-3.5 stroke-[2.5]" /> : null}
      </button>
    </HoverTooltip>
  );
}
