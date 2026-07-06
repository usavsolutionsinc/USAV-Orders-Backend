'use client';

/**
 * AiQuickJumpResults — the shared SearchHit row list for workbench AI
 * quick-jumps (AI search Phase 2, plan §8.4 "normalize result rendering
 * through SearchHit + shared row components").
 *
 * Presentational only: hosts own fetching (useAiQuickJump) and placement
 * (usually a band under their search input). Renders nothing when there are
 * no hits — the host surface must look byte-identical pre-AI when the list
 * is empty. Rows render through the ONE renderer (SearchResultRow), so order
 * hits get the rich status-dot row and everything else the generic row.
 */

import type { MouseEvent as ReactMouseEvent } from 'react';
import { Search, Loader2 } from '@/components/Icons';
import type { AiSearchHit } from '@/lib/search/ai-search-client';
import { SearchResultRow } from './SearchResultRow';

export interface AiQuickJumpResultsProps {
  hits: AiSearchHit[];
  searching?: boolean;
  /**
   * Row click. Receives the event so a host can intercept the `<Link>` (e.g.
   * operations drills in-page via event.preventDefault()); hosts that only
   * close a popover can ignore the event and let the link navigate.
   */
  onNavigate?: (hit: AiSearchHit, event: ReactMouseEvent) => void;
  className?: string;
}

export function AiQuickJumpResults({
  hits,
  searching = false,
  onNavigate,
  className,
}: AiQuickJumpResultsProps) {
  if (hits.length === 0 && !searching) return null;

  return (
    <div className={className}>
      <p className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-eyebrow font-black uppercase tracking-widest text-text-faint">
        {searching ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Search className="h-3 w-3" />
        )}
        AI matches
      </p>
      <ul className="divide-y divide-border-hairline">
        {hits.map((hit) => (
          <li key={`${hit.entityType}:${hit.id}`}>
            <SearchResultRow hit={hit} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
    </div>
  );
}
