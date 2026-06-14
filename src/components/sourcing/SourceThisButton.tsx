'use client';

/**
 * "Source this" — push any product/part into the unified sourcing queue on
 * demand (the human-directed inverse of the nightly scan). Drop it onto any
 * surface that knows a SKU and/or a free-text target: a part row, a SKU/product
 * row, a repair, a warranty claim, an order line.
 *
 * POSTs to /api/sourcing/alerts (demand_source='manual'). Idempotent for
 * SKU-backed rows server-side, so a repeat click won't duplicate the queue row.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import { Button, type ButtonSize, type ButtonVariant } from '@/design-system/primitives/Button';
import { Plus } from '@/components/Icons';
import { jsonFetch } from './sourcing-shared';

export interface SourceThisButtonProps {
  skuId?: number | null;
  /** Free-text scour target when there's no catalog SKU (new/different product). */
  searchQuery?: string | null;
  boseModelId?: number | null;
  /** How many we need (e.g. a replenishment shortfall). */
  targetQty?: number | null;
  label?: string;
  doneLabel?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
  className?: string;
}

export function SourceThisButton({
  skuId,
  searchQuery,
  boseModelId,
  targetQty,
  label = 'Source',
  doneLabel = 'Queued',
  size = 'sm',
  variant = 'secondary',
  className,
}: SourceThisButtonProps) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      jsonFetch('/api/sourcing/alerts', {
        method: 'POST',
        body: JSON.stringify({
          skuId: skuId ?? undefined,
          searchQuery: searchQuery?.trim() || undefined,
          boseModelId: boseModelId ?? undefined,
          targetQty: targetQty && targetQty > 1 ? targetQty : undefined,
        }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.sourcing.all }),
  });

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      icon={mutation.isSuccess ? undefined : <Plus />}
      loading={mutation.isPending}
      disabled={mutation.isSuccess}
      onClick={() => mutation.mutate()}
      title="Add to the sourcing queue"
    >
      {mutation.isSuccess ? doneLabel : label}
    </Button>
  );
}
