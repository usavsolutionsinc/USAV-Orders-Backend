'use client';

import { PhotoUploadToaster } from '@/components/mobile/receiving/PhotoUploadToaster';

/**
 * Root mobile layout — shared services only. Tab chrome lives in (shell);
 * fullscreen photo flows live in (immersive).
 */
export default function MobileRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <PhotoUploadToaster />
    </>
  );
}
