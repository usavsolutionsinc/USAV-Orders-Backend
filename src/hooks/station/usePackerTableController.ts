import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeWeekRange, toPSTDateKey } from '@/utils/date';
import { isFbaOrder } from '@/utils/order-platform';
import { usePackerLogs, type PackerRecord } from '@/hooks/usePackerLogs';

// ─── Helpers ────────────────────────────────────────────────────────────────

export function isFbaPackerRecord(record: PackerRecord): boolean {
  return (
    isFbaOrder(record.order_id, record.account_source) ||
    String(record.tracking_type || '').toUpperCase() === 'FNSKU'
  );
}

export interface GroupedPackerRecords {
  [dateKey: string]: PackerRecord[];
}

// ─── Hook ───────────────────────────────────────────────────────────────────

interface UsePackerTableControllerOptions {
  staffId: number;
  /** Optional external search string (desktop uses URL params). */
  searchTerm?: string;
}

export function usePackerTableController({ staffId, searchTerm = '' }: UsePackerTableControllerOptions) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [stickyDate, setStickyDate] = useState<string>('');
  const [currentCount, setCurrentCount] = useState<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const weekRange = computeWeekRange(weekOffset);
  const { data: records = [], isLoading, isFetching } = usePackerLogs(staffId, { weekOffset, weekRange });
  const loading = isLoading && records.length === 0;
  const isRefreshing = isFetching && !isLoading;

  // ── Deduplication ─────────────────────────────────────────────────────────

  const dedupedRecords = useMemo(() => {
    const seenTracking = new Map<string, PackerRecord>();
    [...records].sort((a, b) => a.id - b.id).forEach((record) => {
      if (isFbaPackerRecord(record)) {
        seenTracking.set(`fba:${record.id}`, record);
        return;
      }
      const key = (record.shipping_tracking_number || record.scan_ref || String(record.id)).trim();
      seenTracking.set(key, record);
    });
    return Array.from(seenTracking.values());
  }, [records]);

  // ── Search filtering ──────────────────────────────────────────────────────

  const visibleRecords = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    if (!normalizedSearch) return dedupedRecords;
    return dedupedRecords.filter((record) => {
      const haystack = [
        record.product_title,
        record.order_id,
        record.shipping_tracking_number,
        record.scan_ref,
        record.sku,
        record.condition,
        record.account_source,
      ]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');
      return haystack.includes(normalizedSearch);
    });
  }, [dedupedRecords, searchTerm]);

  // ── Day grouping ──────────────────────────────────────────────────────────

  const groupedRecords = useMemo(() => {
    const groups: GroupedPackerRecords = {};
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

  const filteredGroupedRecords = useMemo(() =>
    Object.fromEntries(
      Object.entries(groupedRecords).filter(([date]) => date >= weekRange.startStr && date <= weekRange.endStr),
    ),
    [groupedRecords, weekRange.startStr, weekRange.endStr],
  );

  const orderedRecords = useMemo(() =>
    Object.entries(filteredGroupedRecords)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .flatMap(([, dateRecords]) =>
        [...dateRecords].sort((a, b) => {
          const timeA = new Date(a.created_at || 0).getTime();
          const timeB = new Date(b.created_at || 0).getTime();
          return timeB - timeA;
        }),
      ),
    [filteredGroupedRecords],
  );

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
    if (activeDate) setStickyDate(activeDate);
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
    weekOffset,
    setWeekOffset,
    weekRange,
    records,
    dedupedRecords,
    visibleRecords,
    groupedRecords,
    filteredGroupedRecords,
    orderedRecords,
    loading,
    isRefreshing,
    scrollRef,
    stickyDate,
    currentCount,
  };
}
