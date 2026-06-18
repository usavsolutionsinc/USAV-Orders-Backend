'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  getDashboardOrderViewFromSearch,
  normalizeDashboardOrderViewParams,
  type DashboardOrderView,
} from '@/utils/dashboard-search-state';
import {
  readDetailsOpenBehaviorPreference,
  readShippedFilterPreference,
  readShippedSearchFieldPreference,
  writeDetailsOpenBehaviorPreference,
  writeShippedFilterPreference,
  writeShippedSearchFieldPreference,
  type DetailsOpenBehaviorPreference,
} from '@/utils/dashboard-preferences';
import { normalizeShippedSearchField, type ShippedSearchField } from '@/lib/shipped-search';
export type ShippedTypeFilter = 'all' | 'orders' | 'sku' | 'fba';

export function useDashboardSearchController() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const orderView = getDashboardOrderViewFromSearch(searchParams);
  const searchQuery = String(searchParams.get('search') || '').trim();
  const shippedFilterParam = searchParams.get('shippedFilter');
  const shippedFilter: ShippedTypeFilter = useMemo(() => {
    if (shippedFilterParam === 'orders') return 'orders';
    if (shippedFilterParam === 'sku') return 'sku';
    if (shippedFilterParam === 'fba') return 'fba';
    return readShippedFilterPreference() ?? 'all';
  }, [shippedFilterParam]);
  const shippedSearchFieldParam = searchParams.get('shippedSearchField');
  const shippedSearchField: ShippedSearchField = useMemo(() => {
    if (shippedSearchFieldParam != null) {
      return normalizeShippedSearchField(shippedSearchFieldParam);
    }
    return readShippedSearchFieldPreference() ?? 'all';
  }, [shippedSearchFieldParam]);
  const detailsOpenBehavior: DetailsOpenBehaviorPreference = useMemo(
    () => readDetailsOpenBehaviorPreference(),
    [],
  );
  const showIntakeForm = searchParams.get('new') === 'true';
  // FBA and Warranty render their own detail surfaces, not the shipped/unshipped panel.
  const detailsEnabled = orderView !== 'fba' && orderView !== 'warranty';

  const updateSearch = useCallback((mutate: (params: URLSearchParams) => void, nextPathname = '/dashboard') => {
    const nextParams = new URLSearchParams(searchParams.toString());
    mutate(nextParams);
    const targetPath = nextPathname || pathname || '/dashboard';
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `${targetPath}?${nextSearch}` : targetPath, { scroll: false });
  }, [pathname, router, searchParams]);

  const setSearch = useCallback(async (nextValue: string) => {
    const trimmed = nextValue.trim();
    const current = String(searchParams.get('search') || '').trim();
    // Always no-op when the query is unchanged. A previous version only skipped when
    // `openOrderId` was absent; re-applying the same search (e.g. ShippedSidebar
    // handleSearch re-running after a details panel opened) would strip `openOrderId`
    // and immediately close ShippedDetailsPanel.
    if (trimmed === current) return;

    updateSearch((params) => {
      if (trimmed) params.set('search', trimmed);
      else params.delete('search');
      params.delete('openOrderId');
    }, '/dashboard');
  }, [searchParams, updateSearch]);

  const setOrderView = useCallback((nextView: DashboardOrderView) => {
    updateSearch((params) => {
      normalizeDashboardOrderViewParams(params, nextView);
    }, '/dashboard');
  }, [updateSearch]);

  const openShippedMatches = useCallback((nextValue: string) => {
    const trimmed = nextValue.trim();
    updateSearch((params) => {
      normalizeDashboardOrderViewParams(params, 'shipped');
      if (trimmed) params.set('search', trimmed);
      else params.delete('search');
      params.delete('openOrderId');
    }, '/dashboard');
  }, [updateSearch]);

  const openOutboundLabels = useCallback((nextValue: string) => {
    const trimmed = nextValue.trim();
    const params = new URLSearchParams();
    if (trimmed) params.set('q', trimmed);
    const qs = params.toString();
    router.replace(qs ? `/outbound?${qs}` : '/outbound', { scroll: false });
  }, [router]);

  const setShippedFilter = useCallback((value: ShippedTypeFilter) => {
    writeShippedFilterPreference(value);
    updateSearch((params) => {
      if (value === 'all') params.delete('shippedFilter');
      else params.set('shippedFilter', value);
    }, '/dashboard');
  }, [updateSearch]);

  const setShippedSearchField = useCallback((value: ShippedSearchField) => {
    writeShippedSearchFieldPreference(value);
    updateSearch((params) => {
      if (value === 'all') params.delete('shippedSearchField');
      else params.set('shippedSearchField', value);
    }, '/dashboard');
  }, [updateSearch]);

  const setDetailsOpenBehavior = useCallback((value: DetailsOpenBehaviorPreference) => {
    writeDetailsOpenBehaviorPreference(value);
  }, []);

  const openIntakeForm = useCallback(() => {
    updateSearch((params) => {
      params.set('new', 'true');
    }, '/dashboard');
  }, [updateSearch]);

  const closeIntakeForm = useCallback(() => {
    updateSearch((params) => {
      params.delete('new');
    }, '/dashboard');
  }, [updateSearch]);

  useEffect(() => {
    writeShippedFilterPreference(shippedFilter);
  }, [shippedFilter]);

  useEffect(() => {
    writeShippedSearchFieldPreference(shippedSearchField);
  }, [shippedSearchField]);

  return {
    orderView,
    searchQuery,
    shippedFilter,
    shippedSearchField,
    detailsOpenBehavior,
    showIntakeForm,
    detailsEnabled,
    setSearch,
    setOrderView,
    openShippedMatches,
    openOutboundLabels,
    setShippedFilter,
    setShippedSearchField,
    setDetailsOpenBehavior,
    openIntakeForm,
    closeIntakeForm,
  };
}
