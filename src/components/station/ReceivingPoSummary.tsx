'use client';

/**
 * Collapsed-PO summary — the header content for a CollapsibleGroupRow wrapping
 * several receiving lines that share a purchase order. Built from the SAME
 * RowTitle / RowMetaColumns / ChipColumns primitives a single line row uses so
 * it lines up pixel-for-pixel with its children.
 *
 * The title is the shared identity — {platform · PO} — rather than one product
 * name, since the lines are different products. On the chip side, PO and (when
 * uniform) tracking sit in their real columns; the SKU and serial columns DIFFER
 * per line, so each shows its own icon with a yellow "×N" count (SkuCountChip /
 * SerialCountChip) — a "these vary, expand to see them" cue that still keeps
 * every column aligned with the rows beneath it. Extracted from
 * ReceivingLinesTable unchanged.
 */

import {
  conditionGradeTableLabel,
  workflowStatusTableLabel,
  getStatusDotBg,
  getWorkflowIconMeta,
  shouldShowWorkflowStatusIcon,
} from '@/components/station/receiving-constants';
import {
  OrderIdChip,
  TrackingChip,
  SerialChip,
  SkuCountChip,
  SerialCountChip,
  getLast4,
} from '@/components/ui/CopyChip';
import { ChipColumns, CHIP_COL, type ChipColumn } from '@/components/ui/ChipColumns';
import { usePlatformMeta } from '@/hooks/useCatalog';
import { RowTitle, RowMetaColumns, META_COL } from '@/components/ui/RowMetaColumns';
import { DeliveryStateIcon } from '@/components/station/ReceivingDeliveryStateIcon';
import { IconWithTooltip } from '@/components/ui/IconWithTooltip';
import {
  dashboardOrderRowChipsClass,
  dashboardOrderRowShellClass,
} from '@/lib/dashboard-order-row-layout';
import { IncomingAttachTrackingButton } from '@/components/station/IncomingAttachTrackingButton';
import type { ReceivingLineRow } from './receiving-line-row';

