'use client';

import { Clock } from '@/components/Icons';
import { cn } from '@/utils/_cn';

/** Share-link expiry presets (seconds) offered to the operator. */
export const SHARE_TTL_OPTIONS: Array<{ seconds: number; label: string }> = [
  { seconds: 60 * 60, label: '1 hour' },
  { seconds: 24 * 60 * 60, label: '24 hours' },
  { seconds: 7 * 24 * 60 * 60, label: '7 days' },
];

/**
 * Slim segmented picker for how long copied / dragged share links stay valid.
 * Rendered above the grid while a selection is active; the chosen TTL feeds both
 * the "Copy shareable links" action and the drag-to-share handler. Kept as an
 * inline band (not in the icon-only selection capsule) so it has room for labels.
 */
export function ShareExpiryControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (seconds: number) => void;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="inline-flex items-center gap-1 text-eyebrow font-black uppercase tracking-widest text-gray-500">
        <Clock className="h-3.5 w-3.5" /> Link expiry
      </span>
      <div className="inline-flex overflow-hidden rounded-full border border-gray-200">
        {SHARE_TTL_OPTIONS.map((opt) => {
          const active = opt.seconds === value;
          return (
            <button
              key={opt.seconds}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(opt.seconds)}
              className={cn(
                'px-2.5 py-1 text-[11px] font-bold transition',
                active
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
