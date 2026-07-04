'use client';

/**
 * Per-route error boundary for the main app tree.
 *
 * Catches an uncaught render error in a *route segment's* page content and
 * renders a recoverable card in its place — the root layout (sidebar, header,
 * offline banner) stays mounted, so the user keeps their navigation and can
 * retry or move on. Layout-shell failures fall through to `global-error.tsx`
 * instead; the sidebar has its own `ErrorBoundary` in `ResponsiveLayout`.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, RotateCcw } from '@/components/Icons';
import { Button } from '@/design-system/primitives';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error('[app/error] uncaught route render error:', error);
  }, [error]);

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-dashed border-rose-200 bg-rose-50 px-6 py-8 text-center">
        <AlertTriangle className="mx-auto h-6 w-6 text-rose-500" />
        <p className="mt-3 text-eyebrow font-black uppercase tracking-widest text-rose-500">
          Something broke
        </p>
        <h1 className="mt-1 text-base font-black text-text-default">This page hit an error</h1>
        <p className="mx-auto mt-2 max-w-sm text-caption font-bold text-text-soft">
          {error?.message || 'Unexpected error.'}
          {error?.digest ? (
            <span className="block text-eyebrow font-semibold uppercase tracking-widest text-text-faint">
              ref: {error.digest}
            </span>
          ) : null}
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <Button variant="primary" icon={<RotateCcw />} onClick={() => reset()}>
            Try again
          </Button>
          <Button variant="secondary" onClick={() => router.push('/')}>
            Go home
          </Button>
        </div>
      </div>
    </div>
  );
}
