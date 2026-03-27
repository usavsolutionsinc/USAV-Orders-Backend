'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from './Icons';
import { FnskuChip, OrderIdChip, TrackingChip, SerialChip, getLast4, getLast6Serial } from './ui/CopyChip';
import WeekHeader from './ui/WeekHeader';
import { formatDateWithOrdinal, getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import { dispatchCloseShippedDetails } from '@/utils/events';
import { getOrderDisplayValues } from '@/utils/order-display';
import { getSourceDotType, SOURCE_DOT_BG, SOURCE_DOT_LABEL } from '@/utils/source-dot';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import { useTechLogs, TechRecord } from '@/hooks/useTechLogs';

interface TechTableProps {
  testedBy: number;
}

function computeWeekRange(weekOffset: number) {
  const todayPst = getCurrentPSTDateKey();
  const [pstYear, pstMonth, pstDay] = todayPst.split('-').map(Number);
  const now = new Date(pstYear, (pstMonth || 1) - 1, pstDay || 1);
  const currentDay = now.getDay();
  const daysFromMonday = currentDay === 0 ? 6 : currentDay - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysFromMonday - weekOffset * 7);
  monday.setHours(0, 0, 0, 0);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  friday.setHours(23, 59, 59, 999);
  return {
    start: monday,
    end: friday,
    startStr: `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`,
    endStr: `${friday.getFullYear()}-${String(friday.getMonth() + 1).padStart(2, '0')}-${String(friday.getDate()).padStart(2, '0')}`,
  };
}

