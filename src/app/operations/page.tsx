import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OperationsWorkspace } from '@/features/operations/workspace/OperationsWorkspace';

export const metadata: Metadata = {
  title: 'USAV Operations',
};

export default function OperationsPage() {
  return (
    <Suspense>
      <OperationsWorkspace />
    </Suspense>
  );
}
