'use client';

import { useEffect, useRef } from 'react';
import { Barcode, Search } from '@/components/Icons';
import { SearchBar } from '@/components/ui/SearchBar';
import {
  sidebarHeaderBandClass,
  sidebarHeaderRowClass,
} from '@/components/layout/header-shell';

interface Props {
  /**
   * Remount counter — the parent bumps this after submit so the inner SearchBar's
   * internal draft state resets without us having to wire a controlled-clear.
   */
  scanBarKey: number;
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  isSearching: boolean;
  /**
   * Search-mode swap — when true the input adopts a search affordance
   * (magnifier icon, "Search trackings…" placeholder) instead of the scan
   * affordance. Used in the History tab so the operator's mental model
   * matches the action (read-only lookup vs. add-a-new-event).
   */
  searchMode?: boolean;
}

/**
 * Tracking scan input that lives in the receiving sidebar header. Returns the
 * full header band so the parent doesn't have to repeat the wrapper classes
 * each time.
 */
export function ReceivingScanBar({
  scanBarKey,
  value,
  onChange,
  onSubmit,
  isSearching,
  searchMode = false,
}: Props) {
  // External focus trigger — Quick Access chips (`Search Receiving`,
  // `Receiving`) dispatch `receiving-focus-scan` after navigating so the
  // input is hot even when the panel was already mounted (router.push
  // without remount).
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const handler = () => requestAnimationFrame(() => inputRef.current?.focus());
    window.addEventListener('receiving-focus-scan', handler);
    return () => window.removeEventListener('receiving-focus-scan', handler);
  }, []);

  // History mode adopts a distinct (purple) variant so the operator's eye
  // registers "search-and-read" vs "scan-and-write" at a glance. The mode
  // pills row above already has a gray bottom border — adding a top border
  // here would stack on top of it and read as a doubled indigo+gray stripe.
  return (
    <div
      className={`${sidebarHeaderBandClass} ${sidebarHeaderRowClass} flex items-center gap-2 transition-colors ${
        searchMode ? 'bg-indigo-50/30' : ''
      }`}
    >
      <div className="flex-1 min-w-0">
        <SearchBar
          key={scanBarKey}
          value={value}
          onChange={onChange}
          onSearch={onSubmit}
          onClear={() => onChange('')}
          inputRef={inputRef}
          placeholder={searchMode ? 'Search tracking or PO #…' : 'Scan tracking…'}
          variant={searchMode ? 'purple' : 'blue'}
          size="compact"
          isSearching={isSearching}
          leadingIcon={
            searchMode ? (
              <Search className="w-[14px] h-[14px]" />
            ) : (
              <Barcode className="w-[14px] h-[14px]" />
            )
          }
          className="w-full"
          autoFocus
        />
      </div>
    </div>
  );
}
