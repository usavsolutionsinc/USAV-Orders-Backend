import { normalizeTrackingNumber } from '@/lib/tracking-format';
import type { ScanHandlerContext } from './types';

interface TrackingCallbacks {
  onTrackingScan?: () => void;
  onTrackingOrderLoaded?: () => void;
}

export async function handleTrackingScan(
  input: string,
  ctx: ScanHandlerContext,
  callbacks: TrackingCallbacks = {},
): Promise<void> {
  const { onTrackingScan, onTrackingOrderLoaded } = callbacks;

  if (onTrackingScan) onTrackingScan();
  ctx.setIsLoading(true);

  try {
    const normalizedInput = normalizeTrackingNumber(input);
    const res = await fetch('/api/tech/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'TRACKING',
        value: normalizedInput,
        techId: ctx.userId,
        idempotencyKey: ctx.newIdempotencyKey(),
      }),
    });
    const data = await res.json();

    if (!res.ok || !data.found) {
      const msg = data?.error
        ? `Scan error: ${data.error}`
        : 'Tracking number not found — logged to exceptions queue.';
      ctx.setErrorMessage(msg);
      ctx.syncActiveOrderState(null);
      ctx.clearManuals();
      return;
    }

    const trackingMicrocopy =
      data.orderFound === false && !data.fnskuLogId
        ? (data.warning || 'Order not in system — tracking logged for reconciliation.')
        : null;

    ctx.syncActiveOrderState({
      id: data.order.id,
      orderId: data.order.orderId,
      salId: data.salId ?? null,
      productTitle: data.order.productTitle,
      itemNumber: data.order.itemNumber ?? null,
      sku: data.order.sku,
      condition: data.order.condition,
      notes: data.order.notes,
      tracking: data.order.tracking,
      serialNumbers: data.order.serialNumbers || [],
      scannedSkuCodes: Array.isArray(data.order.scannedSkuCodes) ? data.order.scannedSkuCodes : [],
      testDateTime: data.order.testDateTime,
      testedBy: data.order.testedBy,
      quantity: parseInt(String(data.order.quantity || 1), 10) || 1,
      shipByDate: data.order.shipByDate || null,
      createdAt: data.order.createdAt || null,
      orderFound: data.orderFound !== false,
      scanSessionId: typeof data.scanSessionId === 'string' ? data.scanSessionId : null,
      inlineMicrocopy: trackingMicrocopy,
    });

    const serialCount = data.order.serialNumbers?.length || 0;
    ctx.setSuccessMessage(
      serialCount > 0
        ? `Order loaded: ${serialCount} serial${serialCount !== 1 ? 's' : ''} already scanned`
        : 'Order loaded - ready to scan serials',
    );

    if (data.orderFound === false) {
      ctx.clearManuals();
    } else {
      void ctx.resolveManual(data.order.sku, data.order.itemNumber ?? null);
    }

    onTrackingOrderLoaded?.();

    // Surgical cache insert — avoids full invalidation for same-tab scans.
    if (data.techSerialId) {
      window.dispatchEvent(new CustomEvent('tech-log-added', {
        detail: {
          id: data.techSerialId,
          order_db_id: data.order.id ?? null,
          shipment_id: data.order.shipmentId ?? null,
          created_at: data.order.testDateTime ?? null,
          shipping_tracking_number: data.order.tracking ?? '',
          serial_number: '',
          tested_by: data.order.testedBy ?? null,
          order_id: data.order.orderId !== 'N/A' ? data.order.orderId : null,
          product_title: data.order.productTitle ?? null,
          item_number: data.order.itemNumber ?? null,
          sku: data.order.sku !== 'N/A' ? data.order.sku : null,
          condition: data.order.condition !== 'N/A' ? data.order.condition : null,
          status: data.order.status ?? null,
          status_history: data.order.statusHistory ?? [],
          notes: data.order.notes ?? null,
          account_source: data.order.accountSource ?? null,
          quantity: String(data.order.quantity || '1'),
          is_shipped: data.order.isShipped ?? false,
          ship_by_date: data.order.shipByDate ?? null,
          out_of_stock: null,
        },
      }));
    } else if (data.techActivityId) {
      // Exception scan (no order found): SAL row id maps to the negative id format.
      window.dispatchEvent(new CustomEvent('tech-log-added', {
        detail: {
          id: -1000000000 - data.techActivityId,
          source_row_id: data.techActivityId,
          source_kind: 'tech_scan',
          tech_serial_id: null,
          created_at: data.order.testDateTime ?? null,
          shipping_tracking_number: data.order.tracking ?? '',
          serial_number: '',
          tested_by: data.order.testedBy ?? null,
          shipment_id: null,
          order_db_id: null,
          order_id: null,
          product_title: 'Unknown Product',
          item_number: null,
          sku: null,
          condition: null,
          status: null,
          status_history: [],
          notes: 'Tracking recorded in orders_exceptions',
          account_source: null,
          quantity: '1',
          is_shipped: false,
          ship_by_date: null,
          out_of_stock: null,
        },
      }));
    }

    ctx.triggerGlobalRefresh();
  } catch (err) {
    console.error('Tracking scan failed:', err);
    ctx.setErrorMessage('Failed to load order. Please try again.');
  } finally {
    ctx.setIsLoading(false);
    ctx.setInputValue('');
    ctx.inputRef.current?.focus();
  }
}
