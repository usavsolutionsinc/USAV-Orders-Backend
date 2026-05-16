import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishOrderChanged } from '@/lib/realtime/publish';

/** Bust `/api/orders` Upstash snapshots and any other entries tagged `orders`. */
export async function invalidateAllOrdersApiCaches(extraTags: string[] = []) {
  const tags = Array.from(new Set(['orders', ...extraTags].filter(Boolean)));
  await invalidateCacheTags(tags);
}

type InvalidateOrderViewsOptions = {
  orderIds: number[];
  source: string;
  extraTags?: string[];
};

/**
 * Canonical post-commit invalidation path for order mutations.
 * Use this from jobs/routes after order writes are durable so cached order
 * reads and realtime-driven dashboard views stay in sync.
 */
export async function invalidateOrderViews({
  orderIds,
  source,
  extraTags = [],
}: InvalidateOrderViewsOptions) {
  const normalizedIds = Array.from(
    new Set(orderIds.map(Number).filter((id) => Number.isFinite(id) && id > 0))
  );
  if (normalizedIds.length === 0) return;

  await invalidateAllOrdersApiCaches(extraTags);
  await publishOrderChanged({ orderIds: normalizedIds, source });
}
