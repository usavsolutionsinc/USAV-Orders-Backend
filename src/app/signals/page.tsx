import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SignalsWorkspace } from '@/features/signals/SignalsWorkspace';

export const metadata: Metadata = {
  title: 'Signals',
};

export default function SignalsPage() {
  return (
    <Suspense>
      <SignalsWorkspace />
    </Suspense>
  );
}
