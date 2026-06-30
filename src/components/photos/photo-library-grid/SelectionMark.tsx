'use client';

import { Check } from '@/components/Icons';
import { cn } from '@/utils/_cn';

/**
 * The hover/active selection checkmark. Rendered as its own button (a sibling of
 * the tile's activation button, never nested inside it) so it toggles selection
 * without nested-interactive markup. Hidden until hover unless selection is
 * active, then always shown so the whole grid reads as selectable.
 */
export function SelectionMark({
  checked,
  active,
  onToggle,
}: {
  checked: boolean;
  active: boolean;
  /** Forwards the Shift modifier so a shift-click on the mark extends a range. */
  onToggle: (mods: { shift: boolean }) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      aria-label={checked ? 'Deselect photo' : 'Select photo'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle({ shift: e.shiftKey });
      }}
      className={cn(
        'ds-raw-button absolute left-2 top-2 z-20 inline-flex h-6 w-6 items-center justify-center rounded-full border shadow-sm transition',
        checked
          ? 'border-blue-600 bg-blue-600 text-white opacity-100'
          : cn(
              'border-white/80 bg-white/90 text-gray-400 backdrop-blur-sm hover:border-blue-200 hover:text-blue-600 focus:opacity-100',
              active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            ),
      )}
    >
      <Check className="h-3.5 w-3.5 stroke-[2.5]" />
    </button>
  );
}
