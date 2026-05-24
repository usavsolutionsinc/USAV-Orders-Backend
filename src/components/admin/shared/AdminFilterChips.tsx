'use client';

interface AdminFilterChipsProps<T extends string> {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
}

export function AdminFilterChips<T extends string>({
  options,
  value,
  onChange,
}: AdminFilterChipsProps<T>) {
  return (
    <>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex-1 rounded-lg px-2 py-1 text-micro font-bold uppercase tracking-wider transition ${
            value === opt.value
              ? 'bg-blue-600 text-white shadow-sm shadow-blue-200'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </>
  );
}
