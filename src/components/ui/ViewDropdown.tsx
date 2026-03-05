'use client';

import React from 'react';
import { dmSans } from '@/lib/fonts';
import { Check } from '@/components/Icons';

export interface ViewDropdownOption<T extends string> {
  value: T;
  label: string;
}

interface ViewDropdownProps<T extends string> {
  options: Array<ViewDropdownOption<T>>;
  value: T;
  onChange: (nextValue: T) => void;
  className?: string;
  buttonClassName?: string;
  optionClassName?: string;
  variant?: 'default' | 'boxy';
}

export function ViewDropdown<T extends string>({
  options,
  value,
  onChange,
  className = '',
  buttonClassName = '',
  optionClassName = '',
  variant = 'default',
}: ViewDropdownProps<T>) {
  const [isOpen, setIsOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const isBoxy = variant === 'boxy';
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selectedOption = options[selectedIndex] ?? options[0];
  const otherOptions = options.filter((option) => option.value !== value);

  React.useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const handleSelect = (nextValue: T) => {
    onChange(nextValue);
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  const handleButtonKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setIsOpen(true);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      // Cycle through other options or just keep current? 
      // User says only show unselected in dropdown. 
      // If pressing ArrowUp on the button, maybe we don't change value, just open?
      // Standard dropdown behavior: up/down cycles through options.
      // Since the dropdown is now "everything else", cycling might be confusing.
      // Let's just open the dropdown for now on up/down.
      setIsOpen(true);
    }
  };

  const handleOptionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setIsOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const nextEl = rootRef.current?.querySelector<HTMLButtonElement>(`[data-dropdown-option-index="${(index + 1) % otherOptions.length}"]`);
      nextEl?.focus();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prevEl = rootRef.current?.querySelector<HTMLButtonElement>(
        `[data-dropdown-option-index="${(index - 1 + otherOptions.length) % otherOptions.length}"]`,
      );
      prevEl?.focus();
    }
  };

  return (
    <section className={`relative w-full ${className}`} ref={rootRef}>
      <label className="sr-only" htmlFor="view-dropdown-button">
        Select view
      </label>
      <div className="relative w-full">
        <button
          id="view-dropdown-button"
          ref={buttonRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((prev) => !prev)}
          onKeyDown={handleButtonKeyDown}
          className={
            buttonClassName ||
            `h-14 w-full border-b border-gray-200 bg-white px-4 pr-12 text-left text-[13px] uppercase tracking-wide text-gray-900 outline-none transition-colors hover:bg-gray-50 ${dmSans.className} font-bold`
          }
        >
          {selectedOption?.label || ''}
        </button>
        <svg
          className={`pointer-events-none absolute right-4 h-4 w-4 text-gray-500 transition-transform ${
            isOpen ? 'rotate-180' : ''
          } top-1/2 -translate-y-1/2`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        </svg>

        {isOpen && (
          <div
            className={`absolute left-0 top-full z-50 w-full border border-gray-200 bg-white shadow-lg ${
              isBoxy ? 'rounded-none border-t-0' : 'rounded-b-xl -mt-[1px]'
            }`}
          >
            <ul role="listbox" aria-label="Select view" className="w-full py-1">
              {otherOptions.map((option, index) => {
                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      data-dropdown-option-index={index}
                      onClick={() => handleSelect(option.value)}
                      onKeyDown={(event) => handleOptionKeyDown(event, index)}
                      className={`flex h-11 w-full items-center px-4 text-left ${
                        optionClassName || 'text-[13px] font-bold'
                      } uppercase tracking-wide transition-colors ${dmSans.className} text-gray-800 hover:bg-gray-50`}
                    >
                      <span className="truncate">{option.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
