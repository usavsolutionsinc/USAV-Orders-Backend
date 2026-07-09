import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Custom font-size utilities defined in `tailwind.config.ts` (theme.fontSize).
 * Keep this list in sync with that config — it is the sub-12px compact scale
 * (`text-mini` … `text-label`) used pervasively in station/sidebar UI.
 *
 * tailwind-merge ships knowing only Tailwind's built-in sizes. Without this,
 * it cannot tell that `text-micro` is a FONT SIZE, so it lumps it into the
 * text-COLOR conflict group: `cn('text-micro', 'text-white')` then drops
 * `text-micro` and the element falls back to the default ~16px. Registering
 * the names in the `font-size` group fixes the conflict resolution so the
 * tokens are safe to use anywhere `cn()` runs (which is why they can replace
 * the hand-rolled `text-[10px]` arbitrary values — see the typography guard).
 */
const CUSTOM_FONT_SIZES = ['mini', 'eyebrow', 'micro', 'caption', 'label'] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...CUSTOM_FONT_SIZES] }],
    },
  },
});

/**
 * Merges Tailwind classes, resolving conflicts correctly.
 * @example cn('p-4', condition && 'p-8') → 'p-8' (if condition true)
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
