import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OperationsDashboard } from '@/features/operations';

export const metadata: Metadata = {
  title: 'USAV Operations',
};

export default function OperationsPage() {
  return (
    <Suspense>
      <OperationsDashboard />
    </Suspense>
  );
}
