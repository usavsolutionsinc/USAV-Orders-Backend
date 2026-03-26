'use client';

import { SearchField, type SearchFieldProps } from '../primitives';

type SearchTone = SearchFieldProps['tone'];

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
  return (
    <SearchField
      value={value}
      onChange={onChange}
      onSearch={onSearch}
      onClear={onClear}
      placeholder={placeholder}
      className={className}
      tone={tone}
      size="compact"
      isSearching={isSearching}
    />
  );
}
