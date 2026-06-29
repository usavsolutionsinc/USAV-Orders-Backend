'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Search, Check } from '@/components/Icons';
import { cn } from '@/utils/_cn';
import { Popover } from '../primitives/Popover';

export interface SearchableSelectOption<T = unknown> {
  value: string | number;
  /** Shown in the trigger when selected + the default search/filter target. */
  label: string;
  /** Optional secondary text (e.g. a staff role) shown muted on the right. */
  meta?: string;
  /** Arbitrary passthrough returned to onChange / renderOption. */
  data?: T;
}

export interface SearchableSelectFieldProps<T = unknown> {
  value: string | number | null;
  onChange: (value: string | number | null, option: SearchableSelectOption<T> | null) => void;
  options: ReadonlyArray<SearchableSelectOption<T>>;
  /** Trigger label when nothing is selected. */
  placeholder?: string;
  /** Search input placeholder. */
  searchPlaceholder?: string;
  /** Shown when the query matches nothing. */
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  /** Accent the trigger + active row to match the host surface. */
  tone?: 'default' | 'emerald';
  /** Custom row body. Defaults to label + optional muted meta + check. */
  renderOption?: (opt: SearchableSelectOption<T>, state: { active: boolean }) => ReactNode;
  /** Custom filter predicate. Default: case-insensitive match on label + meta. */
  filter?: (opt: SearchableSelectOption<T>, query: string) => boolean;
}

const TONE_TRIGGER: Record<NonNullable<SearchableSelectFieldProps['tone']>, string> = {
  default:
    'border-gray-200 hover:border-blue-300 hover:bg-blue-50/40 focus:border-blue-500 focus:ring-blue-500/20',
  emerald:
    'border-emerald-200 hover:border-emerald-300 hover:bg-emerald-50 focus:border-emerald-500 focus:ring-emerald-500/20',
};

const TONE_ACTIVE: Record<NonNullable<SearchableSelectFieldProps['tone']>, string> = {
  default: 'bg-blue-50 text-blue-700',
  emerald: 'bg-emerald-50 text-emerald-700',
};

function defaultFilter(opt: SearchableSelectOption, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return opt.label.toLowerCase().includes(q) || (opt.meta?.toLowerCase().includes(q) ?? false);
}

/**
 * The house **inline searchable select** — a field-style trigger that opens an
 * anchored popover with a search box over a filtered, scrollable option list.
 * The type-ahead sibling of {@link FilterDropdownSelect} (a plain native
 * `<select>` with no search); reach for this when the option set is large
 * enough to want filtering, e.g. picking one staff member out of the whole org.
 *
 * Fully controlled via `value` + `onChange`; owns only the open + query state.
 * Composes the design-system {@link Popover} primitive, so dismissal,
 * reduced-motion, and z-index come for free.
 */
export function SearchableSelectField<T = unknown>({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyMessage = 'No matches',
  disabled = false,
  className,
  ariaLabel,
  tone = 'default',
  renderOption,
  filter,
}: SearchableSelectFieldProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const predicate = filter ?? defaultFilter;
    return options.filter((o) => predicate(o, query));
  }, [options, query, filter]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  return (
    <>
      {/* ds-raw-button: field-style combobox trigger; the design-system Popover owns dismissal */}
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        aria-label={ariaLabel ?? placeholder}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex h-8 w-full items-center gap-2 rounded-lg border bg-white px-2.5 text-left text-micro font-bold transition-colors focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
          TONE_TRIGGER[tone],
          selected ? 'text-gray-900' : 'text-gray-400',
          className,
        )}
      >
        <span className="flex-1 truncate">{selected ? selected.label : placeholder}</span>
        <ChevronDown
          className={cn('h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform', open && 'rotate-180')}
        />
      </button>

      <Popover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        placement="bottom-stretch"
        matchWidth
        padded={false}
        role="listbox"
        aria-label={ariaLabel ?? placeholder}
      >
        <div className="flex items-center gap-2 border-b border-gray-100 px-2.5 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          {/* eslint-disable-next-line jsx-a11y/no-autofocus -- focus the filter when the user opens the dropdown */}
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full bg-transparent text-micro font-bold text-gray-900 outline-none placeholder:text-gray-400"
          />
        </div>

        <div className="max-h-56 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-center text-eyebrow font-bold uppercase tracking-wider text-gray-400">
              {emptyMessage}
            </p>
          ) : (
            filtered.map((opt) => {
              const active = opt.value === value;
              return (
                // ds-raw-button: option row inside the listbox popover
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(opt.value, opt);
                    close();
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-gray-50',
                    active ? TONE_ACTIVE[tone] : 'text-gray-700',
                  )}
                >
                  {renderOption ? (
                    renderOption(opt, { active })
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate text-micro font-bold">{opt.label}</span>
                      {opt.meta ? (
                        <span className="shrink-0 text-eyebrow font-bold uppercase tracking-wide text-gray-400">
                          {opt.meta}
                        </span>
                      ) : null}
                      {active ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                    </>
                  )}
                </button>
              );
            })
          )}
        </div>
      </Popover>
    </>
  );
}
