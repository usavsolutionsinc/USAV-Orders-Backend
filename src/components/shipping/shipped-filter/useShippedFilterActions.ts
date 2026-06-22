'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { DateRange } from 'react-day-picker';
import type { CarrierCode, ShipmentStatusCategory } from '@/components/shipping/ShipmentStatusBadge';
import type { ShippedTypeFilter } from './shipped-filter-constants';
import {
  parseISODate,
  parseStaffId,
  readShippedCarrierFilter,
  readShippedExceptionsFilter,
  readShippedStatusFilter,
  readShippedTypeFilter,
  toISODate,
} from './shipped-filter-params';

/**
 * Reads the shipped-filter URL state and exposes setters that rewrite it (always
 * dropping `shippedPage`). `basePath` overrides the target route — the sidebar
 * filters pass one; the refinements hook omits it (falls back to the pathname).
 */
export function useShippedFilterActions(basePath?: string) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const exceptionsOnly = readShippedExceptionsFilter(searchParams);
  const carrier = readShippedCarrierFilter(searchParams);
  const statusCategory = readShippedStatusFilter(searchParams);
  const typeFilter = readShippedTypeFilter(searchParams);
  const testedBy = parseStaffId(searchParams.get('testedBy'));
  const packedBy = parseStaffId(searchParams.get('packedBy'));
  const dateFrom = parseISODate(searchParams.get('dateFrom'));
  const dateTo = parseISODate(searchParams.get('dateTo'));
  const dateRange: DateRange | undefined = dateFrom ? { from: dateFrom, to: dateTo } : undefined;

  const replaceWith = useCallback(
    (mutator: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutator(params);
      // Any filter/view change invalidates the current page index.
      params.delete('shippedPage');
      const target = basePath || pathname || '/dashboard';
      const search = params.toString();
      router.replace(search ? `${target}?${search}` : target, { scroll: false });
    },
    [basePath, pathname, router, searchParams],
  );

  const toggleExceptions = useCallback(() => {
    replaceWith((p) => {
      if (exceptionsOnly) p.delete('exceptions');
      else p.set('exceptions', '1');
    });
  }, [exceptionsOnly, replaceWith]);

  const setCarrier = useCallback((next: CarrierCode | null) => {
    replaceWith((p) => { next ? p.set('carrier', next) : p.delete('carrier'); });
  }, [replaceWith]);

  const setStatus = useCallback((next: ShipmentStatusCategory | null) => {
    replaceWith((p) => { next ? p.set('statusCategory', next) : p.delete('statusCategory'); });
  }, [replaceWith]);

  const setTestedBy = useCallback((next: number | null) => {
    replaceWith((p) => { next ? p.set('testedBy', String(next)) : p.delete('testedBy'); });
  }, [replaceWith]);

  const setPackedBy = useCallback((next: number | null) => {
    replaceWith((p) => { next ? p.set('packedBy', String(next)) : p.delete('packedBy'); });
  }, [replaceWith]);

  const setDateRange = useCallback((next: DateRange | undefined) => {
    replaceWith((p) => {
      const from = toISODate(next?.from);
      const to = toISODate(next?.to ?? next?.from);
      from ? p.set('dateFrom', from) : p.delete('dateFrom');
      to ? p.set('dateTo', to) : p.delete('dateTo');
    });
  }, [replaceWith]);

  const setTypeFilter = useCallback((next: ShippedTypeFilter) => {
    replaceWith((p) => { next === 'all' ? p.delete('shippedFilter') : p.set('shippedFilter', next); });
  }, [replaceWith]);

  const clearAll = useCallback(() => {
    replaceWith((p) => {
      ['exceptions', 'carrier', 'statusCategory', 'testedBy', 'packedBy', 'dateFrom', 'dateTo', 'staff'].forEach((k) => p.delete(k));
    });
  }, [replaceWith]);

  return {
    exceptionsOnly, carrier, statusCategory, typeFilter, testedBy, packedBy, dateFrom, dateTo, dateRange,
    toggleExceptions, setCarrier, setStatus, setTestedBy, setPackedBy, setDateRange, setTypeFilter, clearAll,
  };
}
