'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useWedgeScanner } from '@/hooks/useWedgeScanner';
import { routeScan } from '@/lib/barcode-routing';
import { scanFeedback } from '@/lib/feedback/confirm';

/**
 * Mount once at the app root. Every wedge scan is classified via
 * {@link routeScan}; URL-shaped payloads (printed QR labels) get navigated
 * to immediately. Bare SKUs / serials / bin codes are emitted as a
 * `wedge-scan` window CustomEvent so pages that want their own behavior
 * (e.g. the receiving sidebar) can listen.
 *
 * Tactile + audible feedback fires on every accepted scan so the user knows
 * the read landed — important on noisy floors.
 */
export function useGlobalWedgeScanner(): void {
  const router = useRouter();

  const onScan = useCallback(
    (value: string) => {
      const route = routeScan(value);
      scanFeedback();

      // Either dispatch the global event for page handlers OR navigate when
      // the scanned value is a printed-label URL.
      try {
        window.dispatchEvent(
          new CustomEvent('wedge-scan', { detail: { value, route } }),
        );
      } catch {
        /* CustomEvent is universally available; just being defensive */
      }

      if (route?.redirect) {
        router.push(route.redirect);
      }
    },
    [router],
  );

  useWedgeScanner({ onScan });
}
