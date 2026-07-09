'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Package, PackageOpen, ChevronRight } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { useSkuQcChecks } from '@/hooks/useSkuQcChecks';
import { useSkuKitParts } from '@/hooks/useSkuKitParts';
import { QcChecklistSection } from '@/components/manuals/sections/QcChecklistSection';
import { SourceThisButton } from '@/components/sourcing/SourceThisButton';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

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
        <p className="mt-4 text-eyebrow font-black uppercase tracking-[0.18em] text-text-faint">
          QC Checklist
        </p>
        <p className="mt-2 max-w-[280px] text-caption font-medium text-text-soft">
          Select a product from the sidebar to view and manage its QC checklist.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-text-faint">
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
      <div className="flex h-20 shrink-0 items-center gap-4 border-b border-border-hairline bg-surface-card px-6">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-canvas ring-1 ring-border-soft">
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
            <Package className="h-6 w-6 text-text-faint" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-black text-text-default">
            {catalog.product_title || catalog.sku}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-caption text-text-soft">{catalog.sku}</span>
            {catalog.category && (
              <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-micro font-bold uppercase tracking-wider text-text-soft">
                {catalog.category}
              </span>
            )}
          </div>
        </div>
        <SourceThisButton skuId={catalog.id} label="Source" variant="secondary" />
        <HoverTooltip label="View what's in this product's box" asChild>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={<PackageOpen />}
            iconRight={<ChevronRight />}
            onClick={() => router.replace(`/products?view=kit&skuId=${catalog.id}`)}
            ariaLabel="View what's in this product's box"
            className="h-auto shrink-0 gap-1 rounded-full bg-surface-canvas px-3 py-1 text-micro font-bold uppercase tracking-wider text-text-soft ring-1 ring-border-soft hover:bg-surface-sunken hover:text-text-muted"
          >
            {kit?.parts.length ?? 0} kit
          </Button>
        </HoverTooltip>
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