function normalizeTrackingKey(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeProductTitle(value: string | null | undefined): string {
  return String(value || '').trim();
}

function hasUsableProductTitle(value: string | null | undefined): boolean {
  const normalized = normalizeProductTitle(value);
  return Boolean(normalized) && !/^unknown product$/i.test(normalized);
}

function hasSerialValue(value: string | null | undefined): boolean {
  return Boolean(String(value || '').trim());
}

function isFbaTechRecord(record: TechRecord): boolean {
  return (
    record.source_kind === 'fba_scan' ||
    record.account_source === 'fba' ||
    Boolean(String(record.fnsku || '').trim()) ||
    String(record.order_id || '').toUpperCase() === 'FBA'
  );
}

/** Returns the first value that is non-empty and not a placeholder like "N/A". */
function pickBestValue(primary: string | null | undefined, fallback: string | null | undefined): string | null {
  const a = String(primary || '').trim();
  const b = String(fallback || '').trim();
  if (a && !/^n\/a$/i.test(a)) return a;
  if (b && !/^n\/a$/i.test(b)) return b;
  return a || b || null;
}

/** Merges two serial_number strings (comma-separated) into one deduplicated value. */
function mergeSerialNumbers(a: string | null | undefined, b: string | null | undefined): string {
  const combined = [
    ...String(a || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
    ...String(b || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
  ];
  return Array.from(new Set(combined)).join(', ');
}

export function TechTable({ testedBy }: TechTableProps) {
  const [stickyDate, setStickyDate] = useState<string>('');
  const [currentCount, setCurrentCount] = useState<number>(0);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDetailId, setSelectedDetailId] = useState<number | null>(null);
  const [removedRowKeys, setRemovedRowKeys] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  // Compute week range before calling the hook so it can be used in the query key
  const weekRange = computeWeekRange(weekOffset);
  const { data: records = [], isLoading, isFetching } = useTechLogs(testedBy, { weekOffset, weekRange });
  const loading = isLoading && records.length === 0;
  const isRefreshing = isFetching && !isLoading;
  const weekHeaderCountClass = stationThemeColors[getStaffThemeById(testedBy, 'technician')].text;

  useEffect(() => {
    const handleOpenDetails = (e: any) => {
      const nextId = Number(e?.detail?.id);
      setSelectedDetailId(Number.isFinite(nextId) ? nextId : null);
    };
    const handleCloseDetails = () => setSelectedDetailId(null);

    window.addEventListener('open-shipped-details', handleOpenDetails as any);
    window.addEventListener('close-shipped-details', handleCloseDetails as any);

    return () => {
      window.removeEventListener('open-shipped-details', handleOpenDetails as any);
      window.removeEventListener('close-shipped-details', handleCloseDetails as any);
    };
  }, []);

  const formatDate = (dateStr: string) => formatDateWithOrdinal(dateStr);

  const toDetailRecord = (record: TechRecord) => {
    // Normalize deadline to YYYY-MM-DD — field is sourced from work_assignments.deadline_at (TIMESTAMPTZ)
    const shipByDate = record.ship_by_date
      ? String(record.ship_by_date).split('T')[0]
      : '';

    return {
      id: record.order_db_id ?? record.id,
      ship_by_date: shipByDate,
      order_id: record.order_id || '',
      product_title: hasUsableProductTitle(record.product_title) ? normalizeProductTitle(record.product_title) : '',
      item_number: record.item_number || null,
      condition: record.condition || '',
      shipping_tracking_number: record.shipping_tracking_number || '',
      serial_number: record.serial_number || '',
      sku: record.sku || '',
      tester_id: null,
      tested_by: record.tested_by || null,
      test_date_time: record.created_at || null,
      packer_id: null,
      packed_by: null,
      packed_at: null,
      packer_photos_url: [],
      tracking_type: null,
      account_source: record.account_source || null,
      notes: record.notes || '',
      status_history: record.status_history || [],
      is_shipped: !!record.is_shipped,
      created_at: record.created_at || null,
      quantity: record.quantity || '1',
      shipment_id: record.shipment_id ?? null,
      status: record.status ?? null,
      tech_serial_id: record.tech_serial_id ?? (record.source_kind === 'tech_serial' ? record.id : undefined),
      source_row_id: record.source_row_id ?? null,
      source_kind: record.source_kind ?? null,
    };
  };

  const getDetailId = (record: TechRecord) => {
    const detail = toDetailRecord(record);
    return Number(detail.id ?? detail.shipment_id ?? record.id);
  };

  const getRowKey = (record: TechRecord) =>
    `${record.source_kind || 'tech'}:${record.source_row_id ?? record.id}`;

  const openDetails = (record: TechRecord) => {
    const detail = toDetailRecord(record);

    const detailId = getDetailId(record);
    if (selectedDetailId !== null && detailId === selectedDetailId) {
      dispatchCloseShippedDetails();
      setSelectedDetailId(null);
      return;
    }

    window.dispatchEvent(new CustomEvent('open-shipped-details', { detail }));
    setSelectedDetailId(detailId);
  };

  const formatHeaderDate = () => formatDate(getCurrentPSTDateKey());

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
    if (activeDate) setStickyDate(formatDate(activeDate));
    if (activeCount) setCurrentCount(activeCount);
  }, []);

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

      // Always pick the best condition + SKU from either row so a re-scan of the
      // same tracking (which may produce a tech_scan row with null fields) never
      // overwrites the values already established by the tech_serial row.
      const mergedCondition = shouldPreferCandidate
        ? pickBestValue(record.condition, existing.condition)
        : pickBestValue(existing.condition, record.condition);
      const mergedSku = shouldPreferCandidate
        ? pickBestValue(record.sku, existing.sku)
        : pickBestValue(existing.sku, record.sku);
      // Always union all serial numbers from both rows so that multiple TSN
      // records for the same tracking all appear together in the details panel.
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

      // Always patch the winner if any field improved — not just when product_title changed.
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
  }, [records, removedRowKeys]);

  useEffect(() => {
    const container = scrollRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      setTimeout(() => handleScroll(), 100);
    }
    return () => container?.removeEventListener('scroll', handleScroll);
  }, [handleScroll, visibleRecords]);

  // Group records by PST date (server pre-filters by week with ±1 day UTC buffer;
  // grouping + display filter below gives exact PST-week accuracy).
  const groupedRecords: { [key: string]: TechRecord[] } = {};
  visibleRecords.forEach(record => {
    if (!record.created_at) return;
    let date = '';
    try {
      date = toPSTDateKey(record.created_at) || 'Unknown';
    } catch (e) {
      date = 'Unknown';
    }
    if (!groupedRecords[date]) groupedRecords[date] = [];
    groupedRecords[date].push(record);
  });

  const filteredGroupedRecords = Object.fromEntries(
    Object.entries(groupedRecords).filter(([date]) => date >= weekRange.startStr && date <= weekRange.endStr)
  );

  const orderedRecords = Object.entries(filteredGroupedRecords)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .flatMap(([, dateRecords]) =>
      [...dateRecords].sort((a, b) => {
        const timeA = new Date(a.created_at || 0).getTime();
        const timeB = new Date(b.created_at || 0).getTime();
        return timeB - timeA;
      })
    );

  useEffect(() => {
    const handleNavigateDetails = (e: CustomEvent<{ direction?: 'up' | 'down' }>) => {
      if (selectedDetailId === null || orderedRecords.length === 0) return;

      const currentIndex = orderedRecords.findIndex((record) => getDetailId(record) === selectedDetailId);
      if (currentIndex < 0) return;

      const step = e.detail?.direction === 'up' ? -1 : 1;
      const nextRecord = orderedRecords[currentIndex + step];
      if (!nextRecord) return;

      const nextDetail = toDetailRecord(nextRecord);
      window.dispatchEvent(new CustomEvent('open-shipped-details', { detail: nextDetail }));
      setSelectedDetailId(getDetailId(nextRecord));
    };

    window.addEventListener('navigate-shipped-details' as any, handleNavigateDetails as any);
    return () => {
      window.removeEventListener('navigate-shipped-details' as any, handleNavigateDetails as any);
    };
  }, [orderedRecords, selectedDetailId]);

  useEffect(() => {
    const handleTechLogRemoved = (e: any) => {
      const sourceKind = String(e?.detail?.sourceKind || '').trim();
      const sourceRowId = Number(e?.detail?.sourceRowId);
      if (!sourceKind || !Number.isFinite(sourceRowId) || sourceRowId <= 0) return;

      setRemovedRowKeys((current) => {
        const next = new Set(current);
        next.add(`${sourceKind}:${sourceRowId}`);
        return next;
      });
      setSelectedDetailId(null);
    };

    window.addEventListener('tech-log-removed', handleTechLogRemoved as any);
    return () => window.removeEventListener('tech-log-removed', handleTechLogRemoved as any);
  }, []);

  const getWeekCount = () =>
    Object.values(filteredGroupedRecords).reduce((sum, recs) => sum + recs.length, 0);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-600">Loading tech records...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-white relative">
      {isRefreshing && (
        <div className="absolute right-2 top-2 z-30">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500" />
        </div>
      )}
      <div className="flex-1 flex flex-col overflow-hidden">
        <WeekHeader
          stickyDate={stickyDate}
          fallbackDate={formatHeaderDate()}
          count={currentCount || getWeekCount()}
          countClassName={weekHeaderCountClass}
          weekRange={weekRange}
          weekOffset={weekOffset}
          onPrevWeek={() => setWeekOffset(weekOffset + 1)}
          onNextWeek={() => setWeekOffset(Math.max(0, weekOffset - 1))}
          formatDate={formatDate}
        />
        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto no-scrollbar w-full">
          {Object.keys(filteredGroupedRecords).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-40 text-center">
              <p className="text-gray-500 font-medium italic opacity-20">No tech records found</p>
            </div>
          ) : (
            <div className="flex flex-col w-full">
              {Object.entries(filteredGroupedRecords)
                .sort((a, b) => b[0].localeCompare(a[0]))
                .map(([date, dateRecords]) => {
                  const sortedRecords = [...dateRecords].sort((a, b) => {
                    const timeA = new Date(a.created_at || 0).getTime();
                    const timeB = new Date(b.created_at || 0).getTime();
                    return timeB - timeA;
                  });
                  return (
                    <div key={date} className="flex flex-col">
                      <div
                        data-day-header
                        data-date={date}
                        data-count={dateRecords.length}
                        className="bg-gray-50/80 border-y border-gray-300 px-2 py-1 flex items-center justify-between z-10"
                      >
                        <p className="text-[11px] font-black text-gray-900 uppercase tracking-widest">{formatDate(date)}</p>
                        <p className="text-[11px] font-black text-gray-900 tabular-nums">{dateRecords.length}</p>
                      </div>
                      {sortedRecords.map((record, index) => {
                        const displayValues = getOrderDisplayValues({
                          sku: record.sku,
                          condition: record.condition,
                          trackingNumber: record.shipping_tracking_number,
                        });
                        const isFbaRow =
                          record.account_source === 'fba' ||
                          record.source_kind === 'fba_scan' ||
                          String(record.order_id || '').toUpperCase() === 'FBA';
                        const rawCondition = String(record.condition || '').trim();
                        const conditionLabel = isFbaRow
                          ? !rawCondition || /^fba\s*scan$/i.test(rawCondition)
                            ? 'N/A'
                            : rawCondition
                          : displayValues.condition || 'No Condition';
                        const fnskuValue = String(record.fnsku || '').trim();
                        const isFnskuRow = Boolean(fnskuValue);
                        const serialChipDisplay = record.serial_number
                          ? getLast6Serial(record.serial_number)
                          : record.source_kind === 'fba_scan' || record.source_kind === 'tech_scan'
                            ? 'SERIAL'
                            : '---';
                        const dotType = getSourceDotType({
                          orderId: record.order_id,
                          accountSource: record.account_source,
                        });
                        return (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            key={getRowKey(record)}
                            onClick={() => openDetails(record)}
                            className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 transition-all border-b border-gray-300 cursor-pointer hover:bg-blue-50/40 ${
                              index % 2 === 0 ? 'bg-white' : 'bg-gray-50/10'
                            }`}
                          >
                            <div className="flex flex-col min-w-0">
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className={`h-2 w-2 shrink-0 rounded-full ${SOURCE_DOT_BG[dotType]}`}
                                  title={SOURCE_DOT_LABEL[dotType]}
                                />
                                <div className="text-[11px] font-bold text-gray-900 truncate">
                                  {hasUsableProductTitle(record.product_title)
                                    ? normalizeProductTitle(record.product_title)
                                    : 'Unknown Product'}
                                </div>
                              </div>
                              <div className="text-[9px] font-black text-gray-400 uppercase tracking-widest truncate mt-0.5 pl-4">
                                <span className={(parseInt(String(record.quantity || '1'), 10) || 1) > 1 ? 'text-yellow-600' : undefined}>
                                  {parseInt(String(record.quantity || '1'), 10) || 1}
                                </span> • {conditionLabel}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              {isFnskuRow ? (
                                <>
                                  <FnskuChip value={fnskuValue} />
                                  <SerialChip value={record.serial_number || ''} display={serialChipDisplay} />
                                </>
                              ) : (
                                <>
                                  <OrderIdChip
                                    value={record.order_id || ''}
                                    display={getLast4(record.order_id)}
                                  />
                                  <TrackingChip
                                    value={record.shipping_tracking_number || ''}
                                    display={getLast4(record.shipping_tracking_number)}
                                  />
                                  <SerialChip value={record.serial_number || ''} display={serialChipDisplay} />
                                </>
                              )}
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
