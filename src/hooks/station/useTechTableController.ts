import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeWeekRange, formatDateWithOrdinal } from '@/utils/date';
import { toPSTDateKey } from '@/utils/date';
import { normalizeTrackingKey } from '@/lib/tracking-format';
import { useTechLogs, type TechRecord } from '@/hooks/useTechLogs';

// ─── Helpers (shared between desktop + mobile) ─────────────────────────────

function normalizeProductTitle(value: string | null | undefined): string {
  return String(value || '').trim();
}

export function hasUsableProductTitle(value: string | null | undefined): boolean {
  const normalized = normalizeProductTitle(value);
  return Boolean(normalized) && !/^unknown product$/i.test(normalized);
}

function hasSerialValue(value: string | null | undefined): boolean {
  return Boolean(String(value || '').trim());
}

export function isFbaTechRecord(record: TechRecord): boolean {
  return (
    record.source_kind === 'fba_scan' ||
    record.account_source === 'fba' ||
    Boolean(String(record.fnsku || '').trim()) ||
    String(record.order_id || '').toUpperCase() === 'FBA'
  );
}

function pickBestValue(primary: string | null | undefined, fallback: string | null | undefined): string | null {
  const a = String(primary || '').trim();
  const b = String(fallback || '').trim();
  if (a && !/^n\/a$/i.test(a)) return a;
  if (b && !/^n\/a$/i.test(b)) return b;
  return a || b || null;
}

function mergeSerialNumbers(a: string | null | undefined, b: string | null | undefined): string {
  const combined = [
    ...String(a || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
    ...String(b || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
  ];
  return Array.from(new Set(combined)).join(', ');
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GroupedRecords {
  [dateKey: string]: TechRecord[];
}

// ─── Hook ───────────────────────────────────────────────────────────────────

interface UseTechTableControllerOptions {
  staffId: number;
}

export function useTechTableController({ staffId }: UseTechTableControllerOptions) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [removedRowKeys, setRemovedRowKeys] = useState<Set<string>>(new Set());
  const [stickyDate, setStickyDate] = useState<string>('');
  const [currentCount, setCurrentCount] = useState<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const weekRange = computeWeekRange(weekOffset);
  const { data: records = [], isLoading, isFetching } = useTechLogs(staffId, { weekOffset, weekRange });
  const loading = isLoading && records.length === 0;
  const isRefreshing = isFetching && !isLoading;

  const getRowKey = useCallback((record: TechRecord) =>
    `${record.source_kind || 'tech'}:${record.source_row_id ?? record.id}`, []);

  // ── Deduplication + merging ───────────────────────────────────────────────

  const visibleRecords = useMemo(() => {
    const base = records.filter((record) => !removedRowKeys.has(getRowKey(record)));
    const sorted = [...base].sort((a, b) => {
      const timeA = new Date(a.created_at || 0).getTime();
      const timeB = new Date(b.created_at || 0).getTime();
      return timeB - timeA;
    });

    const trackingIndexByKey = new Map<string, number>();
    const unique: TechRecord[] = [];
    for (const record of sorted) {
      if (isFbaTechRecord(record)) {
        unique.push(record);
        continue;
      }

      const trackingKey = normalizeTrackingKey(record.shipping_tracking_number);
      if (!trackingKey) {
        unique.push(record);
        continue;
      }

      const existingIndex = trackingIndexByKey.get(trackingKey);
      if (existingIndex === undefined) {
        trackingIndexByKey.set(trackingKey, unique.length);
        unique.push(record);
        continue;
      }

      const existing = unique[existingIndex];
      if (!existing) continue;
      const existingHasSerial = hasSerialValue(existing.serial_number);
      const candidateHasSerial = hasSerialValue(record.serial_number);

      const shouldPreferCandidate =
        (candidateHasSerial && !existingHasSerial)
        || (
          candidateHasSerial
          && existingHasSerial
          && existing.source_kind !== 'tech_serial'
          && record.source_kind === 'tech_serial'
        );

      const mergedProductTitle = hasUsableProductTitle(record.product_title)
        ? normalizeProductTitle(record.product_title)
        : hasUsableProductTitle(existing.product_title)
          ? normalizeProductTitle(existing.product_title)
          : record.product_title;

      const mergedCondition = shouldPreferCandidate
        ? pickBestValue(record.condition, existing.condition)
        : pickBestValue(existing.condition, record.condition);
      const mergedSku = shouldPreferCandidate
        ? pickBestValue(record.sku, existing.sku)
        : pickBestValue(existing.sku, record.sku);
      const mergedSerial = mergeSerialNumbers(existing.serial_number, record.serial_number);

      if (shouldPreferCandidate) {
        unique[existingIndex] = {
          ...record,
          product_title: mergedProductTitle,
          condition: mergedCondition,
          sku: mergedSku,
          serial_number: mergedSerial,
        };
        continue;
      }

      const titleImproved = !hasUsableProductTitle(existing.product_title) && hasUsableProductTitle(record.product_title);
      const conditionImproved = mergedCondition !== existing.condition;
      const skuImproved = mergedSku !== existing.sku;
      const serialImproved = mergedSerial !== (existing.serial_number || '');
      if (titleImproved || conditionImproved || skuImproved || serialImproved) {
        unique[existingIndex] = {
          ...existing,
          product_title: mergedProductTitle,
          condition: mergedCondition,
          sku: mergedSku,
          serial_number: mergedSerial,
        };
      }
    }
    return unique;
  }, [records, removedRowKeys, getRowKey]);

  // ── Day grouping ──────────────────────────────────────────────────────────

  const groupedRecords = useMemo(() => {
    const groups: GroupedRecords = {};
    visibleRecords.forEach((record) => {
      if (!record.created_at) return;
      let date = '';
      try {
        date = toPSTDateKey(record.created_at) || 'Unknown';
      } catch {
        date = 'Unknown';
      }
      if (!groups[date]) groups[date] = [];
      groups[date].push(record);
    });
    return groups;
  }, [visibleRecords]);

  // ── Scroll-based sticky header ────────────────────────────────────────────

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop } = scrollRef.current;
    const headers = scrollRef.current.querySelectorAll('[data-day-header]');
    let activeDate = '';
    let activeCount = 0;
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i] as HTMLElement;
      if (header.offsetTop - scrollRef.current.offsetTop <= scrollTop + 5) {
        activeDate = header.getAttribute('data-date') || '';
        activeCount = parseInt(header.getAttribute('data-count') || '0');
      } else {
        break;
      }
    }
    if (activeDate) setStickyDate(formatDateWithOrdinal(activeDate));
    if (activeCount) setCurrentCount(activeCount);
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      setTimeout(() => handleScroll(), 100);
    }
    return () => container?.removeEventListener('scroll', handleScroll);
  }, [handleScroll, visibleRecords]);

  return {
    // Week navigation
    weekOffset,
    setWeekOffset,
    weekRange,

    // Data
    records,
    visibleRecords,
    groupedRecords,
    loading,
    isRefreshing,

    // Row utils
    getRowKey,
    removedRowKeys,
    setRemovedRowKeys,

    // Scroll
    scrollRef,
    stickyDate,
    currentCount,
    handleScroll,
  };
}
