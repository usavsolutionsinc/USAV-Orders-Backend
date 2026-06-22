'use client';

import { Check } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import {
  FnskuChip,
  OrderIdChip,
  OrderIdChipPlaceholder,
  TrackingOrSkuScanChip,
  SerialChip,
  PlatformChip,
  getLast4,
} from '@/components/ui/CopyChip';
import { ChipColumns, CHIP_COL } from '@/components/ui/ChipColumns';
import { RowTitle, RowMetaColumns, META_COL } from '@/components/ui/RowMetaColumns';
import { CarrierStatusIcon } from '@/components/shipping/ShipmentStatusBadge';
import { getOrderDisplayValues } from '@/utils/order-display';
import { getOrderPlatformLabel, getOrderPlatformColor, getOrderPlatformBorderColor, isFbaOrder } from '@/utils/order-platform';
import { getExternalUrlByItemNumber, skuScanPrefixBeforeColon } from '@/hooks/useExternalItemUrl';
import { isSkuSourceRecord } from '@/utils/source-dot';
import { getStaffName } from '@/utils/staff';
import { StaffInitials } from '@/design-system/components/StaffBadge';
import { OUTBOUND_STATE_META } from '@/lib/outbound-state';
import {
  dashboardOrderRowChipsClass,
  dashboardOrderRowShellClass,
} from '@/lib/dashboard-order-row-layout';
import { isFbaPackerRecord, type DerivedPackerRecord } from '@/lib/shipped-records';

