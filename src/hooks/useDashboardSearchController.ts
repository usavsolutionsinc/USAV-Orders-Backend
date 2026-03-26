'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  getDashboardOrderViewFromSearch,
  normalizeDashboardOrderViewParams,
  type DashboardOrderView,
} from '@/utils/dashboard-search-state';
export type PendingStockFilter = 'all' | 'pending' | 'stock';
export type ShippedTypeFilter = 'all' | 'orders' | 'sku' | 'fba';

export function useDashboardSearchController() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const orderView = getDashboardOrderViewFromSearch(searchParams);
  const searchQuery = String(searchParams.get('search') || '').trim();
  const pendingFilterParam = searchParams.get('pendingFilter');
  const pendingFilter: PendingStockFilter =
    pendingFilterParam === 'stock'
      ? 'stock'
      : pendingFilterParam === 'pending'
        ? 'pending'
        : 'all';
  const shippedFilterParam = searchParams.get('shippedFilter');
  const shippedFilter: ShippedTypeFilter =
    shippedFilterParam === 'orders'
      ? 'orders'
      : shippedFilterParam === 'sku'
        ? 'sku'
        : shippedFilterParam === 'fba'
          ? 'fba'
          : 'all';
  const showIntakeForm = searchParams.get('new') === 'true';
  const detailsEnabled = orderView !== 'fba';

  const updateSearch = useCallback((mutate: (params: URLSearchParams) => void, nextPathname = '/dashboard') => {
    const nextParams = new URLSearchParams(searchParams.toString());
    mutate(nextParams);
    const targetPath = nextPathname || pathname || '/dashboard';
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `${targetPath}?${nextSearch}` : targetPath);
  }, [pathname, router, searchParams]);

  const setSearch = useCallback(async (nextValue: string) => {
    const trimmed = nextValue.trim();
    updateSearch((params) => {
      if (trimmed) params.set('search', trimmed);
      else params.delete('search');
      params.delete('openOrderId');
    }, '/dashboard');
  }, [updateSearch]);

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

  const setPendingFilter = useCallback((value: PendingStockFilter) => {
    updateSearch((params) => {
      params.set('pendingFilter', value);
    }, '/dashboard');
  }, [updateSearch]);

  const setShippedFilter = useCallback((value: ShippedTypeFilter) => {
    updateSearch((params) => {
      if (value === 'all') params.delete('shippedFilter');
      else params.set('shippedFilter', value);
    }, '/dashboard');
  }, [updateSearch]);

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

  return {
    orderView,
    searchQuery,
    pendingFilter,
    shippedFilter,
    showIntakeForm,
    detailsEnabled,
    setSearch,
    setOrderView,
    openShippedMatches,
    setPendingFilter,
    setShippedFilter,
    openIntakeForm,
    closeIntakeForm,
  };
}
