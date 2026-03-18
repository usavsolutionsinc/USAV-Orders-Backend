'use client';

import { Suspense } from 'react';
import ReceivingDashboard from '@/components/ReceivingDashboard';

export default function ReceivingPage() {
  return (
    <Suspense>
      <div className="flex h-full w-full overflow-hidden bg-[linear-gradient(180deg,#f5fbfa_0%,#ffffff_22%)]">
        <ReceivingDashboard />
      </div>
    </Suspense>
  );
}
