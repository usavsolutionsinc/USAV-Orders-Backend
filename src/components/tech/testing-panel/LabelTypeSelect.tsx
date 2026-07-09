'use client';

import { useRef, useState } from 'react';
import { Check, ChevronDown } from '@/components/Icons';
import { Popover } from '@/design-system/primitives';

export interface LabelTypeOption {
  key: string;
  name: string;
}

/**
 * Compact header dropdown that selects which label is queued for printing
 * (e.g. Unit label / Carton label) on the testing display's label preview.
 * Styled as the card's top-left eyebrow so it reads as the preview's title —
 * with a chevron affordance when there's more than one option. Falls back to a
 * static eyebrow label when only one label is available.
 */
export function LabelTypeSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: ReadonlyArray<LabelTypeOption>;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((o) => o.key === value) ?? options[0];

  const eyebrow = 'text-left text-xs font-semibold uppercase tracking-[0.14em]';

  if (options.length <= 1) {
    return <span className={`${eyebrow} text-text-soft`}>{selected?.name ?? 'Live preview'}</span>;
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`ds-raw-button -my-1 -ml-1 inline-flex items-center gap-1 rounded-md px-1 py-1 ${eyebrow} text-text-soft transition-colors hover:bg-surface-hover hover:text-text-default`}
      >
        <span className="truncate">{selected?.name}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        placement="bottom-start"
        role="listbox"
        aria-label="Select label to print"
        padded={false}
        className="min-w-[9rem]"
      >
        <ul className="py-1">
          {options.map((opt) => {
            const active = opt.key === selected?.key;
            return (
              <li key={opt.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(opt.key);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-label font-bold transition-colors hover:bg-surface-hover ${
                    active ? 'text-text-default' : 'text-text-soft'
                  }`}
                >
                  <span className="truncate">{opt.name}</span>
                  {active ? <Check className="h-3.5 w-3.5 shrink-0 text-blue-600" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </Popover>
    </>
  );
}
