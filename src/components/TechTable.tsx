'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { SkeletonList } from '@/design-system';
import { Loader2 } from './Icons';
import { FnskuChip, OrderIdChip, TrackingChip, SerialChip, PlatformChip, getLast4, getLast6Serial } from './ui/CopyChip';
import { DesktopDateGroupHeader } from './ui/DesktopDateGroupHeader';
import { getOrderPlatformLabel, getOrderPlatformColor, getOrderPlatformBorderColor } from '@/utils/order-platform';
import { getExternalUrlByItemNumber } from '@/hooks/useExternalItemUrl';
import WeekHeader from './ui/WeekHeader';
import { formatDateWithOrdinal, getCurrentPSTDateKey, toPSTDateKey, computeWeekRange } from '@/utils/date';
import { dispatchCloseShippedDetails } from '@/utils/events';
import { getOrderDisplayValues } from '@/utils/order-display';
import { getSourceDotType, SOURCE_DOT_BG, SOURCE_DOT_LABEL } from '@/utils/source-dot';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import { type TechRecord } from '@/hooks/useTechLogs';
import { normalizeTrackingKey } from '@/lib/tracking-format';
import { useTechTableController, hasUsableProductTitle, isFbaTechRecord } from '@/hooks/station/useTechTableController';

interface TechTableProps {
  testedBy: number;
}



function normalizeProductTitle(value: string | null | undefined): string {
  return String(value || '').trim();
}

export function TechTable({ testedBy }: TechTableProps) {
  const [selectedDetailId, setSelectedDetailId] = useState<number | null>(null);

  const {
    weekOffset, setWeekOffset, weekRange,
    visibleRecords, groupedRecords, loading, isRefreshing,
    getRowKey, removedRowKeys, setRemovedRowKeys,
    scrollRef, stickyDate, currentCount,
  } = useTechTableController({ staffId: testedBy });

  const weekHeaderCountClass = stationThemeColors[getStaffThemeById(testedBy)].text;

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
      tracking_numbers: record.tracking_numbers || [],
      tracking_number_rows: record.tracking_number_rows || [],
      serial_number: record.serial_number || '',
      sku: record.sku || '',
      tester_id: null,
      tested_by: record.tested_by || null,
      test_date_time: record.created_at || null,
      packer_id: null,
      packed_by: null,
      packed_at: null,
      packer_photos_url: [],
      tracking_type: record.fnsku ? 'FNSKU' : null,
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
      fnsku: record.fnsku || null,
      fnsku_log_id: record.fnsku_log_id ?? null,
      sal_id: record.source_row_id ?? record.id,
    };
  };

  const getDetailId = (record: TechRecord) => {
    const detail = toDetailRecord(record);
    return Number(detail.id ?? detail.shipment_id ?? record.id);
  };


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
      <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden">
        <div className="h-10 bg-white border-b border-gray-100 flex items-center px-4">
          <div className="h-4 w-32 bg-gray-100 rounded animate-pulse" />
        </div>
        <div className="flex-1 overflow-y-auto no-scrollbar">
          <SkeletonList count={12} />
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
          weekRange={weekRange}
          weekOffset={weekOffset}
          onPrevWeek={() => setWeekOffset(weekOffset + 1)}
          onNextWeek={() => setWeekOffset(Math.max(0, weekOffset - 1))}
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
                      <DesktopDateGroupHeader date={date} total={dateRecords.length} />
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
                          <div
                            key={getRowKey(record)}
                            onClick={() => openDetails(record)}
                            className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 transition-colors border-b border-gray-300 cursor-pointer hover:bg-blue-50/40 ${
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
                              <div className="text-[9px] font-black text-gray-500 uppercase tracking-widest truncate mt-0.5 pl-4">
                                <span className={(parseInt(String(record.quantity || '1'), 10) || 1) > 1 ? 'text-yellow-600' : undefined}>
                                  {parseInt(String(record.quantity || '1'), 10) || 1}
                                </span> • {conditionLabel}
                              </div>
                            </div>
                            <div className="flex items-center shrink-0">
                              {isFnskuRow ? (
                                <>
                                  <FnskuChip value={fnskuValue} />
                                  <SerialChip value={record.serial_number || ''} display={serialChipDisplay} />
                                </>
                              ) : (() => {
                                const plat = getOrderPlatformLabel(record.order_id || '', record.account_source);
                                return (
                                  <>
                                    {plat ? (
                                      <PlatformChip
                                        label={plat}
                                        underlineClass={getOrderPlatformBorderColor(plat)}
                                        iconClass={record.item_number ? getOrderPlatformColor(plat) : 'text-gray-500'}
                                        onClick={() => {
                                          const url = getExternalUrlByItemNumber(record.item_number);
                                          if (url) window.open(url, '_blank', 'noopener,noreferrer');
                                        }}
                                      />
                                    ) : null}
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
                                );
                              })()}
                            </div>
                          </div>
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
