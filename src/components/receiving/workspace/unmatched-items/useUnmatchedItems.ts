'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '@/lib/toast';
import type { EcwidProductPopoverMode } from '@/components/receiving/unfound/EcwidProductSearchPopover';
import type { AssignedBox } from '@/components/receiving/workspace/CartonAddPopover';
import type {
  SerialMatchedOrder,
  SerialMatchUnit,
} from '@/components/receiving/workspace/SerialMatchResult';
import {
  inferPlatformFromOrderId,
  type CartonResponse,
  type UnfoundLine,
  type UnmatchedItemsSectionProps,
} from './unmatched-items-shared';

/**
 * Owns an unmatched (no-Zoho-PO) carton's items section: fetching the carton's
 * receiving_lines, the carton-level return-serial scan (lookup → create+populate
 * line → bind order# → flip off the Unfound queue), the unified add-line path
 * (catalog/web/repair-service), optimistic line removal, per-line condition
 * updates, and the add/repair popover + assigned-box state. Returns a controller
 * bag the thin section shell renders from.
 */
export function useUnmatchedItems({
  receivingId,
  staffId,
  sourcePlatformHint,
  receivingTypeHint = 'PO',
  listingUrlHint,
  onActiveConditionChange,
}: UnmatchedItemsSectionProps) {
  const [lines, setLines] = useState<UnfoundLine[]>([]);
  /** null = closed; 'repair_service' = the Link-repair-service Ecwid popover. */
  const [popoverMode, setPopoverMode] = useState<EcwidProductPopoverMode | null>(null);
  /** Unified add popover (Item · Web · Box). */
  const [addOpen, setAddOpen] = useState(false);
  /** Box this carton's units last landed in — shows as a chip in the header. */
  const [assignedBox, setAssignedBox] = useState<AssignedBox | null>(null);

  // Carton-level serial matcher. An unfound carton has no lines until something
  // is added, so this lets the operator scan a serial directly: on a
  // shipped-serial match we create a line populated from the matched sales order
  // (title + sku, classified intake_type='return') and attach the serial — no
  // manual Add-item step. No match band is rendered — the import IS the result
  // (the line row appears below, the carton binds the order #); while it runs
  // the card shows an inline importing loader.
  const [returnScanBusy, setReturnScanBusy] = useState(false);
  // Condition for the carton-level serial scan, shown via the same ConditionPills
  // a regular unbox serial card uses. Applied to the line the scan creates.
  const [cartonScanCondition, setCartonScanCondition] = useState('USED_A');

  const refreshLines = useCallback(async () => {
    try {
      const res = await fetch(`/api/receiving/${receivingId}`, {
        cache: 'no-store',
      });
      const body = (await res.json()) as CartonResponse;
      if (!res.ok || !body.success) {
        throw new Error(body.error ?? `fetch failed (${res.status})`);
      }
      setLines(body.lines ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load lines');
    }
  }, [receivingId]);

  useEffect(() => {
    void refreshLines();
  }, [onActiveConditionChange, refreshLines]);

  // Serial-unit ids across the carton's lines — the atoms the Box tab groups.
  const cartonUnitIds = useMemo(
    () => lines.flatMap((l) => (l.serials ?? []).map((s) => s.id)),
    [lines],
  );

  // Scan a returned serial against the whole carton. Looks the serial up; on a
  // shipped match it creates a return line populated from the matched order and
  // attaches the serial, so the receiving record shows the right product +
  // classification with no manual Add-item step.
  const handleReturnSerialScan = useCallback(
    async (rawSerial: string) => {
      const serial = rawSerial.trim();
      if (!serial || returnScanBusy) return;
      setReturnScanBusy(true);
      try {
        const res = await fetch(
          `/api/serial-units/lookup?serial=${encodeURIComponent(serial)}`,
          { cache: 'no-store' },
        );
        const data = await res.json().catch(() => null);
        const found = !!data?.found;
        const matchedOrder: SerialMatchedOrder | null = data?.matched_order ?? null;
        const unit: SerialMatchUnit | null = data?.unit ?? null;

        if (!found) {
          toast.error('No shipped match for this serial — use Add item to record it manually.');
          return;
        }

        // Create the return line, populated from the matched sales order.
        const itemName = matchedOrder?.product_title || `Returned serial ${serial}`;
        const clientEventId = `unfound-return-${receivingId}-${serial}`;
        const addRes = await fetch('/api/receiving/add-unmatched-line', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': clientEventId },
          body: JSON.stringify({
            receiving_id: receivingId,
            item_name: itemName,
            sku: matchedOrder?.sku || unit?.sku || undefined,
            intake_type: 'return',
            // The grade the operator picked on the scan card — without it the
            // line lands on the server default instead of the selected pill.
            condition_grade: cartonScanCondition || undefined,
            client_event_id: clientEventId,
          }),
        });
        const addBody = await addRes.json().catch(() => ({}));
        if (!addRes.ok || !addBody?.success || !addBody?.line?.id) {
          toast.error(addBody?.error || 'Could not create the return line');
          return;
        }

        // Attach the scanned serial to the new line.
        const scanRes = await fetch('/api/receiving/scan-serial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            receiving_id: receivingId,
            receiving_line_id: addBody.line.id,
            serial_number: serial,
            staff_id: Number(staffId) || undefined,
            condition_grade: cartonScanCondition || undefined,
          }),
        });
        const scanBody = await scanRes.json().catch(() => ({}));
        if (!scanRes.ok || !scanBody?.success) {
          toast.error(scanBody?.error || 'Line created, but the serial scan failed');
        }

        // Graduate the carton off the Unfound queue: bind the matched order #
        // as the PO# and tag the platform inferred from the order-number
        // shape. Same two-PATCH mechanism the repair-service link uses (the
        // PO# write must not roll back if the platform write fails), and the
        // same auto-flip: /api/receiving/[id] turns source 'unmatched' →
        // 'zoho_po' once a PO#/order# is bound.
        const orderNo = (matchedOrder?.order_id || '').trim();
        const platform = orderNo ? inferPlatformFromOrderId(orderNo) : null;
        if (orderNo) {
          let poApplied = false;
          try {
            const r1 = await fetch(`/api/receiving/${receivingId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ zoho_purchaseorder_number: orderNo }),
            });
            poApplied = r1.ok;
          } catch {
            /* non-fatal — carton stays unfound; operator can bind manually */
          }
          if (platform) {
            try {
              await fetch(`/api/receiving/${receivingId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source_platform: platform }),
              });
            } catch {
              /* non-fatal — platform pill stays as-is */
            }
          }
          // Mirror onto every surface holding this carton (workspace header
          // chips, rails, unfound queue) — same events the repair-service
          // link fires.
          window.dispatchEvent(new CustomEvent('usav-refresh-data'));
          window.dispatchEvent(
            new CustomEvent('receiving-package-updated', {
              detail: {
                receiving_id: receivingId,
                ...(platform ? { source_platform: platform } : {}),
                zoho_purchaseorder_number: poApplied ? orderNo : null,
              },
            }),
          );
        }

        await refreshLines();
        toast.success(
          matchedOrder?.product_title
            ? `Matched return: ${matchedOrder.product_title}`
            : 'Return matched',
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Match failed');
      } finally {
        setReturnScanBusy(false);
      }
    },
    [cartonScanCondition, receivingId, refreshLines, returnScanBusy, staffId],
  );

  const handleAddLine = useCallback(
    async (selection: {
      sku_platform_id_row: number | null;
      sku_catalog_id: number | null;
      sku: string;
      item_name: string;
      image_url: string | null;
      is_repair_service?: boolean;
      ecwid_order_id?: string;
      ecwid_product_url?: string | null;
    }) => {
      const clientEventId = `add-line-${receivingId}-${Date.now()}`;
      // For repair-service links we prefer the Ecwid product URL as the
      // line's listing URL so the operator can click straight to the
      // product page. Otherwise fall back to the carton-wide hint.
      const effectiveListingUrl =
        (selection.is_repair_service ? selection.ecwid_product_url : null) ||
        listingUrlHint ||
        undefined;
      // Repair-service lines get source_platform_pill='ecwid' so downstream
      // filters can identify them; ordinary Ecwid picks fall through to
      // whatever pill the operator set on the carton.
      const effectiveSourcePlatformPill = selection.is_repair_service
        ? 'ecwid'
        : sourcePlatformHint || undefined;

      const res = await fetch('/api/receiving/add-unmatched-line', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': clientEventId,
        },
        body: JSON.stringify({
          receiving_id: receivingId,
          ...(selection.sku_platform_id_row != null
            ? { sku_platform_id_row: selection.sku_platform_id_row }
            : {}),
          sku_catalog_id: selection.sku_catalog_id,
          sku: selection.sku || undefined,
          item_name: selection.item_name,
          source_platform_pill: effectiveSourcePlatformPill,
          intake_type: receivingTypeHint.toLowerCase(),
          listing_url: effectiveListingUrl,
          // Per-line source-order linkage — the server persists these on the
          // line (source_order_id / is_repair_service) and re-derives the
          // carton's representative PO# from its lines, so a box can hold
          // returns + repairs from different orders, each acknowledged per line.
          is_repair_service: selection.is_repair_service || undefined,
          ecwid_order_id: selection.ecwid_order_id || undefined,
          client_event_id: clientEventId,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        toast.error(body.error ?? `add line failed (${res.status})`);
        return;
      }
      setLines((prev) => [
        ...prev,
        { ...body.line, image_url: selection.image_url },
      ]);
      setPopoverMode(null);
      setAddOpen(false);

      // The server (add-unmatched-line → recomputeCartonSourceLink) now OWNS the
      // carton's source linkage: a per-line source order flips an unmatched
      // carton to zoho_po (off the Unfound queue) + source_platform='ecwid',
      // with the carton PO# as a first-linked DISPLAY representative. We just
      // mirror the returned carton state into the UI — no client PATCH, so a
      // multi-order box's representative isn't clobbered by the latest add.
      if (selection.is_repair_service || selection.ecwid_order_id) {
        const carton = body.carton as
          | { zoho_purchaseorder_number: string | null; source_platform: string | null }
          | null
          | undefined;
        window.dispatchEvent(new CustomEvent('usav-refresh-data'));
        window.dispatchEvent(
          new CustomEvent('receiving-package-updated', {
            detail: {
              receiving_id: receivingId,
              source_platform: carton?.source_platform ?? 'ecwid',
              zoho_purchaseorder_number: carton?.zoho_purchaseorder_number ?? null,
            },
          }),
        );
        const repId = carton?.zoho_purchaseorder_number || selection.ecwid_order_id;
        toast.success(repId ? `Linked Ecwid order #${repId}` : 'Repair service linked');
      } else {
        toast.success('Item added');
      }
    },
    [listingUrlHint, receivingId, receivingTypeHint, sourcePlatformHint],
  );

  const handleRemoveLine = useCallback(
    async (lineId: number) => {
      if (!window.confirm('Remove this item from the carton?')) return;
      // Optimistic — drop it immediately; restore on failure.
      const prev = lines;
      setLines((xs) => xs.filter((l) => l.id !== lineId));
      try {
        const res = await fetch(
          `/api/receiving-lines?id=${encodeURIComponent(String(lineId))}`,
          { method: 'DELETE' },
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.success) {
          setLines(prev);
          toast.error(body.error ?? `Remove failed (${res.status})`);
          return;
        }
        toast.success('Item removed');
        // Drop the line from the Recent rail immediately (and clear it from the
        // workspace if it was the active line) — the rail otherwise re-pins the
        // selected row from cache until the refetch lands. See SidebarRailShell
        // deleteEvent + ReceivingSidebarPanel.
        window.dispatchEvent(
          new CustomEvent('receiving-line-deleted', { detail: { id: lineId } }),
        );
        // Re-evaluate carton-level state: if the operator just removed the
        // last line, the carton goes back to "unfound" and the queue may
        // want to re-surface it.
        window.dispatchEvent(new CustomEvent('usav-refresh-data'));
      } catch (err) {
        setLines(prev);
        toast.error(err instanceof Error ? err.message : 'Remove failed');
      }
    },
    [lines],
  );

  const handleConditionChange = useCallback(
    async (lineId: number, conditionGrade: string) => {
      setLines((prev) =>
        prev.map((l) =>
          l.id === lineId ? { ...l, condition_grade: conditionGrade } : l,
        ),
      );
      // Surface the grade so the panel's label preview/print tracks it — the
      // matched-carton flow does this through ActiveLineConditionSerial.
      onActiveConditionChange?.(conditionGrade);
      const res = await fetch(`/api/receiving/lines/${lineId}/condition`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ condition_grade: conditionGrade }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        toast.error(body.error ?? 'Update failed');
        await refreshLines();
      }
    },
    [refreshLines],
  );

  return {
    lines,
    popoverMode, setPopoverMode,
    addOpen, setAddOpen,
    assignedBox, setAssignedBox,
    returnScanBusy,
    cartonScanCondition, setCartonScanCondition,
    refreshLines,
    cartonUnitIds,
    handleReturnSerialScan,
    handleAddLine,
    handleRemoveLine,
    handleConditionChange,
  };
}

export type UnmatchedItemsController = ReturnType<typeof useUnmatchedItems>;
