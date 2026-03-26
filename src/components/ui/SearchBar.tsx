'use client';

import { SearchField, type SearchFieldProps, type SearchFieldTone } from '@/design-system/primitives';

export interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSearch?: (value: string) => void;
  onClear?: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
  placeholder?: string;
  isSearching?: boolean;
  className?: string;
  variant?: 'blue' | 'orange' | 'emerald' | 'purple' | 'red' | 'gray';
  size?: 'default' | 'compact';
  rightElement?: React.ReactNode;
  leadingIcon?: React.ReactNode;
  autoFocus?: boolean;
}

function toSearchFieldTone(variant: SearchBarProps['variant']): SearchFieldTone {
  if (variant === 'emerald') return 'emerald';
  if (variant === 'gray') return 'gray';
  return variant || 'blue';
}

export function SearchBar({
  value,
  onChange,
  onSearch,
  onClear,
  inputRef,
  placeholder = 'Search...',
  isSearching = false,
  className = '',
  variant = 'blue',
  size = 'default',
  rightElement,
  leadingIcon,
  autoFocus = false,
}: SearchBarProps) {
  return (
    <SearchField
      value={value}
      onChange={onChange}
      onSearch={onSearch}
      onClear={onClear}
      inputRef={inputRef}
      placeholder={placeholder}
      isSearching={isSearching}
      className={className}
      tone={toSearchFieldTone(variant)}
      size={size as SearchFieldProps['size']}
      rightElement={rightElement}
      leadingIcon={leadingIcon}
      autoFocus={autoFocus}
    />
  );
}
