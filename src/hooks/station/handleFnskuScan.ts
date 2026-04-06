import type { ScanHandlerContext } from './types';
import { FBA_FNSKU_STATION_SCANNED } from '@/lib/fba/events';

interface FnskuCallbacks {
  onFnskuOrderLoaded?: (() => void) | null;
}

export async function handleFnskuScan(
  fnskuInput: string,
  ctx: ScanHandlerContext,
  callbacks: FnskuCallbacks = {},
): Promise<void> {
  ctx.setIsLoading(true);
  try {
    const fnsku = fnskuInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const res = await fetch('/api/tech/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'FNSKU', value: fnsku, techId: ctx.userId }),
    });
    const data = await res.json();

    if (!data.found) {
      ctx.setErrorMessage(data.error || 'FNSKU not found');
      ctx.syncActiveOrderState(null);
      ctx.clearManuals();
      return;
    }

    ctx.syncActiveOrderState({
      id: data.order.id ?? null,
      orderId: data.order.orderId ?? 'FNSKU',
      fnsku,
      fnskuLogId: data.fnskuLogId ?? null,
      salId: data.salId ?? null,
      productTitle: data.order.productTitle ?? data.order.tracking ?? fnsku,
      itemNumber: data.order.itemNumber ?? null,
      sku: data.order.sku ?? 'N/A',
      condition: data.order.condition ?? 'N/A',
      notes: data.order.notes ?? '',
      tracking: data.order.tracking ?? fnsku,
      serialNumbers: data.order.serialNumbers || [],
      scannedSkuCodes: Array.isArray(data.order.scannedSkuCodes) ? data.order.scannedSkuCodes : [],
      testDateTime: data.order.testDateTime,
      testedBy: data.order.testedBy,
      quantity: parseInt(String(data.order.quantity || 1), 10) || 1,
      shipByDate: data.order.shipByDate || null,
      createdAt: data.order.createdAt || null,
      orderFound: data.orderFound !== false,
      sourceType: 'fba',
      scanSessionId: data.scanSessionId ?? null,
      inlineMicrocopy: data.catalogMessage ?? null,
    });

    const serialCount = data.order.serialNumbers?.length || 0;
    const techCount = Number(data?.summary?.tech_scanned_qty ?? 0);
    const packCount = Number(data?.summary?.pack_ready_qty ?? 0);
    ctx.setSuccessMessage(
      serialCount > 0
        ? `FNSKU loaded: ${serialCount} serial${serialCount !== 1 ? 's' : ''} on file · tech ${techCount} · ready ${packCount}`
        : `FNSKU loaded - tech ${techCount} · ready ${packCount}`,
    );

    if (data.orderFound === false) {
      ctx.clearManuals();
    } else {
      void ctx.resolveManual(data.order.sku, data.order.itemNumber ?? null);
    }

    callbacks.onFnskuOrderLoaded?.();

    if (data.salId || data.fnskuSalId) {
      const eventSalId = data.salId ?? data.fnskuSalId;
      window.dispatchEvent(new CustomEvent('tech-log-added', {
        detail: {
          id: -1 * Number(eventSalId),
          source_row_id: Number(eventSalId),
          source_kind: 'fba_scan',
          tech_serial_id: null,
          created_at: data.order.testDateTime ?? data.order.createdAt ?? null,
          shipping_tracking_number: data.order.tracking ?? fnsku,
          serial_number: '',
          tested_by: data.order.testedBy ?? (Number.isFinite(Number(ctx.userId)) ? Number(ctx.userId) : null),
          shipment_id: data.shipment?.shipment_id ?? null,
          order_db_id: null,
          order_id: data.order.orderId ?? 'FBA',
          product_title: data.order.productTitle ?? null,
          item_number: data.order.itemNumber ?? null,
          sku: data.order.sku ?? null,
          condition: data.order.condition ?? null,
          fnsku,
          fnsku_log_id: data.fnskuLogId ?? null,
          status: data.order.status ?? null,
          status_history: data.order.statusHistory ?? [],
          notes: data.order.notes ?? null,
          account_source: data.order.accountSource ?? 'fba',
          quantity: String(data.order.quantity || '1'),
          is_shipped: Boolean(data.order.isShipped),
          ship_by_date: data.order.shipByDate ?? null,
          out_of_stock: data.order.outOfStock ?? null,
        },
      }));
    }

    const techLogsTechId = Number(ctx.userId);
    ctx.queryClient.invalidateQueries(
      Number.isFinite(techLogsTechId) && techLogsTechId > 0
        ? { queryKey: ['tech-logs', techLogsTechId] }
        : { queryKey: ['tech-logs'] },
    );

    // Notify FBA workspace sidebar so techs can add this FNSKU to an open plan.
    window.dispatchEvent(new CustomEvent(FBA_FNSKU_STATION_SCANNED, {
      detail: {
        fnsku,
        productTitle: data.order?.productTitle ?? null,
        shipmentId: data.shipment?.shipment_id ?? null,
        planRef: data.shipment?.shipment_ref ?? null,
      },
    }));

    ctx.triggerGlobalRefresh();
  } catch (err) {
    console.error('FNSKU scan failed:', err);
    ctx.setErrorMessage('Failed to load FNSKU. Please try again.');
  } finally {
    ctx.setIsLoading(false);
    ctx.setInputValue('');
    ctx.inputRef.current?.focus();
  }
}