export function ReceivingPoSummary({
  rows,
  isMobile,
  isIncoming,
  isHistory = false,
}: {
  rows: ReceivingLineRow[];
  isMobile: boolean;
  isIncoming: boolean;
  isHistory?: boolean;
}) {
  const first = rows[0];
  const resolvePlatformMeta = usePlatformMeta();

  const received = rows.reduce((sum, r) => sum + (r.quantity_received || 0), 0);
  const expected = rows.reduce((sum, r) => sum + (r.quantity_expected ?? 0), 0);
  const quantityText = `${received}/${expected || '?'}`;
  const complete = expected > 0 && received >= expected;

  const grades = new Set(
    rows.map((r) => (r.condition_grade || '').toUpperCase()).filter(Boolean),
  );
  const conditionLabel =
    grades.size === 1 ? conditionGradeTableLabel([...grades][0]) : 'MIXED';

  // eBay (and future marketplace) buyer purchases carry their identity on the
  // inbound spine cache, not the Zoho columns: source is `inbound_source_type`
  // and the order id is `source_order_id`. Fall back to those so a marketplace
  // Incoming row reads "eBay · USAV-Buyer · Order 12-3456" with a real order-id
  // chip, not a blank PO. See docs/incoming-universal-purchase-orders-plan.md §6.3.
  const inboundSource = (first?.inbound_source_type || '').trim().toLowerCase();
  const isMarketplacePurchase = inboundSource !== '' && inboundSource !== 'zoho';
  const poValue = (
    first?.zoho_purchaseorder_number ||
    first?.zoho_purchaseorder_id ||
    (isMarketplacePurchase ? first?.source_order_id : '') ||
    ''
  ).trim();
  // A real Zoho PO reads "PO"; a marketplace purchase with no Zoho PO yet reads "Order".
  const idPrefix = !first?.zoho_purchaseorder_id && isMarketplacePurchase ? 'Order' : 'PO';

  // Title = the group's shared identity: platform · buyer account · PO/Order.
  // Falls back gracefully when parts are missing (un-platformed Zoho carton →
  // just "PO 3715"); the buyer-account chip only shows for marketplace purchases.
  const platformRaw = (first?.source_platform || inboundSource || '').trim().toLowerCase();
  const platformLabel = platformRaw ? resolvePlatformMeta(platformRaw).label : '';
  const accountLabel = (first?.platform_account_label || '').trim();
  const title =
    [platformLabel, accountLabel, poValue ? `${idPrefix} ${poValue}` : '']
      .filter(Boolean)
      .join(' · ') || (first?.item_name ?? 'Grouped lines');

  // Only surface tracking when every line shares one carton; otherwise leave the
  // column empty so the summary never implies a single tracking# for a split PO.
  const trackings = new Set(
    rows.map((r) => (r.tracking_number || '').trim()).filter(Boolean),
  );
  const trackingValue = trackings.size === 1 ? [...trackings][0] : '';

  // The differing columns carry a yellow "×N" count instead of a value. SKU is
  // one-per-line, so its count is the line count.
  const skuCount = rows.length;
  // Serials collapse with the standard 0 / 1 / N rule: none → empty column, a
  // single serial across the whole group → show that real SerialChip, several →
  // the "×N" count. (Same rule the FBA summary will apply to FNSKUs.)
  const allSerials = rows.flatMap((r) =>
    (r.serials ?? []).map((s) => (s.serial_number || '').trim()).filter(Boolean),
  );
  const serialNode =
    allSerials.length === 1 ? (
      <SerialChip value={allSerials[0]} width="w-fit max-w-full" />
    ) : allSerials.length > 1 ? (
      <SerialCountChip count={allSerials.length} />
    ) : null;

  // Status dot + status icons mirror the per-line row, so the collapsed summary
  // carries the same signal its children do instead of a bare gray dot. The
  // workflow status / delivery state are folded up only when uniform across the
  // group; mixed groups fall back to no icon (expand to see the per-line state).
  const workflowStatuses = new Set(
    rows.map((r) => (r.workflow_status || 'EXPECTED').toUpperCase()),
  );
  const uniformWorkflowStatus =
    workflowStatuses.size === 1 ? [...workflowStatuses][0] : null;
  const workflowLabel = workflowStatusTableLabel(uniformWorkflowStatus || 'EXPECTED');
  const { Icon: WorkflowIcon, tone: workflowIconTone } = getWorkflowIconMeta(workflowLabel);

  const deliveryStates = new Set(
    rows.map((r) => r.delivery_state).filter(Boolean) as string[],
  );
  const uniformDeliveryState =
    deliveryStates.size === 1 ? [...deliveryStates][0] : null;

  // Mirror the per-line ChipColumns grid exactly, column-for-column.
  const columns: ChipColumn[] = [
    { key: 'po', width: CHIP_COL.id, node: <OrderIdChip value={poValue} display={getLast4(poValue)} /> },
    { key: 'sku', width: CHIP_COL.id, node: <SkuCountChip count={skuCount} /> },
    {
      key: 'tracking',
      width: CHIP_COL.tracking,
      // Incoming AWAITING_TRACKING with no carton-wide tracking → the empty
      // tracking slot hosts the "Add tracking" trigger, pre-targeted to this PO.
      node: trackingValue
        ? <TrackingChip value={trackingValue} display={getLast4(trackingValue)} />
        : isIncoming && uniformDeliveryState === 'AWAITING_TRACKING' && (first?.zoho_purchaseorder_id || '').trim()
          ? (
            <IncomingAttachTrackingButton
              poId={(first!.zoho_purchaseorder_id || '').trim()}
              poNumber={first?.zoho_purchaseorder_number ?? null}
            />
          )
          : null,
    },
  ];
  if (!isIncoming) {
    columns.push({ key: 'serial', width: CHIP_COL.serial, node: serialNode });
  }

  return (
    <div className={dashboardOrderRowShellClass(isMobile)}>
      <div className="flex min-w-0 flex-col">
        <RowTitle
          // History reads uniformly "received"; otherwise derive the dot from
          // the (uniform) workflow status + qty so it matches the child rows
          // instead of always rendering gray.
          dot={isHistory ? 'bg-emerald-500' : getStatusDotBg(uniformWorkflowStatus, received, expected)}
          dotTitle={isHistory ? 'Received' : `${rows.length} lines`}
          dotTrack={META_COL.dotTrackWide}
          title={title}
        />
        <RowMetaColumns
          indent={META_COL.indentWide}
          qtyCol={META_COL.qtyColWide}
          qty={
            <span className={complete ? 'text-emerald-600' : 'text-yellow-600'}>
              {quantityText}
            </span>
          }
          condition={<span className="text-text-faint">{conditionLabel}</span>}
          rest={
            <div className="flex items-center gap-2">
              {shouldShowWorkflowStatusIcon({ isHistory, isIncoming }) ? (
                <IconWithTooltip
                  Icon={WorkflowIcon}
                  label={workflowLabel}
                  iconClassName={workflowIconTone}
                />
              ) : null}
              <DeliveryStateIcon state={uniformDeliveryState} />
            </div>
          }
        />
      </div>
      {isMobile ? (
        <div className={dashboardOrderRowChipsClass(true)}>
          <OrderIdChip value={poValue} display={getLast4(poValue)} dense />
          <SkuCountChip count={skuCount} dense />
          {trackingValue ? <TrackingChip value={trackingValue} display={getLast4(trackingValue)} dense /> : null}
          {allSerials.length === 1 ? (
            <SerialChip value={allSerials[0]} width="w-fit max-w-full" dense />
          ) : allSerials.length > 1 ? (
            <SerialCountChip count={allSerials.length} dense />
          ) : null}
        </div>
      ) : (
        <ChipColumns columns={columns} />
      )}
    </div>
  );
}
