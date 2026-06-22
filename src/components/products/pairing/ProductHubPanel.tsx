'use client';

import { useCallback, useState } from 'react';
import { AlertCircle, Loader2 } from '@/components/Icons';
import { PRODUCT_HUB_PLATFORMS } from './platform-style';
import { useProductHub } from './useProductHub';
import { ListingResizePanel } from '@/components/listing/ListingResizePanel';
import { isElectron } from '@/utils/isElectron';
import { ProductHubHeader } from './product-hub/ProductHubHeader';
import { ChannelSection } from './product-hub/ChannelSection';
import { ManualPairForm } from './product-hub/ManualPairForm';
import { PendingFooter } from './product-hub/PendingFooter';

interface ProductHubPanelProps {
  skuCatalogId: number;
  /**
   * When true, render an inline "add a pairing manually" form above the channel
   * list. Off by default so the products pairing page stays suggestion-only;
   * enabled in the testing-workspace pairing modal.
   */
  allowManualPair?: boolean;
  /**
   * Authoritative product title for the header, supplied by the calling line
   * context. Overrides the marketplace catalog's product_title (the catalog SKU
   * namespace collides with Zoho's). Falls back to the canonical title when omitted.
   */
  headerTitle?: string | null;
}

/**
 * The Product Hub right pane: one row per platform showing confirmed pairings
 * and ranked suggestions, with batch accept/reject + atomic save.
 *
 * Pre-selection: candidates scoring ≥80 are seeded as "accept" by useProductHub
 * so the operator's default action is one Save click. Nothing commits without
 * explicit Save — human-in-the-loop by design. Thin composition layer — data
 * lives in {@link useProductHub}; the views live under `./product-hub/`.
 */
export function ProductHubPanel({ skuCatalogId, allowManualPair = false, headerTitle }: ProductHubPanelProps) {
  const hub = useProductHub(skuCatalogId);
  const snapshot = hub.snapshot;

  // Preview pane state: a row's external-link button selects its URL; the
  // ListingResizePanel mounts the URL inside an embedded Electron webview.
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);
  const canEmbedListing = isElectron();
  const openPreview = useCallback((url: string, label: string) => setPreview({ url, label }), []);

  if (hub.loading && !snapshot) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="ml-2 text-xs font-semibold">Loading suggestions…</span>
      </div>
    );
  }

  if (hub.error || !snapshot) {
    return (
      <div className="mx-auto max-w-md p-6">
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mr-1 inline h-4 w-4" />
          {hub.error || 'Could not load suggestions'}
        </div>
        <button
          type="button"
          onClick={hub.refresh}
          className="mt-3 rounded border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ProductHubHeader sku={snapshot.canonicalSku} title={headerTitle?.trim() || snapshot.canonicalTitle} />

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {allowManualPair ? <ManualPairForm skuCatalogId={skuCatalogId} onAdded={hub.refresh} /> : null}
        <div className="divide-y divide-gray-100">
          {PRODUCT_HUB_PLATFORMS.map((platform) => (
            <ChannelSection
              key={platform}
              platform={platform}
              confirmed={snapshot.confirmed[platform] || []}
              suggestions={snapshot.suggestions[platform] || []}
              canonicalTitle={snapshot.canonicalTitle}
              skuCatalogId={skuCatalogId}
              onAdded={hub.refresh}
              pendingByRowId={hub.pendingByRowId}
              onAccept={hub.toggleAccept}
              onReject={hub.toggleReject}
              onUnpair={hub.toggleUnpair}
              onPreview={openPreview}
              activePreviewUrl={preview?.url ?? null}
            />
          ))}
        </div>
      </div>

      <PendingFooter
        selectedCount={hub.acceptCount}
        unselectedCount={Math.max(0, hub.suggestionTotal - hub.acceptCount)}
        unpairCount={hub.unpairCount}
        saving={hub.saving}
        saveError={hub.saveError}
        onCommit={hub.commitDecisive}
        onDiscard={hub.clearPending}
      />

      {preview ? (
        <ListingResizePanel
          key={preview.url}
          url={preview.url}
          canEmbed={canEmbedListing}
          title={preview.label}
          storageNamespace="productsPairing"
        />
      ) : null}
    </div>
  );
}
