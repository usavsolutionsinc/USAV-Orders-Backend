'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import {
  detectPlatformFromUrl,
  parseReceivingPackage,
} from '@/components/sidebar/receiving/receiving-sidebar-shared';

/**
 * Source-platform state for a carton (platform is per-carton, not per-line).
 * Seeds synchronously from the row so the pill never flashes the fallback,
 * reconciles against the parent receiving row, auto-detects from the listing
 * URL when unset, and persists via PATCH (broadcasting
 * `receiving-package-updated` so sibling surfaces stay in sync).
 *
 * `setSourcePlatform` is returned so the panel's shared
 * `receiving-package-updated` listener can keep this in sync with edits made
 * elsewhere.
 */
export function useSourcePlatform(row: ReceivingLineRow, { listingLink }: { listingLink: string }) {
  // Seed from the row the table already loaded (`receiving_lines.source_platform`)
  // so the platform pill paints its real value immediately instead of flashing
  // the 'Unknown'/'Unfound' fallback while the reconcile fetch below is in flight.
  const [sourcePlatform, setSourcePlatform] = useState<string>(
    () => (row.source_platform || '').toLowerCase(),
  );
  const [platformSaving, setPlatformSaving] = useState(false);

  // Load the parent receiving row's source_platform so the dropdown reflects
  // the current shipment-level override.
  useEffect(() => {
    if (row.receiving_id == null) {
      setSourcePlatform('');
      return;
    }
    // Re-seed synchronously from the row on every line change — no empty frame.
    setSourcePlatform((row.source_platform || '').toLowerCase());
    let cancelled = false;
    fetch(`/api/receiving-lines?receiving_id=${row.receiving_id}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const pkg = parseReceivingPackage(data?.receiving_package);
        const fetched = (pkg?.source_platform || '').toLowerCase();
        // Only override with a non-empty reconcile value so we never blank the
        // already-correct seeded platform (which would re-introduce the flash).
        if (fetched) setSourcePlatform(fetched);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [row.receiving_id, row.source_platform]);

  const savePlatform = useCallback(async (next: string) => {
    if (row.receiving_id == null) return;
    setPlatformSaving(true);
    try {
      await fetch(`/api/receiving/${row.receiving_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_platform: next || null }),
      });
      window.dispatchEvent(new CustomEvent('receiving-package-updated', {
        detail: { receiving_id: row.receiving_id, source_platform: next || null },
      }));
    } catch {
      /* silent */
    } finally {
      setPlatformSaving(false);
    }
  }, [row.receiving_id]);

  // Auto-detect platform from the listing URL when the operator hasn't set one
  // yet. Only fires when sourcePlatform is empty so we never clobber a manual
  // choice. Debounced lightly so paste-then-type doesn't thrash the PATCH.
  useEffect(() => {
    if (row.receiving_id == null) return;
    if (sourcePlatform) return;
    const detected = detectPlatformFromUrl(listingLink);
    if (!detected) return;
    const t = window.setTimeout(() => {
      setSourcePlatform(detected);
      void savePlatform(detected);
    }, 350);
    return () => window.clearTimeout(t);
  }, [listingLink, sourcePlatform, row.receiving_id, savePlatform]);

  return { sourcePlatform, setSourcePlatform, platformSaving, savePlatform };
}
