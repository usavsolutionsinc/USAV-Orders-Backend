'use client';

import { ChevronDown } from '@/components/Icons';

export const FILTER_DROPDOWN_SELECT_CLASS =
  'h-9 w-full cursor-pointer appearance-none rounded-md border border-gray-200 bg-white pl-2.5 pr-7 text-caption font-semibold text-gray-900 hover:border-blue-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

export const FILTER_DROPDOWN_LABEL_CLASS =
  'mb-1 block text-eyebrow font-black uppercase tracking-wider text-gray-500';

export interface FilterDropdownSelectOption {
  value: string | number;
  label: string;
}

export interface FilterDropdownSelectProps {
  label: string;
  value: string | number | null;
  onChange: (value: string) => void;
  options: FilterDropdownSelectOption[];
  emptyOption: { value: string; label: string };
  ariaLabel?: string;
}

/** Shared native select row for FilterRefinementBar dropdown panels. */
export function FilterDropdownSelect({
  label,
  value,
  onChange,
  options,
  emptyOption,
  ariaLabel,
}: FilterDropdownSelectProps) {
  return (
    <label className="block">
      <span className={FILTER_DROPDOWN_LABEL_CLASS}>{label}</span>
      <div className="relative">
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={FILTER_DROPDOWN_SELECT_CLASS}
          aria-label={ariaLabel ?? label}
        >
          <option value={emptyOption.value}>{emptyOption.label}</option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
      </div>
    </label>
  );
}
