'use client';

/**
 * Color wheel picker for staff identity color.
 *
 * Single large circular swatch showing the current color. Clicking opens the
 * native OS color picker (which is a wheel/spectrum on most platforms). A
 * small ring of conic-gradient hue hints frames the wheel so it reads as a
 * "color wheel" at rest. Hex code displays beneath.
 *
 * Controlled — the caller persists each change immediately via onChange.
 */

import { useRef } from 'react';

interface StaffColorWheelProps {
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
  /** Outer wheel diameter in px. Defaults to 56. */
  size?: number;
}

const HUE_CONIC = [
  '#ef4444', '#f59e0b', '#22c55e', '#10b981', '#06b6d4',
  '#3b82f6', '#a855f7', '#ec4899', '#ef4444',
].join(', ');

export function StaffColorWheel({ value, onChange, disabled, size = 56 }: StaffColorWheelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        aria-label={`Pick staff color (current ${value})`}
        title="Click to open color wheel"
        className="relative flex items-center justify-center rounded-full p-[3px] shadow-sm transition focus:outline-none focus:ring-2 focus:ring-gray-900/40 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        style={{
          width: size,
          height: size,
          background: `conic-gradient(from 90deg, ${HUE_CONIC})`,
        }}
      >
        <span
          className="block h-full w-full rounded-full ring-2 ring-white shadow-inner"
          style={{ backgroundColor: value }}
          aria-hidden
        />
        <input
          ref={inputRef}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-hidden
        />
      </button>
      <code className="rounded-md bg-gray-100 px-2 py-1 text-[11px] font-mono uppercase tracking-wide text-gray-700">
        {value}
      </code>
    </div>
  );
}
