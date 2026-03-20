'use client';

import type { ReactNode, Ref } from 'react';
import { motion } from 'framer-motion';
import { Search, X } from '@/components/Icons';

interface OverlaySearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSearch?: (value: string) => void;
  onClear?: () => void;
  onClose: () => void;
  inputRef?: Ref<HTMLInputElement>;
  placeholder?: string;
  variant?: 'blue' | 'orange' | 'emerald' | 'purple' | 'red' | 'gray';
  leadingIcon?: ReactNode;
  className?: string;
  autoFocus?: boolean;
}

export function OverlaySearchBar({
  value,
  onChange,
  onSearch,
  onClear,
  onClose,
  inputRef,
  placeholder = 'Search...',
  variant = 'blue',
  leadingIcon,
  className = 'w-full',
  autoFocus = false,
}: OverlaySearchBarProps) {
  const frameTone = {
    blue: 'group-focus-within:border-blue-300/80 group-hover:border-white/75',
    orange: 'group-focus-within:border-orange-300/80 group-hover:border-white/75',
    emerald: 'group-focus-within:border-emerald-300/80 group-hover:border-white/75',
    purple: 'group-focus-within:border-purple-300/80 group-hover:border-white/75',
    red: 'group-focus-within:border-red-300/80 group-hover:border-white/75',
    gray: 'group-focus-within:border-gray-300/80 group-hover:border-white/75',
  }[variant];

  const iconTone = {
    blue: 'group-focus-within:text-blue-600',
    orange: 'group-focus-within:text-orange-600',
    emerald: 'group-focus-within:text-emerald-600',
    purple: 'group-focus-within:text-purple-600',
    red: 'group-focus-within:text-red-600',
    gray: 'group-focus-within:text-gray-700',
  }[variant];

  const iconNode = leadingIcon || <Search className="h-4 w-4" />;

  return (
    <motion.form
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -30 }}
      transition={{
        x: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
        opacity: { duration: 0.14, ease: 'easeOut' },
      }}
      onSubmit={(event) => {
        event.preventDefault();
        onSearch?.(value);
      }}
      className={className}
      style={{ willChange: 'transform, opacity' }}
    >
      <div
        className={`group relative h-12 w-full overflow-hidden rounded-lg border border-white bg-white shadow-[0_10px_24px_rgba(15,23,42,0.18)] transition-colors duration-150 ease-out ${frameTone} [backdrop-filter:blur(42px)_saturate(125%)]`}
      >
        <div className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors duration-150 ${iconTone}`}>
          {iconNode}
        </div>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="h-full w-full border-0 bg-transparent pl-10 pr-9 text-[13px] font-bold text-gray-900 outline-none placeholder:font-semibold placeholder:text-gray-400"
        />
        <button
          type="button"
          onClick={onClose}
          className="absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center text-gray-500 transition hover:text-gray-800 active:scale-95"
          aria-label="Close search"
          title="Close search"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </motion.form>
  );
}
