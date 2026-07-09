/**
 * /search/history — the recents archive (docs/unified-global-search-
 * consolidation-plan.md §3.4, decision D5: main-column only, no sidebar).
 *
 * The canonical "all recent searches" view, reachable from the header
 * dropdown footer and the /search empty state. Renders in the workbench body
 * column like /search; the unified recents store is client-side (localStorage),
 * so the workspace is a client component.
 */

import { SearchHistoryWorkspace } from '@/components/search/SearchHistoryWorkspace';

export default function SearchHistoryPage() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-canvas">
      <SearchHistoryWorkspace />
    </div>
  );
}
