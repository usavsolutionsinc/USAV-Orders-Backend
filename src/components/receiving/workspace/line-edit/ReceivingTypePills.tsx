'use client';

import { RECEIVING_TYPE_OPTS } from '@/components/sidebar/receiving/receiving-sidebar-shared';

/**
 * Receiving-type picker (PO / RETURN / …) shown to the right of the platform
 * pills in the carton context card. PICKUP is intentionally hidden.
 */
export function ReceivingTypePills({
  value,
  onSelect,
}: {
  value: string;
  onSelect: (next: string) => void;
}) {
  return (
    <div className="shrink-0 text-right">
      <div
        role="radiogroup"
        aria-label="Receiving type"
        className="flex flex-wrap items-center justify-end gap-1.5"
      >
        {RECEIVING_TYPE_OPTS
          .filter((opt) => opt.value !== 'PICKUP')
          .map((opt) => {
            const isActive = value === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => onSelect(opt.value)}
                className={`inline-flex h-8 items-center whitespace-nowrap rounded-full border px-3 text-micro font-black uppercase tracking-wide transition-colors ${
                  isActive
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
      </div>
    </div>
  );
}
