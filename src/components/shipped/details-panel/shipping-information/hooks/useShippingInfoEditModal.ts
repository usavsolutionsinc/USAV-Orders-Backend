import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { normalizeTrackingKey } from '@/lib/tracking-format';
import { normalizeShipByDraft } from '../helpers';
import type { EditableShippingFields, FlatTrackingRow, ShippingInfoEditDraft } from '../types';
import type { useOrderFieldSave } from '@/hooks/useOrderFieldSave';

type OrderFieldSave = ReturnType<typeof useOrderFieldSave>;

interface UseShippingInfoEditModalArgs {
  shipped: ShippedOrder;
  ef: EditableShippingFields;
  allTrackingRows: FlatTrackingRow[];
  serialNumberRows: string[];
  internalFieldSave: OrderFieldSave;
  onUpdate?: () => void;
  setLinkedTrackingDrafts: Dispatch<SetStateAction<Record<string, string>>>;
}

/**
 * Owns the "Edit Order Details" modal: draft state, opening (seeding the draft
 * from the live record) and the multi-step save that fans changes out across
 * the record, tracking sub-resource and serial APIs before busting caches.
 */
export function useShippingInfoEditModal({
  shipped,
  ef,
  allTrackingRows,
  serialNumberRows,
  internalFieldSave,
  onUpdate,
  setLinkedTrackingDrafts,
}: UseShippingInfoEditModalArgs) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);
  const [isSaveSuccess, setIsSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ShippingInfoEditDraft>({
    shipByDate: '',
    orderNumber: '',
    itemNumber: '',
    trackingRows: [],
    serialRows: [],
  });

  const syncOrderExceptions = async () => {
    const res = await fetch('/api/orders-exceptions/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || data?.message || 'Failed to sync orders exceptions');
    }
  };

  const openEditModal = useCallback(() => {
    setDraft({
      shipByDate: normalizeShipByDraft(ef.shipByDate),
      orderNumber: ef.orderNumber,
      itemNumber: ef.itemNumber,
      trackingRows: allTrackingRows.length > 0
        ? allTrackingRows.map((row) => ({ shipmentId: row.shipmentId, tracking: row.tracking }))
        : [{ shipmentId: null, tracking: '' }],
      serialRows: serialNumberRows.length > 0 ? serialNumberRows.map((row) => row.toUpperCase()) : [''],
    });
    setError(null);
    setIsSaveSuccess(false);
    setIsOpen(true);
  }, [allTrackingRows, ef.itemNumber, ef.orderNumber, ef.shipByDate, serialNumberRows]);

  const requestClose = useCallback(() => {
    if (isSaving || isSaveSuccess) return;
    setIsOpen(false);
    setIsSaveSuccess(false);
    setError(null);
  }, [isSaving, isSaveSuccess]);

  const saveSerialRowsFromModal = useCallback(async (serials: string[], trackingOverride?: string) => {
    const trackingNumber = String(trackingOverride || shipped.shipping_tracking_number || '').trim();
    const fnskuLogId = shipped.fnsku_log_id ?? null;
    const salId = shipped.sal_id ?? null;

    if (!trackingNumber && !fnskuLogId && !salId) {
      throw new Error('Tracking number or scan session is required to update serials.');
    }

    const response = salId
      ? await fetch('/api/tech/serial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update',
            salId,
            serials,
            techId: shipped.tested_by ?? shipped.tester_id ?? null,
          }),
        })
      : await fetch('/api/tech/update-serials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tracking: trackingNumber || null,
            serialNumbers: serials,
            techId: shipped.tested_by ?? shipped.tester_id ?? null,
            fnskuLogId,
          }),
        });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success) {
      throw new Error(data?.details || data?.error || 'Failed to update serials');
    }

    queryClient.invalidateQueries({ queryKey: ['tech-logs'] });
  }, [queryClient, shipped.fnsku_log_id, shipped.sal_id, shipped.shipping_tracking_number, shipped.tested_by, shipped.tester_id]);

  const handleModalSave = useCallback(async () => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setIsSaving(true);
    setIsSaveSuccess(false);
    setError(null);
    try {
      const currentOrderId = Number((shipped as any).id);

      // ── 1. Record fields → canonical CRUD ────────────────────────────────
      // itemNumber goes through the canonical PATCH /api/orders/[id]. orderNumber
      // stays on /api/orders/assign because that route owns the cross-order
      // duplicate check (409). shipByDate stays on saveShipByDate (assign) to
      // preserve the work_assignments deadline-promotion behavior. Each field is
      // compared against the live `ef` props directly — no stale ref gates that
      // could silently skip the write.
      const recordPatch: Record<string, unknown> = {};
      if (draft.itemNumber.trim() !== String(ef.itemNumber || '').trim()) {
        recordPatch.itemNumber = draft.itemNumber.trim() || null;
      }
      if (Object.keys(recordPatch).length > 0) {
        const res = await fetch(`/api/orders/${currentOrderId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(recordPatch),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(String(payload?.details || payload?.error || 'Failed to save order fields'));
        }
      }

      if (draft.orderNumber.trim() !== String(ef.orderNumber || '').trim()) {
        const res = await fetch('/api/orders/assign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: currentOrderId, orderNumber: draft.orderNumber.trim() }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(String(payload?.error || payload?.details || 'Failed to save order ID'));
        }
      }

      if (normalizeShipByDraft(draft.shipByDate) !== normalizeShipByDraft(ef.shipByDate)) {
        await internalFieldSave.saveShipByDate(draft.shipByDate);
      }

      // ── 2. Tracking → canonical sub-resource (no brittle client diffing) ──
      //
      // We send desired-state ops whenever the tracking section was *touched*,
      // compared by RAW value (not normalized). Normalized comparison was the
      // cause of the silent no-op: an edit that collapsed to the same key was
      // treated as "no change" and the request was never sent. The server
      // enforces dedup and returns 409, which now surfaces as a visible error
      // instead of being swallowed.
      //
      //   Primary (row 0) → `primaryTrackingNumber` → upsertOrderTracking
      //   Additional (rows 1+) → edits / creates / deletes by shipmentId
      const rowKey = (rows: Array<{ shipmentId: number | null; tracking: string }>) =>
        JSON.stringify(rows.map((r) => [r.shipmentId ?? null, String(r.tracking || '').trim()]));
      const trackingTouched = rowKey(draft.trackingRows) !== rowKey(allTrackingRows);

      const primaryDraftTracking = String(draft.trackingRows[0]?.tracking || '').trim();
      const originalPrimaryTracking = String(allTrackingRows[0]?.tracking || '').trim();
      const primaryTrackingChanged = primaryDraftTracking !== originalPrimaryTracking;

      // Map of original rows by shipmentId, for diffing additional rows.
      const originalById = new Map<number, string>();
      for (const row of allTrackingRows) {
        const sid = Number(row.shipmentId);
        if (Number.isFinite(sid) && sid > 0) {
          originalById.set(sid, String(row.tracking || '').trim());
        }
      }

      const nextSeenIds = new Set<number>();
      const deletes: Array<{ shipmentId: number }> = [];
      const edits: Array<{ shipmentId: number; trackingNumber: string }> = [];
      const creates: Array<{ trackingNumber: string }> = [];

      // Row 0 (primary) is handled via primaryTrackingNumber; reserve its id so
      // the delete loop below doesn't double-remove it.
      const row0Sid = Number(draft.trackingRows[0]?.shipmentId);
      if (Number.isFinite(row0Sid) && row0Sid > 0) {
        nextSeenIds.add(row0Sid);
      }

      // Diff additional rows (index 1+)
      for (let idx = 1; idx < draft.trackingRows.length; idx++) {
        const nextRow = draft.trackingRows[idx];
        const sid = Number(nextRow.shipmentId);
        const nextTracking = String(nextRow.tracking || '').trim();

        if (Number.isFinite(sid) && sid > 0) {
          nextSeenIds.add(sid);
          if (!nextTracking) {
            deletes.push({ shipmentId: sid });
            continue;
          }
          const prev = String(originalById.get(sid) || '').trim();
          if (nextTracking !== prev) {
            edits.push({ shipmentId: sid, trackingNumber: nextTracking });
          }
          continue;
        }

        // New row → create. The server rejects true cross-order duplicates (409).
        if (nextTracking) {
          creates.push({ trackingNumber: nextTracking });
        }
      }

      // Original additional rows that disappeared from the draft → delete
      for (const sid of originalById.keys()) {
        if (!nextSeenIds.has(sid)) {
          deletes.push({ shipmentId: sid });
        }
      }

      // Resolve which shipment should be primary after the save
      const draftRow0 = draft.trackingRows[0];
      const draftRow0Key = normalizeTrackingKey(draftRow0?.tracking);
      const draftRow0ShipmentId = (() => {
        const sid = Number(draftRow0?.shipmentId);
        if (Number.isFinite(sid) && sid > 0) return sid;
        if (!draftRow0Key) return null;
        const match = allTrackingRows.find(
          (r) => r.shipmentId != null && normalizeTrackingKey(r.tracking) === draftRow0Key
        );
        return match ? Number(match.shipmentId) : null;
      })();

      let trackingChanged = false;
      if (trackingTouched) {
        const res = await fetch(`/api/orders/${currentOrderId}/tracking`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(primaryTrackingChanged ? { primaryTrackingNumber: primaryDraftTracking || null } : {}),
            edits,
            creates,
            deletes,
            setPrimaryShipmentId: draftRow0ShipmentId,
          }),
        });

        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(String(payload?.details || payload?.error || 'Failed to update tracking'));
        }

        trackingChanged = true;
      }

      // ── 3. Save serial numbers ────────────────────────────────────────────
      const nextSerialRows = draft.serialRows
        .map((row) => row.trim().toUpperCase())
        .filter(Boolean);
      const currentSerialRows = serialNumberRows.map((row) => row.trim().toUpperCase()).filter(Boolean);
      const firstDraftTracking = draft.trackingRows[0]?.tracking || '';
      if (nextSerialRows.join(', ') !== currentSerialRows.join(', ')) {
        await saveSerialRowsFromModal(nextSerialRows, firstDraftTracking);
      }

      // ── 4. Reflect draft into local component state ───────────────────────
      if (draft.orderNumber !== ef.orderNumber) {
        ef.onOrderNumberChange(draft.orderNumber);
      }
      if (draft.itemNumber !== ef.itemNumber) {
        ef.onItemNumberChange(draft.itemNumber);
      }
      if (firstDraftTracking !== ef.trackingNumber) {
        ef.onTrackingNumberChange(firstDraftTracking);
      }
      if (draft.shipByDate !== ef.shipByDate) {
        ef.onShipByDateChange(draft.shipByDate);
      }

      setLinkedTrackingDrafts(() => {
        const next: Record<string, string> = {};
        draft.trackingRows.forEach((row, index) => {
          const key = `${row.shipmentId ?? 'none'}:${index}`;
          next[key] = row.tracking;
        });
        return next;
      });

      setIsSaveSuccess(true);

      // Bust all cached order views and AWAIT refetch so the parent
      // passes fresh `shipped` data before we close the modal.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
        queryClient.invalidateQueries({ queryKey: ['shipped-table'] }),
        queryClient.invalidateQueries({ queryKey: ['shipped-table-fba'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-table'] }),
      ]);

      onUpdate?.();

      await new Promise((resolve) => window.setTimeout(resolve, 400));

      setIsOpen(false);
      setIsSaveSuccess(false);

      if (trackingChanged) {
        void syncOrderExceptions().catch((error) => {
          console.error('Background orders exception sync failed:', error);
        });
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to save shipping details');
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }, [
    allTrackingRows,
    draft,
    ef,
    internalFieldSave,
    onUpdate,
    queryClient,
    saveSerialRowsFromModal,
    serialNumberRows,
    setLinkedTrackingDrafts,
    shipped,
  ]);

  return {
    isOpen,
    draft,
    setDraft,
    isSaving,
    isSaveSuccess,
    error,
    openEditModal,
    requestClose,
    handleModalSave,
  };
}
