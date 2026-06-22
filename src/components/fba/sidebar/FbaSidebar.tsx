'use client';

import { Suspense } from 'react';
import { FbaWorkspaceSidebar, FbaWorkspaceSidebarFallback } from '@/components/fba/sidebar/FbaWorkspaceSidebar';
import { FbaCatalogSidebar, FbaCatalogSidebarFallback } from '@/components/fba/sidebar/FbaCatalogSidebar';

/** Dashboard /fba workspace sidebar (mode pills, scan bar, rails, shipped). */
export function FbaSidebarPanel() {
  return (
    <Suspense fallback={<FbaWorkspaceSidebarFallback />}>
      <FbaWorkspaceSidebar />
    </Suspense>
  );
}

/** Admin FNSKU catalog tools sidebar (/admin?section=fba). */
export function AdminFbaSidebarPanel() {
  return (
    <Suspense fallback={<FbaCatalogSidebarFallback />}>
      <FbaCatalogSidebar />
    </Suspense>
  );
}
