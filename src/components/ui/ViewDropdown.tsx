'use client';

import React from 'react';
import { AnchoredLayer } from '@/design-system';
import { dmSans } from '@/lib/fonts';
import { Check } from '@/components/Icons';

export interface ViewDropdownOption<T extends string> {
  value: T;
  label: string;
  /** Optional leading icon, rendered in blue beside the label (opt-in). */
  icon?: (props: { className?: string }) => JSX.Element;
}

interface ViewDropdownProps<T extends string> {
  options: ReadonlyArray<ViewDropdownOption<T>>;
  value: T;
  onChange: (nextValue: T) => void;
  className?: string;
  buttonClassName?: string;
  optionClassName?: string;
  variant?: 'default' | 'boxy';
  /** Control height/text density. `sm` is a compact pill; defaults to `md`. */
  size?: 'sm' | 'md';
  /** Text casing for the button + menu. Defaults to `uppercase` (legacy). */
  textTransform?: 'uppercase' | 'lowercase' | 'capitalize' | 'none';
  borderRadius?: string;
  backgroundColor?: string;
  fontSize?: string;
}

export function ViewDropdown<T extends string>({
  options,
  value,
  onChange,
  className = '',
  buttonClassName = '',
  optionClassName = '',
  variant = 'default',
  size = 'md',
  textTransform = 'uppercase',
  borderRadius,
  backgroundColor,
  fontSize,
}: ViewDropdownProps<T>) {
  const [isOpen, setIsOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const isBoxy = variant === 'boxy';
  const isSm = size === 'sm';
  const caseClass =
    textTransform === 'lowercase'
      ? 'lowercase'
      : textTransform === 'capitalize'
        ? 'capitalize'
        : textTransform === 'none'
          ? 'normal-case'
          : 'uppercase';
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selectedOption = options[selectedIndex] ?? options[0];
  const SelectedIcon = selectedOption?.icon;
  const otherOptions = options.filter((option) => option.value !== value);

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
      const nextEl = listRef.current?.querySelector<HTMLButtonElement>(`[data-dropdown-option-index="${(index + 1) % otherOptions.length}"]`);
      nextEl?.focus();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prevEl = listRef.current?.querySelector<HTMLButtonElement>(
        `[data-dropdown-option-index="${(index - 1 + otherOptions.length) % otherOptions.length}"]`,
      );
      prevEl?.focus();
    }
  };

  return (
    <section className={`relative w-full ${className}`}>
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
          style={{
            ...(borderRadius ? { borderRadius } : {}),
            ...(backgroundColor ? { backgroundColor } : {}),
            ...(fontSize ? { fontSize } : {}),
          }}
          className={`ds-raw-button ${
            buttonClassName ||
            `flex items-center ${isSm ? 'h-10 text-xs' : 'h-14 text-sm'} w-full border-b border-gray-400 bg-white px-4 pr-12 text-left ${caseClass} tracking-wide text-gray-900 outline-none transition-colors hover:bg-gray-50 ${dmSans.className} font-bold`
          }`}
        >
          {SelectedIcon ? <SelectedIcon className="mr-2 h-4 w-4 shrink-0 text-blue-600" /> : null}
          <span className="min-w-0 truncate">{selectedOption?.label || ''}</span>
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

        <AnchoredLayer
          open={isOpen}
          onClose={() => setIsOpen(false)}
          anchorRef={buttonRef}
          placement="bottom-stretch"
          gap={isBoxy ? 0 : -1}
        >
          <div
            ref={listRef}
            style={{
              ...(backgroundColor ? { backgroundColor } : {}),
              ...(borderRadius ? { borderBottomLeftRadius: borderRadius, borderBottomRightRadius: borderRadius } : {}),
            }}
            className={`w-full border border-gray-400 bg-white shadow-lg ${
              isBoxy ? 'rounded-none border-t-0' : 'rounded-b-xl'
            }`}
          >
            <ul role="listbox" aria-label="Select view" className="w-full pb-1 pt-0">
              {otherOptions.map((option, index) => {
                const OptionIcon = option.icon;
                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      data-dropdown-option-index={index}
                      onClick={() => handleSelect(option.value)}
                      onKeyDown={(event) => handleOptionKeyDown(event, index)}
                      style={{
                        ...(backgroundColor ? { backgroundColor } : {}),
                        ...(fontSize ? { fontSize } : {}),
                      }}
                      className={`ds-raw-button flex ${isSm ? 'h-9' : 'h-11'} w-full items-center gap-2 ${
                        isBoxy ? 'px-3' : 'px-4'
                      } text-left ${
                        optionClassName || (isSm ? 'text-xs font-bold tracking-wide' : 'text-sm font-bold tracking-wide')
                      } ${caseClass} transition-colors ${dmSans.className} text-gray-800 hover:bg-gray-50`}
                    >
                      {OptionIcon ? <OptionIcon className="h-4 w-4 shrink-0 text-blue-600" /> : null}
                      <span className="truncate">{option.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </AnchoredLayer>
      </div>
    </section>
  );
}
