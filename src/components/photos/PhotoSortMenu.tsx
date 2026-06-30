'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronUp } from '@/components/Icons';
import { photoLibraryControlButtonClass } from '@/components/photos/photo-library-controls';
import { Popover } from '@/design-system';
import type { PhotoLibrarySortMode } from '@/lib/photos/library-filter-state';
import { cn } from '@/utils/_cn';

const OPTIONS: {
  value: PhotoLibrarySortMode;
  label: string;
  icon: typeof ChevronDown;
}[] = [
  { value: 'recent', label: 'Newest', icon: ChevronUp },
  { value: 'oldest', label: 'Oldest', icon: ChevronDown },
];

const SORT_MENU_WIDTH = 'w-[4.75rem]';

/** Right-pane sort dropdown — click trigger, pick an option. */
export function PhotoSortMenu({
  sort,
  onSortChange,
}: {
  sort: PhotoLibrarySortMode;
  onSortChange: (s: PhotoLibrarySortMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const activeOption = OPTIONS.find((o) => o.value === sort) ?? OPTIONS[0];
  const ActiveIcon = activeOption.icon;

  const handleSelect = (value: PhotoLibrarySortMode) => {
    if (value !== sort) onSortChange(value);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const handleButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(true);
    }
  };

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      listRef.current
        ?.querySelector<HTMLButtonElement>(`[data-option-index="${(index + 1) % OPTIONS.length}"]`)
        ?.focus();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      listRef.current
        ?.querySelector<HTMLButtonElement>(`[data-option-index="${(index - 1 + OPTIONS.length) % OPTIONS.length}"]`)
        ?.focus();
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Sort: ${activeOption.label}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={handleButtonKeyDown}
        className={cn(
          'ds-raw-button',
          photoLibraryControlButtonClass(true, cn(SORT_MENU_WIDTH, 'justify-start gap-1 whitespace-nowrap pl-1.5 pr-1')),
        )}
      >
        <ActiveIcon className="h-3.5 w-3.5 shrink-0" />
        {activeOption.label}
      </button>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={buttonRef}
        placement="bottom-start"
        gap={4}
        matchWidth
        padded={false}
        role="listbox"
        aria-label="Sort photos"
        className="min-w-0 rounded-lg p-0.5 shadow-md"
      >
        <ul ref={listRef} className="list-none">
          {OPTIONS.map((o, index) => {
            const active = sort === o.value;
            const Icon = o.icon;
            return (
              <li key={o.value} role="none">
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-option-index={index}
                  onClick={() => handleSelect(o.value)}
                  onKeyDown={(event) => handleOptionKeyDown(event, index)}
                  className={cn(
                    'ds-raw-button flex w-full items-center justify-start gap-1.5 rounded-md py-1.5 pl-1.5 pr-1 text-micro font-semibold transition-colors',
                    active
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900',
                  )}
                >
                  <Icon className={cn('h-3.5 w-3.5 shrink-0', active ? 'text-blue-600' : 'text-gray-900')} />
                  {o.label}
                </button>
              </li>
            );
          })}
        </ul>
      </Popover>
    </>
  );
}
