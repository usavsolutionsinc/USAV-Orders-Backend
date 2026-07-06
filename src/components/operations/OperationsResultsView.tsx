'use client';

/**
 * OperationsResultsView — the browse RESULTS region of Operations ▸ History.
 * Mounts the shared <SearchResultsSurface> in operations scope (orders-first)
 * driven by the header's browse query (?q=). Clicking an ORDER row drills into
 * that record's journey timeline in-page (url.setEntity → focused); every other
 * entity keeps its normal deep-link out of operations.
 */

import { useState } from 'react';
import { SearchResultsSurface } from '@/components/search/SearchResultsSurface';
import { defaultTabForScope, type TabId } from '@/components/search/search-tabs';
import type { OperationsTimelineUrlState } from '@/components/sidebar/operations/useOperationsTimelineUrlState';

export function OperationsResultsView({ url }: { url: OperationsTimelineUrlState }) {
  const [tab, setTab] = useState<TabId>(defaultTabForScope('operations'));

  return (
    <SearchResultsSurface
      scope="operations"
      query={url.q}
      activeTab={tab}
      onTabChange={setTab}
      onSelectHit={(hit, event) => {
        // Orders drill into their journey timeline (stay in operations);
        // other entities keep their own deep-link.
        if (hit.entityType === 'order') {
          event.preventDefault();
          url.setEntity(String(hit.id), 'order');
        }
      }}
    />
  );
}
