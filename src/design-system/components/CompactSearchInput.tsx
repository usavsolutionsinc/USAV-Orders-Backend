'use client';

import { type FormEvent } from 'react';
import { Clipboard, Loader2, Search, X } from '@/components/Icons';

type SearchTone = 'blue' | 'orange' | 'red' | 'green' | 'purple' | 'yellow' | 'neutral';

const toneClassName: Record<SearchTone, string> = {
  blue: 'border-blue-500 focus:border-blue-500',
  orange: 'border-orange-500 focus:border-orange-500',
  red: 'border-red-500 focus:border-red-500',
  green: 'border-green-500 focus:border-green-500',
  purple: 'border-purple-500 focus:border-purple-500',
  yellow: 'border-yellow-500 focus:border-yellow-500',
  neutral: 'border-slate-300 focus:border-slate-500',
};

interface CompactSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onSearch?: (value: string) => void;
  onClear?: () => void;
  placeholder?: string;
  className?: string;
  tone?: SearchTone;
  isSearching?: boolean;
}

export function CompactSearchInput({
  value,
  onChange,
  onSearch,
  onClear,
  placeholder = 'Search',
  className = '',
  tone = 'blue',
  isSearching = false,
}: CompactSearchInputProps) {
  const hasValue = Boolean(String(value || '').trim());

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSearch?.(value);
  };

  const handleClear = () => {
    onChange('');
    onClear?.();
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim();
      if (trimmed) onChange(trimmed);
    } catch {
      // clipboard blocked
    }
  };

  return (
    <form onSubmit={handleSubmit} className={`group flex items-center gap-2 border-b pb-1 ${toneClassName[tone]} ${className}`.trim()}>
      <Search className="h-[14px] w-[14px] shrink-0 text-slate-400 transition-colors duration-100 ease-out group-focus-within:text-slate-900" />
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-7 w-full border-0 bg-transparent px-0 text-[13px] font-bold text-slate-900 outline-none placeholder:font-medium placeholder:text-slate-400"
      />
      {isSearching ? (
        <Loader2 className="h-[14px] w-[14px] animate-spin text-slate-500" />
      ) : hasValue ? (
        <button
          type="button"
          onClick={handleClear}
          className="text-slate-400 transition-colors duration-100 ease-out hover:text-slate-900 active:scale-95"
          aria-label="Clear search"
          title="Clear"
        >
          <X className="h-[14px] w-[14px]" />
        </button>
      ) : (
        <button
          type="button"
          onClick={handlePaste}
          className="text-slate-400 transition-colors duration-100 ease-out hover:text-blue-600 active:scale-95"
          aria-label="Paste from clipboard"
          title="Paste"
        >
          <Clipboard className="h-[14px] w-[14px]" />
        </button>
      )}
    </form>
  );
}
