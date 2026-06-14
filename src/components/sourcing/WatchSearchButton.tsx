'use client';

/**
 * "Watch" — save a standing (recurring) sourcing search from wherever a query is
 * in hand (a Scout part row, a product). Creates a sourcing_searches row the
 * scour watcher re-runs on a cadence to auto-fill the watchlist. The recurring
 * complement to SourceThisButton's one-off demand.
 *
 * POSTs to /api/sourcing/saved-searches. Not idempotent server-side for free
 * text, so we disable after success to avoid accidental duplicates.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import { Button, type ButtonSize, type ButtonVariant } from '@/design-system/primitives/Button';
import { Clock } from '@/components/Icons';
import { jsonFetch } from './sourcing-shared';

export interface WatchSearchButtonProps {
  query: string;
  skuId?: number | null;
  cadence?: 'daily' | 'weekly';
  label?: string;
  doneLabel?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
  className?: string;
}

export function WatchSearchButton({
  query,
  skuId,
  cadence = 'daily',
  label = 'Watch',
  doneLabel = 'Watching',
  size = 'sm',
  variant = 'ghost',
  className,
}: WatchSearchButtonProps) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      jsonFetch('/api/sourcing/saved-searches', {
        method: 'POST',
        body: JSON.stringify({ query: query.trim(), skuId: skuId ?? undefined, cadence }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.sourcing.all }),
  });

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      icon={mutation.isSuccess ? undefined : <Clock />}
      loading={mutation.isPending}
      disabled={mutation.isSuccess || !query.trim()}
      onClick={() => mutation.mutate()}
      title="Save as a standing search (re-run on a cadence)"
    >
      {mutation.isSuccess ? doneLabel : label}
    </Button>
  );
}
