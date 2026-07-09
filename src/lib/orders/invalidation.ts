import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { CACHE_TAGS } from '@/lib/cache/tags';
import { publishOrderChanged } from '@/lib/realtime/publish';

/** Bust `/api/orders` Upstash snapshots and any other entries tagged `orders`.
 *  Optionally org-scope the bust (v2 org-scoped tags — e.g. the order-detail
 *  read model) when the caller knows the tenant. */
export async function invalidateAllOrdersApiCaches(extraTags: string[] = [], organizationId?: string) {
  const tags = Array.from(new Set(['orders', ...extraTags].filter(Boolean)));
  await invalidateCacheTags(tags); // legacy global `/api/orders` snapshot cache
  if (organizationId) {
    // v2 org-scoped read models tagged `orders`/`order-detail`.
    await invalidateCacheTags(organizationId, [CACHE_TAGS.orders, CACHE_TAGS.orderDetail, ...tags]);
  }
}

type InvalidateOrderViewsOptions = {
  /** Owning tenant — from ctx.organizationId. Required so the realtime broadcast
   *  is org-namespaced. */
  organizationId: string;
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
  organizationId,
  orderIds,
  source,
  extraTags = [],
}: InvalidateOrderViewsOptions) {
  const normalizedIds = Array.from(
    new Set(orderIds.map(Number).filter((id) => Number.isFinite(id) && id > 0))
  );
  if (normalizedIds.length === 0) return;

  await invalidateAllOrdersApiCaches(extraTags, organizationId);
  await publishOrderChanged({ organizationId, orderIds: normalizedIds, source });
}
