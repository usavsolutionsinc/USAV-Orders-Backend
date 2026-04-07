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
import { usePackerLogs, type PackerRecord } from '@/hooks/usePackerLogs';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import { getSourceDotType, SOURCE_DOT_BG, SOURCE_DOT_LABEL } from '@/utils/source-dot';
import { getLast4 } from '@/components/ui/CopyChip';
import { isFbaOrder } from '@/utils/order-platform';
import { normalizeTrackingKey } from '@/lib/tracking-format';
import { usePackerTableController, isFbaPackerRecord } from '@/hooks/station/usePackerTableController';

// ─── Types ──────────────────────────────────────────────────────────────────

interface MobilePackerTableProps {
  packerId: number;
  selectedDetailId: number | null;
  onOpenDetail: (detail: ShippedOrder) => void;
  onOrderedDetailsChange?: (details: ShippedOrder[]) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────



function toDetailRecord(record: PackerRecord): ShippedOrder {
  const shipByDate = record.ship_by_date
    ? String(record.ship_by_date).split('T')[0]
    : '';

  return {
    id: record.order_row_id ?? record.id,
    ship_by_date: shipByDate,
    order_id: record.order_id || '',
    product_title: record.product_title || '',
    item_number: record.item_number || null,
    condition: record.condition || '',
    shipping_tracking_number: record.shipping_tracking_number || '',
    tracking_numbers: record.tracking_numbers || [],
    tracking_number_rows: record.tracking_number_rows || [],
    serial_number: record.serial_number || '',
    sku: record.sku || '',
    tester_id: record.tester_id ?? null,
    tested_by: record.tested_by ?? null,
    test_date_time: record.test_date_time || null,
    packer_id: record.packed_by ?? null,
    packed_by: record.packed_by ?? null,
    packed_at: record.created_at || null,
    packer_photos_url: record.packer_photos_url || [],
    tracking_type: record.tracking_type || null,
    account_source: record.account_source || null,
    notes: record.notes || '',
    status_history: record.status_history || [],
    is_shipped: true,
    created_at: record.created_at || null,
    quantity: record.quantity || '1',
    shipment_id: record.shipment_id ?? null,
    fnsku: record.fnsku || null,
    fnsku_log_id: record.fnsku_log_id ?? null,
    sal_id: record.id,
    packer_log_id: record.packer_log_id ?? null,
    source_row_id: record.id,
    source_kind: 'packer_scan',
  } as ShippedOrder;
}

function getDetailId(record: PackerRecord): number {
  return Number(record.order_row_id ?? record.shipment_id ?? record.id);
}

function getRowKey(record: PackerRecord): string {
  return `packer:${record.packer_log_id ?? record.id}`;
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '--';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '--';
  return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MobilePackerTable({
  packerId,
  selectedDetailId,
  onOpenDetail,
  onOrderedDetailsChange,
}: MobilePackerTableProps) {
  const {
    weekOffset, setWeekOffset, weekRange,
    visibleRecords, filteredGroupedRecords, orderedRecords,
    loading, isRefreshing,
    scrollRef, stickyDate, currentCount,
  } = usePackerTableController({ staffId: packerId });

  const [removedRowKeys, setRemovedRowKeys] = useState<Set<string>>(new Set());
  const weekHeaderCountClass = stationThemeColors[getStaffThemeById(packerId)].text;

  useEffect(() => {
    onOrderedDetailsChange?.(orderedRecords.map(toDetailRecord));
  }, [onOrderedDetailsChange, orderedRecords]);

  useEffect(() => {
    const handleRemoved = (e: Event) => {
      const detail = (e as CustomEvent<{ packerLogId?: number }>).detail;
      const plId = Number(detail?.packerLogId);
      if (!Number.isFinite(plId) || plId <= 0) return;
      setRemovedRowKeys((current) => {
        const next = new Set(current);
        next.add(`packer:${plId}`);
        return next;
      });
    };
    window.addEventListener('packer-log-removed', handleRemoved as EventListener);
    return () => window.removeEventListener('packer-log-removed', handleRemoved as EventListener);
  }, []);

  const getWeekCount = () => Object.values(filteredGroupedRecords).reduce((sum, recs) => sum + recs.length, 0);

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
        weekRange={weekRange}
        weekOffset={weekOffset}
        onPrevWeek={() => setWeekOffset((c) => c + 1)}
        onNextWeek={() => setWeekOffset((c) => Math.max(0, c - 1))}
      />

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain no-scrollbar">
        {orderedRecords.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <Package className="h-8 w-8 text-gray-200" />
            <p className="mt-3 text-sm font-black tracking-tight text-gray-400">No packer records this week</p>
          </div>
        ) : (
          <div className="pb-[max(1rem,env(safe-area-inset-bottom))]">
            {Object.entries(filteredGroupedRecords)
              .sort((a, b) => b[0].localeCompare(a[0]))
              .map(([date, dateRecords]) => {
                const sortedRecords = [...dateRecords].sort(
                  (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
                );

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
                      const hasPhotos = (record.packer_photos_url || []).length > 0;

                      return (
                        <motion.button
                          key={getRowKey(record)}
                          type="button"
                          onClick={() => onOpenDetail(toDetailRecord(record))}
                          whileTap={{ scale: 0.992 }}
                          className={`w-full border-b border-gray-200 px-4 py-3 text-left transition-colors ${
                            isSelected ? 'bg-blue-50' : 'bg-white active:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <span
                              className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${SOURCE_DOT_BG[dotType]}`}
                              title={SOURCE_DOT_LABEL[dotType]}
                            />

                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-[14px] font-black tracking-tight text-gray-900">
                                    {String(record.product_title || '').trim() || 'Unknown Product'}
                                  </p>
                                  <p className="mt-1 truncate text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">
                                    {quantity} • {record.condition || 'No Condition'}
                                    {hasPhotos ? ' • Photos' : ''}
                                  </p>
                                </div>

                                <p className="shrink-0 text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
                                  {formatTime(record.created_at)}
                                </p>
                              </div>

                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {fnskuValue ? (
                                  <span className="rounded-full border border-violet-200 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-violet-700">
                                    {fnskuValue.slice(-6)}
                                  </span>
                                ) : (
                                  <>
                                    <span className="rounded-full border border-gray-200 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-gray-700">
                                      #{getLast4(record.order_id)}
                                    </span>
                                    <span className="rounded-full border border-gray-200 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-gray-700">
                                      {getLast4(record.shipping_tracking_number)}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </motion.button>
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
