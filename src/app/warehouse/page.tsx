'use client';

import { Suspense } from 'react';
import { WarehouseShell } from '@/components/warehouse/WarehouseShell';

export default function WarehousePage() {
  return (
    // Page scrolls at the outer level (unchanged for natural-flow tabs like
    // Bins/Map). The inner box is `min-h-full flex flex-col` so heights
    // propagate down to tabs that need the receiving-style "scroll body +
    // pinned action bar" pattern (LabelPrintWorkspace).
    <div className="h-full overflow-y-auto overscroll-contain bg-gray-50">
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 py-6 sm:px-6">
        <Suspense fallback={<div className="p-6 text-sm text-gray-400">Loading…</div>}>
          <WarehouseShell />
        </Suspense>
      </div>
    </div>
  );
}
