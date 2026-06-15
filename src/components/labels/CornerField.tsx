'use client';

import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';

/**
 * One-row corner control for a label editor: a value input on the left and the
 * mode pills on the right (Order # / Ticket # / Tracking # for receiving; reused
 * for the testing label's color/other corner). Replaces the old two-row layout
 * (pills above, input below). Presentational — the parent owns which field the
 * value maps to and any per-mode sanitizing.
 */
export function CornerField({
  items,
  mode,
  onModeChange,
  value,
  onValueChange,
  placeholder,
  inputMode = 'text',
  ariaLabel,
}: {
  items: HorizontalSliderItem[];
  mode: string;
  onModeChange: (id: string) => void;
  value: string;
  onValueChange: (next: string) => void;
  placeholder?: string;
  inputMode?: 'text' | 'numeric';
  ariaLabel?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-label text-gray-900 outline-none transition-colors focus:border-blue-500"
      />
      <div className="shrink-0">
        <HorizontalButtonSlider
          items={items}
          value={mode}
          onChange={onModeChange}
          variant="nav"
          size="md"
          aria-label={ariaLabel}
        />
      </div>
    </div>
  );
}
