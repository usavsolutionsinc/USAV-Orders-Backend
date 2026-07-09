'use client';

/**
 * Bottom-anchored carton-list filter for the Triage sidebar (D1,
 * docs/receiving-triage-redesign-plan.md §0.6). Distinct from the scan band
 * pinned at the top (`TriageScanBand`, which resolves a tracking # via
 * `submitTrackingScan` and never filters) — this is a plain client-side filter
 * over the Triage/Prioritize/Unfound/Done lists, for "find a carton I already
 * scanned in" rather than "search Zoho for a PO to link" (that's `PoLinkTab`,
 * kept as-is per D1).
 *
 * URL-backed via `?triq=` (owned by `useReceivingMode`) so a filtered view
 * survives a refresh/deep-link — the gap the plan's D1 implementation note
 * flagged in the prior local-state-only `triageQuery`.
 *
 * A bare `<SearchBar size="compact">` (not `<SidebarSearchBar>`): this band is
 * bottom-anchored, not the 40px sidebar HEADER band `SidebarSearchBar` owns —
 * see sidebar-search-bar.guard.test.ts.
 */

import { useEffect, useState } from 'react';
import { Search } from '@/components/Icons';
import { SearchBar } from '@/components/ui/SearchBar';

export function TriageCartonSearchBar({
  value,
  onChange,
}: {
  /** Current `?triq=` value (server/URL truth). */
  value: string;
  /** Debounced commit — writes `?triq=`. */
  onChange: (next: string) => void;
}) {
  // Local echo so typing feels instant; the URL commit is debounced so a fast
  // typist doesn't spam router.replace (mirrors useTriagePanel's matchQuery
  // debounce for the same reason).
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
        onClear={() => setDraft('')}
        placeholder="Find a scanned carton…"
        size="compact"
        leadingIcon={<Search className="h-3.5 w-3.5" />}
        hideUnderline
      />
    </div>
  );
}
