import { cn } from '@/utils/_cn';

/** Bordered control cluster — shared by view toggles and sort pills in the 40px header. */
export const photoLibraryControlGroupClass =
  'flex items-center rounded-lg border border-gray-200 bg-white p-0.5';

export function photoLibraryControlButtonClass(active: boolean, extra?: string) {
  return cn(
    'flex h-7 items-center justify-center rounded-md text-micro font-semibold leading-none transition-colors',
    active
      ? 'bg-blue-600 text-white shadow-sm'
      : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900',
    extra,
  );
}
