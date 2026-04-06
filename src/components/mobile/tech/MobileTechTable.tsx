'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { ShippedOrder } from '@/lib/neon/orders-queries';
import { Loader2, Package } from '@/components/Icons';
import WeekHeader, {
  weekHeaderInnerRowClass,
  weekDayGroupBandClass,
  weekDayGroupDateClass,
  weekDayGroupCountClass,
} from '@/components/ui/WeekHeader';
import { cn } from '@/utils/_cn';
import { getCurrentPSTDateKey, toPSTDateKey, formatDateWithOrdinal, computeWeekRange } from '@/utils/date';
import { type TechRecord } from '@/hooks/useTechLogs';
import { useTechTableController, hasUsableProductTitle, isFbaTechRecord } from '@/hooks/station/useTechTableController';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import { getSourceDotType, SOURCE_DOT_BG, SOURCE_DOT_LABEL } from '@/utils/source-dot';
import {
  getLast4,
  getLast6Serial,
  FnskuChip,
  OrderIdChip,
  TrackingChip,
  SerialChip,
} from '@/components/ui/CopyChip';
import { normalizeTrackingKey } from '@/lib/tracking-format';

interface MobileTechTableProps {
  techId: number;
  selectedDetailId: number | null;
  onOpenDetail: (detail: ShippedOrder) => void;
  onOrderedDetailsChange?: (details: ShippedOrder[]) => void;
}



function normalizeProductTitle(value: string | null | undefined): string {
  return String(value || '').trim();
}

function toDetailRecord(record: TechRecord): ShippedOrder {
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
    fnsku: record.fnsku || null,
    fnsku_log_id: record.fnsku_log_id ?? null,
    sal_id: record.source_row_id ?? record.id,
    tech_serial_id: record.tech_serial_id ?? (record.source_kind === 'tech_serial' ? record.id : undefined),
    source_row_id: record.source_row_id ?? null,
    source_kind: record.source_kind ?? null,
  } as ShippedOrder;
}

function getDetailId(record: TechRecord): number {
  const detail = toDetailRecord(record);
  return Number(detail.id ?? detail.shipment_id ?? record.id);
}

function getRowKey(record: TechRecord): string {
  return `${record.source_kind || 'tech'}:${record.source_row_id ?? record.id}`;
}

