/**
 * /search — the full search-results workspace (AI search Phase 3,
 * plan §8 "Shopify-style" results).
 *
 * URL-as-state (Workbench rules): `?q=` is the query, `?type=` the category
 * tab. Overview groups every entity category with its top hits + "View all";
 * a category tab re-queries with a HARD entityTypes scope. Rows are the
 * shared SearchHit renderer (AiQuickJumpResults), so hits look and behave
 * exactly like ⌘K / sidebar results and deep-link to each record's surface.
 *
 * Fallback by construction: an unlinked tenant gets keyword-only hits from
 * the same endpoint; a 403 (no ai.search permission) shows a teaching state.
 */

import { Suspense } from 'react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { SearchWorkspace } from '@/components/search/SearchWorkspace';

export default function SearchPage() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-canvas">
      <Suspense
        fallback={
          <div className="flex h-full w-full items-center justify-center">
            <LoadingSpinner size="lg" className="text-blue-600" />
          </div>
        }
      >
        <SearchWorkspace />
      </Suspense>
    </div>
  );
}
