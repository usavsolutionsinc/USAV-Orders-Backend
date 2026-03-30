'use client';

import { useCallback, useRef } from 'react';
import { SearchField, type SearchFieldProps, type SearchFieldTone } from '@/design-system/primitives';
import { useKeyboard } from '@/hooks/useKeyboard';
import { useIsMobile } from '@/hooks/_ui';

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

/**
 * Merge an external ref (callback or object) with an internal object ref
 * so both consumers can read the DOM node.
 */
function mergeRefs<T>(
  ...refs: (React.Ref<T> | undefined)[]
): React.RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === 'function') ref(node);
      else (ref as React.MutableRefObject<T | null>).current = node;
    }
  };
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
  const isMobile = useIsMobile();
  const internalRef = useRef<HTMLInputElement>(null);
  const { scrollToCenter } = useKeyboard({ centerOnFocus: isMobile });

  // On mobile, center the search bar when the input receives focus
  // (keyboard slides up → visualViewport shrinks → useKeyboard auto-centers).
  // Also handle the initial tap: focus + immediate center for fast response.
  const handleFocus = useCallback(() => {
    if (!isMobile) return;
    // Small delay lets the keyboard begin animating before we scroll.
    setTimeout(() => scrollToCenter(internalRef.current), 120);
  }, [isMobile, scrollToCenter]);

  const merged = mergeRefs(internalRef, inputRef);

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div onFocus={handleFocus}>
      <SearchField
        value={value}
        onChange={onChange}
        onSearch={onSearch}
        onClear={onClear}
        inputRef={merged}
        placeholder={placeholder}
        isSearching={isSearching}
        className={className}
        tone={toSearchFieldTone(variant)}
        size={size as SearchFieldProps['size']}
        rightElement={rightElement}
        leadingIcon={leadingIcon}
        autoFocus={autoFocus}
      />
    </div>
  );
}
