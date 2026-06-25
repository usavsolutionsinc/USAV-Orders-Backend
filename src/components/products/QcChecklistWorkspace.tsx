'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Package, PackageOpen, ChevronRight } from '@/components/Icons';
import { useSkuQcChecks } from '@/hooks/useSkuQcChecks';
import { useSkuKitParts } from '@/hooks/useSkuKitParts';
import { QcChecklistSection } from '@/components/manuals/sections/QcChecklistSection';
import { SourceThisButton } from '@/components/sourcing/SourceThisButton';

/**
 * Right-pane workspace for the Products → QC Checklist view. Reads the selected
 * SKU from `?skuId=` (written by the sidebar's QcProductPicker), loads that
 * SKU's QC checklist, and renders it with the full add/edit/delete section.
 * Shows a centered empty state until a product is picked.
 */
export function QcChecklistWorkspace() {
  const searchParams = useSearchParams();
  const rawSkuId = searchParams.get('skuId');
  const skuId = rawSkuId ? Number(rawSkuId) : null;

  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useSkuQcChecks(skuId);
  // Sibling per-SKU surface — same sku_catalog.id anchor; surface the kit-parts
  // count and let the user jump straight to "what's in the box".
  const { data: kit } = useSkuKitParts(skuId);

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['sku-qc-checks', skuId] });
  }, [queryClient, skuId]);

  if (!skuId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-500">
          <Check className="h-7 w-7" />
        </span>
        <p className="mt-4 text-eyebrow font-black uppercase tracking-[0.18em] text-gray-400">
          QC Checklist
        </p>
        <p className="mt-2 max-w-[280px] text-caption font-medium text-gray-500">
          Select a product from the sidebar to view and manage its QC checklist.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="ml-2 text-caption font-semibold">Loading checklist…</span>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-caption font-semibold text-red-500">
        Couldn't load this product's QC checklist.
      </div>
    );
  }

  const { catalog, checks } = data;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Product header */}
      <div className="flex h-20 shrink-0 items-center gap-4 border-b border-gray-100 bg-white px-6">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-50 ring-1 ring-gray-200">
          {catalog.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={catalog.image_url}
              alt=""
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <Package className="h-6 w-6 text-gray-300" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-black text-gray-900">
            {catalog.product_title || catalog.sku}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-caption text-gray-500">{catalog.sku}</span>
            {catalog.category && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-micro font-bold uppercase tracking-wider text-gray-500">
                {catalog.category}
              </span>
            )}
          </div>
        </div>
        <SourceThisButton skuId={catalog.id} label="Source" variant="secondary" />
        <button
          type="button"
          onClick={() => router.replace(`/products?view=kit&skuId=${catalog.id}`)}
          className="shrink-0 flex items-center gap-1 rounded-full bg-gray-50 px-3 py-1 text-micro font-bold uppercase tracking-wider text-gray-500 ring-1 ring-gray-200 transition-colors hover:bg-gray-100 hover:text-gray-700"
          title="View what's in this product's box"
        >
          <PackageOpen className="h-3 w-3" />
          {kit?.parts.length ?? 0} kit
          <ChevronRight className="h-3 w-3" />
        </button>
        <span className="shrink-0 rounded-full bg-blue-50 px-3 py-1 text-micro font-black uppercase tracking-wider text-blue-600">
          {checks.length} {checks.length === 1 ? 'step' : 'steps'}
        </span>
      </div>

      {/* Checklist */}
      <div className="mx-auto w-full max-w-2xl px-6 py-6">
        <QcChecklistSection
          catalogId={catalog.id}
          qcChecks={checks}
          onRefresh={handleRefresh}
        />
      </div>
    </div>
  );
}