export function MobileTechTable({
  techId,
  selectedDetailId,
  onOpenDetail,
  onOrderedDetailsChange,
}: MobileTechTableProps) {
  const {
    weekOffset, setWeekOffset, weekRange,
    visibleRecords, groupedRecords, loading, isRefreshing,
    getRowKey, removedRowKeys, setRemovedRowKeys,
    scrollRef, stickyDate, currentCount,
  } = useTechTableController({ staffId: techId });

  const weekHeaderCountClass = stationThemeColors[getStaffThemeById(techId)].text;

  // Filter grouped records to week range for mobile
  const filteredGroupedRecords = useMemo(() =>
    Object.fromEntries(
      Object.entries(groupedRecords).filter(([date]) => date >= weekRange.startStr && date <= weekRange.endStr),
    ),
    [groupedRecords, weekRange.startStr, weekRange.endStr],
  );

  const orderedRecords = useMemo(
    () => Object.entries(filteredGroupedRecords)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .flatMap(([, dateRecords]) => (
        [...dateRecords].sort((a, b) => {
          const timeA = new Date(a.created_at || 0).getTime();
          const timeB = new Date(b.created_at || 0).getTime();
          return timeB - timeA;
        })
      )),
    [filteredGroupedRecords],
  );

  useEffect(() => {
    onOrderedDetailsChange?.(orderedRecords.map((record) => toDetailRecord(record)));
  }, [onOrderedDetailsChange, orderedRecords]);


  useEffect(() => {
    const handleTechLogRemoved = (e: Event) => {
      const detail = (e as CustomEvent<{ sourceKind?: string; sourceRowId?: number }>).detail;
      const sourceKind = String(detail?.sourceKind || '').trim();
      const sourceRowId = Number(detail?.sourceRowId);
      if (!sourceKind || !Number.isFinite(sourceRowId) || sourceRowId <= 0) return;

      setRemovedRowKeys((current) => {
        const next = new Set(current);
        next.add(`${sourceKind}:${sourceRowId}`);
        return next;
      });
    };

    window.addEventListener('tech-log-removed', handleTechLogRemoved as EventListener);
    return () => window.removeEventListener('tech-log-removed', handleTechLogRemoved as EventListener);
  }, []);

  const getWeekCount = () => Object.values(filteredGroupedRecords).reduce((sum, dateRecords) => sum + dateRecords.length, 0);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-white">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white">
      {isRefreshing && (
        <div className="absolute right-4 top-[calc(env(safe-area-inset-top)+1rem)] z-20">
          <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
        </div>
      )}

      <WeekHeader
        stickyDate={stickyDate}
        fallbackDate={formatDateWithOrdinal(getCurrentPSTDateKey())}
        count={currentCount || getWeekCount()}
        countClassName={weekHeaderCountClass}
        weekRange={weekRange}
        weekOffset={weekOffset}
        onPrevWeek={() => setWeekOffset((current) => current + 1)}
        onNextWeek={() => setWeekOffset((current) => Math.max(0, current - 1))}
        formatDate={formatDateWithOrdinal}
      />

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain no-scrollbar">
        {orderedRecords.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <Package className="h-8 w-8 text-gray-200" />
            <p className="mt-2 text-sm font-black tracking-tight text-gray-400">No tech records this week</p>
          </div>
        ) : (
          <div className="pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {Object.entries(filteredGroupedRecords)
              .sort((a, b) => b[0].localeCompare(a[0]))
              .map(([date, dateRecords]) => {
                const sortedRecords = [...dateRecords].sort((a, b) => {
                  const timeA = new Date(a.created_at || 0).getTime();
                  const timeB = new Date(b.created_at || 0).getTime();
                  return timeB - timeA;
                });

                return (
                  <section key={date}>
                    <div
                      data-day-header
                      data-date={date}
                      data-count={dateRecords.length}
                      className={cn(weekHeaderInnerRowClass, weekDayGroupBandClass)}
                    >
                      <p className={weekDayGroupDateClass}>{formatDateWithOrdinal(date)}</p>
                      <p className={cn(weekDayGroupCountClass, weekHeaderCountClass)}>
                        {dateRecords.length}
                      </p>
                    </div>

                    {sortedRecords.map((record) => {
                      const detailId = getDetailId(record);
                      const isSelected = selectedDetailId === detailId;
                      const quantity = parseInt(String(record.quantity || '1'), 10) || 1;
                      const fnskuValue = String(record.fnsku || '').trim();
                      const dotType = getSourceDotType({
                        orderId: record.order_id,
                        accountSource: record.account_source,
                      });
                      const serialValue = String(record.serial_number || '').trim();
                      const serialDisplayText = serialValue
                        ? getLast6Serial(record.serial_number)
                        : record.source_kind === 'fba_scan' || record.source_kind === 'tech_scan'
                          ? 'SERIAL'
                          : '---';

                      return (
                        <motion.div
                          key={getRowKey(record)}
                          role="button"
                          tabIndex={0}
                          onClick={() => onOpenDetail(toDetailRecord(record))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onOpenDetail(toDetailRecord(record));
                            }
                          }}
                          whileTap={{ scale: 0.992 }}
                          className={`w-full cursor-pointer border-b border-gray-200 px-3 py-2 text-left transition-colors ${
                            isSelected ? 'bg-blue-50' : 'bg-white active:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <span
                              className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${SOURCE_DOT_BG[dotType]}`}
                              title={SOURCE_DOT_LABEL[dotType]}
                            />

                            <div className="min-w-0 flex-1 space-y-1">
                              <p className="break-words text-[13px] font-black tracking-tight text-gray-900 leading-snug">
                                {hasUsableProductTitle(record.product_title)
                                  ? normalizeProductTitle(record.product_title)
                                  : 'Unknown Product'}
                              </p>

                              <div className="flex w-full min-w-0 items-start justify-between gap-2">
                                <div className="flex shrink-0 items-center gap-x-2">
                                  <span className="text-[10px] font-black tabular-nums uppercase tracking-[0.18em] text-gray-600">
                                    {quantity}
                                  </span>
                                  <span className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">
                                    {record.condition || 'No Condition'}
                                  </span>
                                </div>
                                <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-1 gap-y-1">
                                  {fnskuValue ? (
                                    <FnskuChip value={fnskuValue} />
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
                                    </>
                                  )}
                                  <SerialChip
                                    value={serialValue}
                                    display={serialDisplayText}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </section>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
