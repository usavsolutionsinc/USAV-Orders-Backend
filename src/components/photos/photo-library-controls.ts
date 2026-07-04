import { cn } from '@/utils/_cn';

/** Bordered control cluster — shared by view toggles and sort pills in the 40px header. */
export const photoLibraryControlGroupClass =
  'flex items-center rounded-lg border border-border-soft bg-surface-card p-0.5';

export function photoLibraryControlButtonClass(active: boolean, extra?: string) {
  return cn(
    'flex h-7 items-center justify-center rounded-md text-micro font-semibold leading-none transition-colors',
    active
      ? 'bg-blue-600 text-white shadow-sm'
      : 'text-text-soft hover:bg-surface-sunken hover:text-text-default',
    extra,
  );
}
