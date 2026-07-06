'use client';

/**
 * Bottom-anchored client-side filter for the tech station rails (Testing +
 * Shipping). Mirrors {@link TriageCartonSearchBar} — a compact band pinned
 * below the scrollable rail, not the 40px header {@link SidebarSearchBar}.
 */

import { useEffect, useState } from 'react';
import { Search } from '@/components/Icons';
import { SearchBar } from '@/components/ui/SearchBar';

export function TechRailSearchBar({
  value,
  onChange,
  placeholder = 'Filter lines…',
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  useEffect(() => {
    const id = setTimeout(() => {
      if (draft.trim() !== value.trim()) onChange(draft);
    }, 250);
    return () => clearTimeout(id);
  }, [draft, value, onChange]);

  return (
    <div className="shrink-0 border-t border-border-hairline bg-surface-card px-3 py-2">
      <SearchBar
        value={draft}
        onChange={setDraft}
        onClear={() => {
          setDraft('');
          onChange('');
        }}
        placeholder={placeholder}
        size="compact"
        leadingIcon={<Search className="h-3.5 w-3.5" />}
        hideUnderline
      />
    </div>
  );
}
