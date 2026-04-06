import { useCallback } from 'react';
import type { StationScanType } from '@/lib/station-scan-routing';
import { looksLikeFnsku } from '@/lib/scan-resolver';
import { formatPSTTimestamp } from '@/utils/date';
import type { WizardAction, OrderVariant } from './packingWizardReducer';

interface UseMobilePackingLookupOptions {
  userId: string;
  userName: string;
  normalizeTracking: (value: string) => string;
  dispatch: React.Dispatch<WizardAction>;
}

/**
 * Encapsulates the scan → API lookup → dispatch flow for mobile packing.
 * Returns `handleLookup` which resolves a barcode/tracking value into
 * an order, FBA item, or exception via the appropriate API.
 */
export function useMobilePackingLookup({
  userId,
  userName,
  normalizeTracking,
  dispatch,
}: UseMobilePackingLookupOptions) {
  const handleLookup = useCallback(async (scanValue: string, scanType: StationScanType) => {
    dispatch({ type: 'SCAN_CONFIRMED', value: scanValue, scanType });

    try {
      // ── FBA path: FNSKU detected ──
      if (scanType === 'FNSKU' || looksLikeFnsku(scanValue)) {
        const res = await fetch('/api/fba/items/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fnsku: scanValue, staff_id: Number(userId), station: 'PACK_STATION' }),
        });
        const data = await res.json();

        if (!res.ok) {
          dispatch({ type: 'LOOKUP_ERROR', message: data?.error || 'FBA scan failed' });
          return;
        }

        dispatch({
          type: 'LOOKUP_FBA_FOUND',
          fba: {
            fnsku: data.fnsku,
            productTitle: data.product_title || scanValue,
            shipmentRef: data.shipment_ref || null,
            plannedQty: Number(data.planned_qty ?? data.expected_qty ?? 0),
            combinedPackScannedQty: Number(data.combined_pack_scanned_qty ?? data.actual_qty ?? 0),
            isNew: !!data.is_new || !!data.auto_added_to_plan,
          },
          packerLogId: data.packerLogId ?? data.packer_log_id ?? null,
        });
        return;
      }

      // ── Regular packing path ──
      const isTrackingInput = !scanValue.includes(':') && !/^(clean|fba-)/i.test(scanValue);
      const normalizedScan = isTrackingInput ? normalizeTracking(scanValue) : scanValue;

      const res = await fetch('/api/packing-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackingNumber: normalizedScan,
          photos: [],
          packerId: String(userId),
          packerName: userName,
          createdAt: formatPSTTimestamp(),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        dispatch({ type: 'LOOKUP_ERROR', message: data?.error || 'Failed to save packing scan' });
        return;
      }

      const resolvedScanType = String(data?.trackingType || '').trim() || 'ORDERS';
      const packerLogId = data.packerRecord?.id ?? null;

      // Dispatch events for the packer table
      if (packerLogId) {
        window.dispatchEvent(new CustomEvent('packer-log-added', { detail: data.packerRecord }));
      }

      if (resolvedScanType === 'FBA' && data?.fba) {
        dispatch({
          type: 'LOOKUP_FBA_FOUND',
          fba: {
            fnsku: String(data.fba.fnskus || '').split(',')[0]?.trim() || '',
            productTitle: String(data?.productTitle || '').trim() || 'FBA Shipment',
            shipmentRef: data.fba.shipment_ref || null,
            plannedQty: Number(data.fba.total_qty ?? 0),
            combinedPackScannedQty: Number(data.fba.total_qty ?? 0),
            isNew: false,
          },
          packerLogId,
        });
      } else if (data?.orderFound === false || data?.isException) {
        // Exception path — no matching order found
        dispatch({
          type: 'LOOKUP_EXCEPTION',
          order: {
            orderId: String(data?.orderId || '').trim(),
            productTitle: String(data?.productTitle || '').trim() || 'Unknown — Exception',
            qty: 1,
            condition: 'N/A',
            tracking: String(data?.shippingTrackingNumber || scanValue).trim(),
            sku: data?.sku || '',
            itemNumber: data?.itemNumber || '',
            shipByDate: data?.shipByDate || '',
            createdAt: data?.createdAt || '',
          },
          packerLogId,
        });
      } else {
        // Standard order found
        const variant: OrderVariant =
          /^RS-/i.test(String(data?.orderId || '')) ? 'repair' : 'order';
        dispatch({
          type: 'LOOKUP_ORDER_FOUND',
          order: {
            orderId: String(data?.orderId || '').trim(),
            productTitle: String(data?.productTitle || '').trim() || 'Unknown product',
            qty: Math.max(1, Number(data?.qty ?? data?.quantity ?? data?.orderQty ?? 1) || 1),
            condition: String(data?.condition || '').trim() || 'N/A',
            tracking: String(data?.shippingTrackingNumber || scanValue).trim(),
            sku: String(data?.sku || '').trim(),
            itemNumber: String(data?.itemNumber || '').trim(),
            shipByDate: data?.shipByDate || '',
            createdAt: data?.createdAt || '',
          },
          packerLogId,
          resolvedScanType,
          variant,
        });
      }
    } catch (err: any) {
      dispatch({ type: 'LOOKUP_ERROR', message: err?.message || 'Scan failed' });
    }
  }, [userId, userName, normalizeTracking, dispatch]);

  return { handleLookup };
}
