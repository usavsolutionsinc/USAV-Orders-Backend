'use client';

import { Suspense } from 'react';
import { WarehouseShell } from '@/components/warehouse/WarehouseShell';

export default function WarehousePage() {
  return (
    // Page scrolls at the outer level. Sub-tabs render their own PageHeader
    // flush at top so the row aligns with the sidebar back button (44px);
    // each tab body owns its own padding.
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain bg-surface-canvas">
      <Suspense fallback={<div className="p-6 text-sm text-text-faint">Loading…</div>}>
        <WarehouseShell />
      </Suspense>
    </div>
  );
}
