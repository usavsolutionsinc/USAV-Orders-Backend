'use client';

/**
 * Root error boundary — the last line of defense.
 *
 * `global-error.tsx` is the ONLY boundary that catches errors thrown by the root
 * layout itself (or by a component it renders, like `ResponsiveLayout` /
 * `DashboardSidebar`). When it renders, the root layout is gone, so it must
 * supply its own `<html>` and `<body>`.
 *
 * This is the boundary that turns a module-eval crash (e.g. an undefined symbol
 * in a sidebar panel) into a recoverable card instead of a raw 500 white page on
 * every route. Most failures should be caught lower down — per-route `error.tsx`
 * or the sidebar `ErrorBoundary` in `ResponsiveLayout` — and only the layout
 * shell itself falls through to here.
 */

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global-error] uncaught root render error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <div
          style={{
            minHeight: '100dvh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1rem',
            padding: '1.5rem',
            textAlign: 'center',
            background: '#f8fafc',
            fontFamily:
              'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <p
              style={{
                margin: 0,
                fontSize: '0.6875rem',
                fontWeight: 900,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                color: '#f43f5e',
              }}
            >
              Something broke
            </p>
            <h1 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 900, color: '#0f172a' }}>
              The app hit an unexpected error
            </h1>
            <p
              style={{
                margin: 0,
                maxWidth: '28rem',
                fontSize: '0.8125rem',
                fontWeight: 700,
                color: '#64748b',
              }}
            >
              {error?.message || 'Unexpected error.'}
              {error?.digest ? ` (ref: ${error.digest})` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                height: '2.75rem',
                padding: '0 1.25rem',
                borderRadius: '0.75rem',
                border: 'none',
                background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
                color: '#fff',
                fontSize: '0.875rem',
                fontWeight: 900,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.href = '/';
              }}
              style={{
                height: '2.75rem',
                padding: '0 1.25rem',
                borderRadius: '0.75rem',
                border: '1px solid #cbd5e1',
                background: '#fff',
                color: '#334155',
                fontSize: '0.875rem',
                fontWeight: 900,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                cursor: 'pointer',
              }}
            >
              Go home
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
