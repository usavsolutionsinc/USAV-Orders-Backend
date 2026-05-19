import { Suspense } from 'react';
import { ManualLibrary } from '@/components/manuals/ManualLibrary';

export const metadata = {
  title: 'Manuals Library',
};

export default function ManualLibraryPage() {
  return (
    <Suspense fallback={null}>
      <ManualLibrary />
    </Suspense>
  );
}
