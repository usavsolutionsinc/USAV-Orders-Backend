'use client';

import { useEffect, useState } from 'react';
import { framerPresence, framerTransition, SkeletonList } from '@/design-system';
import { Loader2 } from './Icons';
import { FnskuChip, OrderIdChip, OrderIdChipPlaceholder, TrackingOrSkuScanChip, PlatformChip, getLast4 } from './ui/CopyChip';
import { ChipColumns, CHIP_COL, type ChipColumn } from '@/components/ui/ChipColumns';
import { RowTitle, RowMetaColumns } from '@/components/ui/RowMetaColumns';
import { getOrderPlatformLabel, getOrderPlatformColor, getOrderPlatformBorderColor } from '@/utils/order-platform';
import { getExternalUrlByItemNumber, skuScanPrefixBeforeColon } from '@/hooks/useExternalItemUrl';
import WeekHeader from './ui/WeekHeader';
import { DesktopDateGroupHeader } from './ui/DesktopDateGroupHeader';
import { formatDateWithOrdinal, getCurrentPSTDateKey } from '@/utils/date';
import { dispatchCloseShippedDetails } from '@/utils/events';
import { getOrderDisplayValues } from '@/utils/order-display';
import { getSourceDotType, isSkuSourceRecord, SOURCE_DOT_BG, SOURCE_DOT_LABEL } from '@/utils/source-dot';
import { type PackerRecord } from '@/hooks/usePackerLogs';
import { usePackerTableController, isFbaPackerRecord } from '@/hooks/station/usePackerTableController';
import { motion } from 'framer-motion';

interface PackerTableProps {
  packedBy: number;
}

