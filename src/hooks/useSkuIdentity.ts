'use client';

import { useEffect, useState } from 'react';
import type { SkuPlatformMapping } from '@/components/inventory/SkuIdentity';

/**
 * useSkuIdentity — fetches `{canonicalSku, productTitle, platforms}` for a
 * raw SKU value (which may be the internal SKU or a marketplace platform
 * SKU). Designed to feed the SkuIdentity component from any screen that
 * only knows the order's raw sku + source.
 *
 * Cached per (sku, accountSource) in-process so the same panel re-opens
 * don't re-fetch.
 */

export interface SkuIdentityResolution {
  resolved: boolean;
  canonicalSku: string | null;
  productTitle: string | null;
  catalogId: number | null;
  platforms: SkuPlatformMapping[];
}

const cache = new Map<string, SkuIdentityResolution>();
const inflight = new Map<string, Promise<SkuIdentityResolution>>();

function cacheKey(sku: string, platform: string | null | undefined): string {
  return `${sku}::${platform || ''}`;
}

async function fetchResolution(sku: string, platform: string | null | undefined): Promise<SkuIdentityResolution> {
  const key = cacheKey(sku, platform);
  if (cache.has(key)) return cache.get(key)!;
  if (inflight.has(key)) return inflight.get(key)!;

  const url = `/api/sku-catalog/resolve?sku=${encodeURIComponent(sku)}${
    platform ? `&platform=${encodeURIComponent(platform)}` : ''
  }`;
  const p = (async () => {
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    const result: SkuIdentityResolution = data?.resolved
      ? {
          resolved: true,
          canonicalSku: data.canonicalSku ?? null,
          productTitle: data.productTitle ?? null,
          catalogId: data.catalogId ?? null,
          platforms: Array.isArray(data.platforms)
            ? data.platforms.map((p: any) => ({
                platform: p.platform,
                platformSku: p.platformSku ?? null,
                platformItemId: p.platformItemId ?? null,
                accountName: p.accountName ?? null,
              }))
            : [],
        }
      : {
          resolved: false,
          canonicalSku: null,
          productTitle: null,
          catalogId: null,
          platforms: [],
        };
    cache.set(key, result);
    inflight.delete(key);
    return result;
  })();
  inflight.set(key, p);
  return p;
}

interface UseSkuIdentityResult extends SkuIdentityResolution {
  loading: boolean;
  error: string | null;
}

const EMPTY: SkuIdentityResolution = {
  resolved: false,
  canonicalSku: null,
  productTitle: null,
  catalogId: null,
  platforms: [],
};

export function useSkuIdentity(sku: string | null | undefined, accountSource: string | null | undefined): UseSkuIdentityResult {
  const trimmedSku = (sku || '').trim();
  const [state, setState] = useState<UseSkuIdentityResult>(() => ({
    ...EMPTY,
    loading: Boolean(trimmedSku),
    error: null,
  }));

  useEffect(() => {
    if (!trimmedSku) {
      setState({ ...EMPTY, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    fetchResolution(trimmedSku, accountSource ?? null)
      .then((res) => {
        if (cancelled) return;
        setState({ ...res, loading: false, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          ...EMPTY,
          loading: false,
          error: err instanceof Error ? err.message : 'resolve failed',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [trimmedSku, accountSource]);

  return state;
}
