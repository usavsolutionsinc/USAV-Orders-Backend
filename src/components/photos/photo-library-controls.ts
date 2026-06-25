import { cn } from '@/utils/_cn';

/** Bordered control cluster — shared by view toggles and sort pills in the 40px header. */
export const photoLibraryControlGroupClass =
  'flex items-center rounded-lg border border-gray-200 bg-white p-0.5';

export function photoLibraryControlButtonClass(active: boolean, extra?: string) {
  return cn(
  // `text-[10px]` not `text-micro` — twMerge treats custom `text-micro` as
  // conflicting with `text-white`, dropping the size and falling back to ~16px.
    'flex h-7 items-center justify-center rounded-md text-[10px] font-semibold leading-none transition-colors',
    active
      ? 'bg-blue-600 text-white shadow-sm'
      : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900',
    extra,
  );
}
