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
        <button
          type="button"
          onClick={() => reset()}
          className="flex h-12 items-center justify-center rounded-2xl border border-slate-300 bg-white text-sm font-black uppercase tracking-wider text-slate-700 active:bg-slate-50"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => router.push('/m/receiving')}
          className="flex h-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-sm font-black uppercase tracking-wider text-white shadow-md shadow-blue-600/30 active:scale-[0.98]"
        >
          Back to Unbox
        </button>
      </div>
    </div>
  );
}
