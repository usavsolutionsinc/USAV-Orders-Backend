'use client';

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
  return (
    <div className={`${sidebarHeaderBandClass} ${sidebarHeaderRowClass} flex items-center gap-2`}>
      <div className="flex-1 min-w-0">
        <SearchBar
          key={scanBarKey}
          value={value}
          onChange={onChange}
          onSearch={onSubmit}
          onClear={() => onChange('')}
          placeholder={searchMode ? 'Search trackings…' : 'Scan tracking…'}
          variant="blue"
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
