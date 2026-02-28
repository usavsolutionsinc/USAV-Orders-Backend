'use client';

import { dmSans } from '@/lib/fonts';

export interface ViewDropdownOption<T extends string> {
  value: T;
  label: string;
}

interface ViewDropdownProps<T extends string> {
  options: Array<ViewDropdownOption<T>>;
  value: T;
  onChange: (nextValue: T) => void;
}

export function ViewDropdown<T extends string>({
  options,
  value,
  onChange,
}: ViewDropdownProps<T>) {
  return (
    <section className="relative w-full">
      <label className="sr-only" htmlFor="view-dropdown-select">
        Select view
      </label>
      <div className="relative">
        <select
          id="view-dropdown-select"
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          className={`h-14 w-full appearance-none border-b border-gray-200 bg-white px-4 pr-11 text-left text-[13px] uppercase tracking-wide text-gray-900 outline-none transition-colors hover:bg-gray-50 ${dmSans.className} font-bold`}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <svg
          className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        </svg>
      </div>
    </section>
  );
}
