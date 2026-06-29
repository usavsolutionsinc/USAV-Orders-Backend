'use client';

/**
 * Color picker for the Role editor identity card.
 *
 *   • Row of 12 preset swatches (8 staff theme tints + 4 neutrals).
 *   • Active swatch is outlined with a tight ring.
 *   • "Custom" button at the end opens the native <input type="color"> for
 *     anything the presets don't cover.
 *
 * Designed to be controlled — the caller persists each change immediately
 * via `onChange(nextHex)`; this component never holds local state for the
 * value, only for the popover state of the native picker.
 */

import { useRef } from 'react';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

interface RoleColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
}

// 8 staff-theme tints (mid-saturation) + 4 neutrals. Chosen to match the
// vibe of staff-colors.ts so a new role visually slots into the existing
// palette without clashing.
const PRESETS: ReadonlyArray<{ hex: string; label: string }> = [
  { hex: '#10b981', label: 'Emerald' },
  { hex: '#0ea5e9', label: 'Sky' },
  { hex: '#a855f7', label: 'Purple' },
  { hex: '#f59e0b', label: 'Amber' },
  { hex: '#ef4444', label: 'Red' },
  { hex: '#ec4899', label: 'Pink' },
  { hex: '#06b6d4', label: 'Cyan' },
  { hex: '#84cc16', label: 'Lime' },
  { hex: '#1f2937', label: 'Slate' },
  { hex: '#6b7280', label: 'Gray' },
  { hex: '#3b82f6', label: 'Blue' },
  { hex: '#22c55e', label: 'Green' },
];

function eq(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function RoleColorPicker({ value, onChange, disabled }: RoleColorPickerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isCustom = !PRESETS.some((p) => eq(p.hex, value));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PRESETS.map((p) => {
        const selected = eq(p.hex, value);
        return (
          <HoverTooltip key={p.hex} label={p.label} asChild>
            {/* ds-raw-button */}
            <button
              type="button"
              onClick={() => onChange(p.hex)}
              disabled={disabled}
              aria-label={`${p.label} (${p.hex})${selected ? ' — selected' : ''}`}
              className={`relative h-7 w-7 rounded-full ring-2 transition disabled:cursor-not-allowed ${
                selected ? 'ring-gray-900 ring-offset-2 ring-offset-white' : 'ring-white hover:ring-gray-300'
              }`}
              style={{ backgroundColor: p.hex }}
            />
          </HoverTooltip>
        );
      })}

      {/* Custom — opens native color picker for anything off-palette. */}
      <HoverTooltip label="Custom" asChild>
        {/* ds-raw-button */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          aria-label="Pick a custom color"
          className={`relative h-7 w-7 overflow-hidden rounded-full ring-2 transition disabled:cursor-not-allowed ${
            isCustom ? 'ring-gray-900 ring-offset-2 ring-offset-white' : 'ring-white hover:ring-gray-300'
          }`}
          style={{
            background: isCustom
              ? value
              : 'conic-gradient(from 90deg, #ef4444, #f59e0b, #22c55e, #06b6d4, #3b82f6, #a855f7, #ec4899, #ef4444)',
          }}
        >
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
      </HoverTooltip>

      <code className="rounded-md bg-gray-100 px-1.5 py-0.5 text-micro font-mono text-gray-700">{value}</code>
    </div>
  );
}
