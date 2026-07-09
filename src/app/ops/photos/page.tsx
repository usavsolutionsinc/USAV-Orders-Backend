import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requirePermission } from '@/lib/auth/page-guard';
import { PhotoLibraryPage } from '@/components/photos/PhotoLibraryPage';

export const metadata: Metadata = {
  title: 'Media Library · USAV',
};

export default async function OpsPhotosPage() {
  await requirePermission('photos.view');
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading media library…</div>}>
      <PhotoLibraryPage />
    </Suspense>
  );
}
