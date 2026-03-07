'use client';

import { Suspense } from 'react';
import ReceivingDashboard from '@/components/ReceivingDashboard';

export default function ReceivingPage() {
  return (
    <Suspense>
      <div className="flex h-full w-full overflow-hidden bg-white">
        <ReceivingDashboard />
      </div>
    </Suspense>
  );
}
