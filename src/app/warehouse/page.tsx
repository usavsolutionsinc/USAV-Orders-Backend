'use client';

import { Suspense } from 'react';
import { WarehouseShell } from '@/components/warehouse/WarehouseShell';

export default function WarehousePage() {
  return (
    <div className="min-h-full bg-gray-50">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <Suspense fallback={<div className="p-6 text-sm text-gray-400">Loading…</div>}>
          <WarehouseShell />
        </Suspense>
      </div>
    </div>
  );
}