function normalizePersonName(value: unknown): string {
  const text = String(value ?? '').replace(/^tech:\s*/i, '').replace(/^packer:\s*/i, '').trim();
  if (!text || /^(not specified|n\/a|null|undefined|staff\s*#\d+)$/i.test(text)) return '---';
  return text;
}

export interface ShippedRecordRowProps {
  record: DerivedPackerRecord;
  index: number;
  isMobile: boolean;
  selectMode: boolean;
  /** Pre-computed `selectMode && selectedIds.has(id)`. */
  checked: boolean;
  /** Pre-computed `selectedDetailId === detailId` (details-panel highlight). */
  selected: boolean;
  onRowClick: (record: DerivedPackerRecord) => void;
  onToggle: (id: number, shiftKey: boolean) => void;
}

/**
 * One shipped row — chips, platform, outbound-state dot, tech/packer initials,
 * carrier status. Reused by the day-grouped list AND the two scan-out sections
 * so every shipped row renders identically. Extracted from DashboardShippedTable
 * to keep that component composition-only (and to drop its import fan-out).
 */
export function ShippedRecordRow({
  record,
  index,
  isMobile,
  selectMode,
  checked,
  selected,
  onRowClick,
  onToggle,
}: ShippedRecordRowProps) {
  const displayValues = getOrderDisplayValues({ sku: record.sku, condition: record.condition, trackingNumber: record.shipping_tracking_number });
  const rowIsFba = isFbaPackerRecord(record);
  const techStaffId = (record as any).tested_by ?? (record as any).tester_id ?? null;
  const packerStaffId = (record as any).packed_by ?? (record as any).packer_id ?? null;
  const techDisplay = normalizePersonName(String((record as any).tested_by_name || (record as any).tester_name || getStaffName(techStaffId)));
  const packerDisplay = normalizePersonName(String((record as any).packed_by_name || (record as any).packer_name || getStaffName(packerStaffId)));
  const platformLabel = getOrderPlatformLabel(record.order_id || '', record.account_source);
  const orderIsFbaMeta = isFbaOrder(record.order_id, record.account_source);
  const productPageUrl = getExternalUrlByItemNumber(String(record.item_number || '').trim() || skuScanPrefixBeforeColon(String(record.scan_ref || record.shipping_tracking_number || '').trim()));
  const hideOrderIdChip = isSkuSourceRecord({ orderId: record.order_id, accountSource: record.account_source, trackingType: record.tracking_type, scanRef: String(record.scan_ref || record.shipping_tracking_number || '').trim() });

  return (
    <div
      onClick={(e) => (selectMode ? onToggle(Number(record.id), e.shiftKey) : onRowClick(record))}
      // Suppress native text-selection on shift-click so range-select reads cleanly.
      onMouseDown={(e) => { if (selectMode && e.shiftKey) e.preventDefault(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (selectMode) { onToggle(Number(record.id), e.shiftKey); } else { onRowClick(record); } } }}
      role={selectMode ? 'checkbox' : 'button'}
      tabIndex={0}
      aria-checked={selectMode ? checked : undefined}
      aria-pressed={selectMode ? undefined : selected}
      className={`${dashboardOrderRowShellClass(isMobile)} border-b border-gray-100 px-3 py-1.5 transition-colors cursor-pointer hover:bg-blue-50/50 ${
        (selectMode ? checked : selected) ? 'bg-blue-50/80' : index % 2 === 1 ? 'bg-gray-50/40' : 'bg-white'
      }`}
    >
      <div className="flex flex-col min-w-0">
        <RowTitle
          leading={
            selectMode ? (
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                  checked ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white'
                }`}
              >
                {checked && <Check className="h-3 w-3" />}
              </span>
            ) : undefined
          }
          dot={OUTBOUND_STATE_META[record.outboundState].dot}
          dotTitle={`${OUTBOUND_STATE_META[record.outboundState].label} — ${OUTBOUND_STATE_META[record.outboundState].description}`}
          dotTooltip
          title={record.product_title || record.item_number || record.sku || 'Unknown Product'}
        />
        <RowMetaColumns
          indent={selectMode ? `calc(${META_COL.indent} + 1.5rem)` : undefined}
          qty={<span className={(parseInt(String(record.quantity || '1'), 10) || 1) > 1 ? 'text-yellow-600' : 'text-gray-500'}>{parseInt(String(record.quantity || '1'), 10) || 1}</span>}
          condition={<span className={String(displayValues.condition || '').trim().toLowerCase() === 'new' ? 'text-yellow-600' : 'text-gray-400'}>{displayValues.condition || 'N/A'}</span>}
          rest={<div className="flex items-center gap-2">
            {techDisplay !== '---' ? <HoverTooltip label={`Tested by ${techDisplay}`}><StaffInitials staffId={techStaffId} name={techDisplay} /></HoverTooltip> : <StaffInitials staffId={techStaffId} name={techDisplay} />}
            {packerDisplay !== '---' ? <HoverTooltip label={`Packed by ${packerDisplay}`}><StaffInitials staffId={packerStaffId} name={packerDisplay} /></HoverTooltip> : <StaffInitials staffId={packerStaffId} name={packerDisplay} />}
            <CarrierStatusIcon className="ml-1" carrier={record.carrier} category={record.latest_status_category} statusLabel={record.latest_status_label} description={record.latest_status_description} latestEventAt={record.latest_event_at} hasException={record.has_exception} isTerminal={record.is_terminal} />
          </div>}
        />
      </div>
      {(() => {
        const platformNode = !orderIsFbaMeta ? (
          <PlatformChip
            label={platformLabel}
            underlineClass={getOrderPlatformBorderColor(platformLabel)}
            iconClass={platformLabel && productPageUrl ? getOrderPlatformColor(platformLabel) : 'text-gray-500'}
            onClick={() => {
              if (productPageUrl) window.open(productPageUrl, '_blank', 'noopener,noreferrer');
            }}
          />
        ) : null;
        const orderIdNode = hideOrderIdChip ? <OrderIdChipPlaceholder /> : <OrderIdChip value={record.order_id || ''} display={getLast4(record.order_id)} />;
        const serialNode = <SerialChip value={String(record.serial_number || '').trim()} width="w-fit max-w-full" />;
        const columns = rowIsFba
          ? [{ key: 'platform', width: CHIP_COL.platform, node: null }, { key: 'orderid', width: CHIP_COL.id, node: null }, { key: 'tracking', width: CHIP_COL.tracking, node: <FnskuChip value={String(record.scan_ref || '').trim()} /> }, { key: 'serial', width: CHIP_COL.serial, node: serialNode }]
          : [{ key: 'platform', width: CHIP_COL.platform, node: platformNode }, { key: 'orderid', width: CHIP_COL.id, node: orderIdNode }, { key: 'tracking', width: CHIP_COL.tracking, node: <TrackingOrSkuScanChip value={record.shipping_tracking_number || ''} /> }, { key: 'serial', width: CHIP_COL.serial, node: serialNode }];
        return isMobile ? (
          <div className={dashboardOrderRowChipsClass(true)}>{columns.map((c) => c.node && <span key={c.key} className="contents">{c.node}</span>)}</div>
        ) : <ChipColumns columns={columns} />;
      })()}
    </div>
  );
}
