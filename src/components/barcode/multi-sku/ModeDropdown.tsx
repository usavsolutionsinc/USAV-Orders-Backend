import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from '@/components/Icons';
import { BARCODE_MODES, type BarcodeMode } from '@/components/barcode/ModeSelector';

interface ModeDropdownProps {
  mode: BarcodeMode;
  onChange: (next: BarcodeMode) => void;
}

/**
 * Compact print/log/reprint switcher pinned to the top of the horizontal
 * workspace. `onChange` is the controller's handleModeChange, which writes
 * `?mode=` and resets the step progression.
 */
export function ModeDropdown({ mode, onChange }: ModeDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = BARCODE_MODES.find((m) => m.id === mode) ?? BARCODE_MODES[0];

  // Click-away closes the menu.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const CurrentIcon = current.Icon;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-gray-300 ${
          open ? 'rounded-b-none border-b-0' : ''
        }`}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
          <CurrentIcon className="h-4 w-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-caption font-black uppercase tracking-[0.14em] text-gray-900">{current.label}</span>
          <span className="truncate text-micro font-medium text-gray-500">{current.description}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 overflow-hidden rounded-b-xl rounded-t-none border border-gray-200 border-t-0 bg-white shadow-lg -mt-px"
        >
          {BARCODE_MODES.filter(({ id }) => id !== mode).map(({ id, label, description, Icon }) => (
            <li key={id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  onChange(id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-gray-50"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-caption font-black uppercase tracking-[0.14em] text-gray-900">{label}</span>
                  <span className="truncate text-micro font-medium text-gray-500">{description}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
