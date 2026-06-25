'use client';

/**
 * Settings Registry — the control dispatcher. Renders the right input for a
 * setting's `control` type (toggle / segmented / select / number / text) and
 * calls onChange with a value the registry schema will accept. Purely
 * presentational: the panel owns which value to show and which home to write.
 *
 * Styling matches the existing settings sections (QuickAccessSection switch,
 * AppearanceSection segmented grid) — gray-/blue- palette, not semantic tokens,
 * to read like its siblings.
 */

import type { SettingDef, SettingValue } from '@/lib/settings/types';

interface SettingControlProps {
  def: SettingDef;
  value: SettingValue;
  disabled?: boolean;
  /** Option values gated by a plan the org lacks — disabled with a lock. */
  lockedOptions?: SettingValue[];
  onChange: (value: SettingValue) => void;
}

function Switch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'bg-blue-600' : 'bg-gray-300'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

const FIELD_CLS =
  'rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 ' +
  'focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 ' +
  'disabled:cursor-not-allowed disabled:opacity-40';

export function SettingControl({ def, value, disabled, lockedOptions = [], onChange }: SettingControlProps) {
  switch (def.control) {
    case 'toggle':
      return <Switch checked={Boolean(value)} disabled={disabled} onChange={onChange} />;

    case 'segmented':
      return (
        <div className="flex flex-wrap justify-end gap-1.5">
          {(def.options ?? []).map((opt) => {
            const isActive = value === opt.value;
            const optLocked = lockedOptions.some((lv) => lv === opt.value);
            return (
              <button
                key={String(opt.value)}
                type="button"
                disabled={disabled || optLocked}
                onClick={() => onChange(opt.value)}
                title={optLocked ? 'Requires a higher plan' : opt.hint}
                aria-pressed={isActive}
                className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  isActive
                    ? 'border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-500/20'
                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {opt.label}
                {optLocked && <span className="ml-1" aria-hidden>🔒</span>}
              </button>
            );
          })}
        </div>
      );

    case 'select':
      return (
        <select
          disabled={disabled}
          value={String(value)}
          onChange={(e) => {
            const opt = (def.options ?? []).find((o) => String(o.value) === e.target.value);
            if (opt) onChange(opt.value);
          }}
          className={FIELD_CLS}
        >
          {(def.options ?? []).map((opt) => (
            <option key={String(opt.value)} value={String(opt.value)}>
              {opt.label}
            </option>
          ))}
        </select>
      );

    case 'number':
      return (
        <div className="flex items-center gap-2">
          <input
            key={String(value)}
            type="number"
            disabled={disabled}
            defaultValue={Number(value)}
            min={def.min}
            max={def.max}
            step={def.step}
            onBlur={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n !== Number(value)) onChange(n);
            }}
            className={`w-24 ${FIELD_CLS}`}
          />
          {def.unit && <span className="text-caption text-gray-500">{def.unit}</span>}
        </div>
      );

    case 'text':
      return (
        <input
          key={String(value)}
          type="text"
          disabled={disabled}
          defaultValue={String(value)}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== String(value)) onChange(v);
          }}
          className={`w-48 ${FIELD_CLS}`}
        />
      );

    default:
      return null;
  }
}