export function PackerTable({ packedBy }: PackerTableProps) {
  const [selectedDetailId, setSelectedDetailId] = useState<number | null>(null);

  const {
    weekOffset,
    setWeekOffset,
    weekRange,
    filteredGroupedRecords,
    orderedRecords,
    loading,
    isRefreshing,
    scrollRef,
    stickyDate,
    currentCount,
  } = usePackerTableController({ staffId: packedBy });

  useEffect(() => {
    const handleOpenDetails = (e: unknown) => {
      const detail = e as CustomEvent<{ id?: unknown }>;
      const nextId = Number(detail?.detail?.id);
      setSelectedDetailId(Number.isFinite(nextId) ? nextId : null);
    };
    const handleCloseDetails = () => setSelectedDetailId(null);

    window.addEventListener('open-shipped-details', handleOpenDetails as EventListener);
    window.addEventListener('close-shipped-details', handleCloseDetails as EventListener);

    return () => {
      window.removeEventListener('open-shipped-details', handleOpenDetails as EventListener);
      window.removeEventListener('close-shipped-details', handleCloseDetails as EventListener);
    };
  }, []);

  const formatDate = (dateStr: string) => formatDateWithOrdinal(dateStr);

  const toDetailRecord = (record: PackerRecord) => {
    return {
      id: record.id,
      ship_by_date: '',
      order_id: record.order_id || '',
      product_title: record.product_title || '',
      item_number: null,
      condition: record.condition || '',
      shipping_tracking_number: record.shipping_tracking_number || '',
      tracking_numbers: record.tracking_numbers || [],
      tracking_number_rows: record.tracking_number_rows || [],
      serial_number: '',
      sku: record.sku || '',
      tester_id: null,
      tested_by: null,
      test_date_time: null,
      packer_id: record.packed_by || null,
      packed_by: record.packed_by || null,
      packed_at: record.created_at || null,
      packer_photos_url: record.packer_photos_url || [],
      tracking_type: record.tracking_type || null,
      account_source: record.account_source || null,
      notes: '',
      status_history: [],
      is_shipped: undefined,
      created_at: record.created_at || null,
      quantity: record.quantity || '1',
      packer_log_id: record.packer_log_id ?? null,
      station_activity_log_id: record.id,
      fnsku:
        record.fnsku ||
        (String(record.tracking_type || '').toUpperCase() === 'FNSKU'
          ? String(record.scan_ref || '').trim() || null
          : null),
      fnsku_log_id: record.fnsku_log_id ?? null,
    };
  };

  const getDetailId = (record: PackerRecord) => Number(toDetailRecord(record).id);

  const openDetails = (record: PackerRecord) => {
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

    window.addEventListener('navigate-shipped-details' as keyof WindowEventMap, handleNavigateDetails as EventListener);
    return () => {
      window.removeEventListener('navigate-shipped-details' as keyof WindowEventMap, handleNavigateDetails as EventListener);
    };
  }, [orderedRecords, selectedDetailId]);

  const getWeekCount = () =>
    Object.values(filteredGroupedRecords).reduce((sum, recs) => sum + recs.length, 0);

  if (loading) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden bg-gray-50">
        <div className="flex h-10 items-center border-b border-gray-100 bg-white px-4">
          <div className="h-4 w-32 animate-pulse rounded bg-gray-100" />
        </div>
        <div className="no-scrollbar flex-1 overflow-y-auto">
          <SkeletonList count={12} />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full bg-white">
      {isRefreshing && (
        <div className="absolute right-2 top-2 z-30">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" />
        </div>
      )}
      <div className="flex flex-1 flex-col overflow-hidden">
        <WeekHeader
          stickyDate={stickyDate}
          fallbackDate={formatHeaderDate()}
          count={currentCount || getWeekCount()}
          weekRange={weekRange}
          weekOffset={weekOffset}
          onPrevWeek={() => setWeekOffset(weekOffset + 1)}
          onNextWeek={() => setWeekOffset(Math.max(0, weekOffset - 1))}
        />
        <div ref={scrollRef} className="no-scrollbar w-full flex-1 overflow-x-auto overflow-y-auto">
          {Object.keys(filteredGroupedRecords).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-40 text-center">
              <p className="font-medium italic text-gray-500 opacity-20">No packer records found</p>
            </div>
          ) : (
            <div className="flex w-full flex-col">
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
                        const rowIsFba = isFbaPackerRecord(record);
                        const fnskuValue = String(record.scan_ref || '').trim();
                        const showFnskuChip = rowIsFba && Boolean(fnskuValue);
                        const dotType = getSourceDotType({
                          orderId: record.order_id,
                          accountSource: record.account_source,
                          trackingType: record.tracking_type,
                          scanRef: record.scan_ref,
                        });
                        const hideOrderIdChip = isSkuSourceRecord({
                          orderId: record.order_id,
                          accountSource: record.account_source,
                          trackingType: record.tracking_type,
                          scanRef: record.scan_ref,
                        });
                        return (
                          <motion.div
                            key={
                              record.id != null
                                ? `pkr-${record.id}`
                                : `pkr-${date}-${index}-${record.shipping_tracking_number || record.scan_ref || record.order_id || 'row'}`
                            }
                            {...framerPresence.tableRow}
                            transition={framerTransition.tableRowMount}
                            whileHover={{ x: 2 }}
                            whileTap={{ scale: 0.998 }}
                            onClick={() => openDetails(record)}
                            className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-gray-300 px-3 py-1.5 transition-all hover:bg-blue-50/40 ${
                              index % 2 === 0 ? 'bg-white' : 'bg-gray-50/10'
                            }`}
                          >
                            <div className="flex min-w-0 flex-col">
                              <RowTitle
                                dot={SOURCE_DOT_BG[dotType]}
                                dotTitle={SOURCE_DOT_LABEL[dotType]}
                                title={
                                  record.product_title ||
                                  record.item_number ||
                                  record.sku ||
                                  'Unknown Product'
                                }
                              />
                              <RowMetaColumns
                                qty={
                                  <span className={(parseInt(String(record.quantity || '1'), 10) || 1) > 1 ? 'text-yellow-600' : undefined}>
                                    {parseInt(String(record.quantity || '1'), 10) || 1}
                                  </span>
                                }
                                condition={displayValues.condition || 'No Condition'}
                              />
                            </div>
                            {(() => {
                              // Fixed-column chip grid (platform / order-id /
                              // tracking) matching the shipped + tech tables.
                              // No serial column on packer rows; FBA rows take
                              // the tracking column for their FNSKU.
                              if (showFnskuChip) {
                                const fnskuColumns: ChipColumn[] = [
                                  { key: 'platform', width: CHIP_COL.platform, node: null },
                                  { key: 'orderid', width: CHIP_COL.id, node: null },
                                  { key: 'tracking', width: CHIP_COL.tracking, node: <FnskuChip value={fnskuValue} /> },
                                ];
                                return <ChipColumns columns={fnskuColumns} />;
                              }
                              const plat = getOrderPlatformLabel(record.order_id || '', record.account_source);
                              const scanForSku = String(record.scan_ref || record.shipping_tracking_number || '');
                              const productUrl = getExternalUrlByItemNumber(
                                String(record.item_number || '').trim() || skuScanPrefixBeforeColon(scanForSku),
                              );
                              const columns: ChipColumn[] = [
                                {
                                  key: 'platform',
                                  width: CHIP_COL.platform,
                                  node: plat ? (
                                    <PlatformChip
                                      label={plat}
                                      underlineClass={getOrderPlatformBorderColor(plat)}
                                      iconClass={productUrl ? getOrderPlatformColor(plat) : 'text-gray-500'}
                                      onClick={() => {
                                        if (productUrl) window.open(productUrl, '_blank', 'noopener,noreferrer');
                                      }}
                                    />
                                  ) : null,
                                },
                                {
                                  key: 'orderid',
                                  width: CHIP_COL.id,
                                  node: hideOrderIdChip ? (
                                    <OrderIdChipPlaceholder />
                                  ) : (
                                    <OrderIdChip value={record.order_id || ''} display={getLast4(record.order_id)} />
                                  ),
                                },
                                { key: 'tracking', width: CHIP_COL.tracking, node: <TrackingOrSkuScanChip value={record.shipping_tracking_number || ''} /> },
                              ];
                              return <ChipColumns columns={columns} />;
                            })()}
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
