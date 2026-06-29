'use client';

/**
 * Error boundary for every /m/* route.
 *
 * Before this existed, any uncaught render error in the mobile tree (e.g. a
 * failed photo-capture return, a thrown hook) unmounted the whole React tree to
 * a BLANK WHITE SCREEN with no message and no way back — the "Done freezes on a
 * white screen" symptom. App Router renders the nearest error.tsx instead, so a
 * failure now shows a recoverable card with the real error and a way back to the
 * Unbox feed.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/design-system/primitives';

export default function MobileError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    // Surface the true cause in the device console / logs instead of swallowing
    // it behind a blank screen.
    console.error('[m/error] uncaught mobile render error:', error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-6 text-center">
      <div className="flex flex-col items-center gap-2">
        <p className="text-micro font-black uppercase tracking-[0.22em] text-rose-500">
          Something broke
        </p>
        <h1 className="text-lg font-black text-slate-900">This screen hit an error</h1>
        <p className="max-w-xs text-caption font-bold text-slate-500">
          {error?.message || 'Unexpected error.'}
        </p>
      </div>
      <div className="grid w-full max-w-xs grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => reset()} className="h-12 w-full">
          Try again
        </Button>
        <Button variant="primary" onClick={() => router.push('/m/receiving')} className="h-12 w-full">
          Back to Unbox
        </Button>
      </div>
    </div>
  );
}
