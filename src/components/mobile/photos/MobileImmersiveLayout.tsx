'use client';

import { ReceivingPhoneBridgeMount } from '@/components/mobile/receiving/ReceivingPhoneBridgeMount';
import { ErrorBoundary } from '@/components/error/ErrorBoundary';

function ImmersivePageError(error: Error, reset: () => void) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-black px-6 text-center text-white">
      <div>
        <p className="text-micro font-black uppercase tracking-[0.22em] text-rose-400">
          Camera error
        </p>
        <p className="mt-2 text-sm font-bold text-white/80">
          {error.message || 'Something went wrong.'}
        </p>
      </div>
      <button
        type="button"
        onClick={reset}
        className="h-12 rounded-2xl bg-white/10 px-6 text-caption font-black uppercase tracking-wider text-white active:bg-white/20"
      >
        Try again
      </button>
    </div>
  );
}

/**
 * Layout for fullscreen mobile photo flows — outside the tab shell, black field,
 * no page transitions. Camera and gallery render in-tree here (not portaled).
 */
export function MobileImmersiveLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-black font-sans text-white antialiased">
      <ErrorBoundary label="mobile-immersive" fallback={ImmersivePageError}>
        <main className="relative min-h-0 flex-1 overflow-hidden">{children}</main>
      </ErrorBoundary>
      <ReceivingPhoneBridgeMount />
    </div>
  );
}
