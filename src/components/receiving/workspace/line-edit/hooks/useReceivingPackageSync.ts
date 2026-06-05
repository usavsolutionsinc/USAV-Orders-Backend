'use client';

/**
 * Two halves of the carton-level metadata sync loop for LineEditPanel:
 *
 *   1. Persist `listing_url` to the carton (`receiving.listing_url`), debounced
 *      so paste-then-type doesn't thrash PATCH, then broadcast
 *      `receiving-package-updated` so other open surfaces (the tech testing
 *      workspace in another browser, the top PO card) pick it up.
 *   2. Mirror incoming `receiving-package-updated` events — when the platform
 *      or listing changes elsewhere for THIS carton, reflect it here.
 *
 * Extracted from LineEditPanel; behaviour is unchanged. The write guards
 * against round-tripping the same value just hydrated from the DB.
 */

import { useEffect } from 'react';
import { emitAppEvent, useEventBridge } from '@/hooks';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

interface UseReceivingPackageSyncArgs {
  row: ReceivingLineRow;
  listingLink: string;
  setListingLink: (v: string) => void;
  setSourcePlatform: (v: string) => void;
}

export function useReceivingPackageSync({
  row,
  listingLink,
  setListingLink,
  setSourcePlatform,
}: UseReceivingPackageSyncArgs) {
  // 1. Debounced persist of listing_url, with a broadcast on success.
  useEffect(() => {
    if (row.receiving_id == null) return;
    const trimmed = listingLink.trim();
    const dbValue = (row.receiving_listing_url || '').trim();
    if (trimmed === dbValue) return;
    const rid = row.receiving_id;
    const t = window.setTimeout(() => {
      void fetch(`/api/receiving/${rid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_url: trimmed || null }),
      })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!data?.success) return;
          emitAppEvent('receiving-package-updated', {
            receiving_id: rid,
            listing_url: (data.receiving?.listing_url as string | null) ?? null,
          });
        })
        .catch(() => {
          /* silent — scratch keeps the value locally until next attempt */
        });
    }, 450);
    return () => window.clearTimeout(t);
  }, [listingLink, row.receiving_id, row.receiving_listing_url]);

  // 2. Mirror platform/listing changes made on other surfaces for this carton.
  useEventBridge({
    'receiving-package-updated': (e) => {
      if (row.receiving_id == null) return;
      const detail = (e as CustomEvent<{
        receiving_id?: number;
        source_platform?: string | null;
        listing_url?: string | null;
      }>).detail;
      if (!detail || detail.receiving_id !== row.receiving_id) return;
      if (detail.source_platform !== undefined) {
        setSourcePlatform((detail.source_platform || '').toLowerCase());
      }
      if (detail.listing_url !== undefined) {
        setListingLink(detail.listing_url || '');
      }
    },
  });
}
