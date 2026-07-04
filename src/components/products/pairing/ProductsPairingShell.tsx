'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ProductHubPanel } from './ProductHubPanel';
import type { PairingQueueItem } from './types';

/**
 * /products?view=pairing main pane.
 *
 * The queue list now lives in the sidebar (ProductsSidebarPanel renders
 * PairingQueueList). This component owns only the right pane: it resolves
 * `?sku=` to a sku_catalog_id (best-effort via /pairing-queue) and mounts
 * the ProductHubPanel for it.
 */
export function ProductsPairingShell() {
  const searchParams = useSearchParams();
  const urlSku = searchParams.get('sku');

  const [skuCatalogId, setSkuCatalogId] = useState<number | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  useEffect(() => {
    if (!urlSku) {
      setSkuCatalogId(null);
      setResolveError(null);
      return;
    }
    let cancelled = false;
    setResolving(true);
    setResolveError(null);

    (async () => {
      try {
        // Try the pairing-queue first — covers SKUs with outstanding
        // suggestions, which is the common case for this surface.
        const queueRes = await fetch(
          `/api/sku-catalog/pairing-queue?q=${encodeURIComponent(urlSku)}&limit=20`,
          { credentials: 'same-origin' },
        );
        if (queueRes.ok) {
          const body = await queueRes.json();
          const exact = (body.items || []).find(
            (i: PairingQueueItem) => i.sku.toUpperCase() === urlSku.toUpperCase(),
          );
          if (exact && !cancelled) {
            setSkuCatalogId(exact.skuCatalogId);
            return;
          }
        }
        // Fall back to /api/sku-catalog/resolve so already-paired SKUs can
        // still open the Hub (operator may want to unpair or audit).
        const resolveRes = await fetch(
          `/api/sku-catalog/resolve?sku=${encodeURIComponent(urlSku)}`,
          { credentials: 'same-origin' },
        );
        if (resolveRes.ok) {
          const body = await resolveRes.json();
          if (body?.resolved && !cancelled) {
            setSkuCatalogId(body.catalogId);
            return;
          }
        }
        if (!cancelled) {
          setSkuCatalogId(null);
          setResolveError(`No catalog entry for "${urlSku}".`);
        }
      } catch (err) {
        if (!cancelled) {
          setSkuCatalogId(null);
          setResolveError(err instanceof Error ? err.message : 'resolve failed');
        }
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();

    return () => { cancelled = true; };
  }, [urlSku]);

  if (!urlSku) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-canvas px-6 text-center">
        <div>
          <p className="text-sm font-bold text-text-muted">Pick a product to start pairing</p>
          <p className="mt-1 text-xs text-text-soft">
            The sidebar lists canonical SKUs with pending suggestions across one or more platforms.
          </p>
        </div>
      </div>
    );
  }

  if (resolving) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-canvas text-xs text-text-faint">
        Loading {urlSku}…
      </div>
    );
  }

  if (resolveError || skuCatalogId == null) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-canvas px-6 text-center">
        <div>
          <p className="text-sm font-bold text-text-muted">{resolveError || 'Not found'}</p>
          <p className="mt-1 text-xs text-text-soft">
            Pick another product from the sidebar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-surface-canvas">
      <ProductHubPanel key={skuCatalogId} skuCatalogId={skuCatalogId} />
    </div>
  );
}
