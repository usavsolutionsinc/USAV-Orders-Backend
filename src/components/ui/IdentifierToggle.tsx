'use client';

/**
 * A small segmented toggle used in timeline/journey headers — e.g. the order
 * timeline's serial↔order switch, and the operations journey's
 * order/serial/tracking dimension switch. Pure presentation: the caller owns the
 * value + options; this renders the bg-surface-sunken pill rail with a single
 * white "active" segment (house micro-typography eyebrow scale, no size shift on
 * selection). Generic over the option value so it works for any small enum.
 */

interface IdentifierToggleOption<T extends string> {
  value: T;
  label: string;
}

export function IdentifierToggle<T extends string>({
  value,
  onChange,
  options,
  ariaLabel = 'Grouping',
}: {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<IdentifierToggleOption<T>>;
  ariaLabel?: string;
}) {
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-md bg-surface-sunken p-0.5"
      role="tablist"
      aria-label={ariaLabel}
    >
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={`ds-raw-button rounded px-2 py-0.5 text-eyebrow font-bold uppercase tracking-[0.1em] transition-colors ${
              active ? 'bg-surface-card text-text-muted shadow-sm' : 'text-text-faint hover:text-text-muted'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
