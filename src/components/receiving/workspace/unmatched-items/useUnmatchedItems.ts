'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '@/lib/toast';
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
import { useReceivingCartonUnlink } from './useReceivingCartonUnlink';
import { isSalesOrderDerivedCarton } from '@/lib/receiving/intake-items-routing';
import {
  classificationToColumns,
  columnsToClassification,
  type IntakeClassification,
} from '@/lib/receiving/intake-classification';

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
  onLinked,
  onUnlinked,
  linkedOrderHint,
  activeLineId,
}: UnmatchedItemsSectionProps) {
  const [lines, setLines] = useState<UnfoundLine[]>([]);
  const [cartonHeader, setCartonHeader] = useState(linkedOrderHint ?? null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const { unlinkCarton, unlinking } = useReceivingCartonUnlink();
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

  // Door classification ("Receiving as") for this carton — desktop parity with
  // the mobile /m/receive selector. Seeds from the carton's stored intake
  // columns; saving maps the pick back onto those columns via the SoT.
  const [classification, setClassification] = useState<IntakeClassification>('UNKNOWN');

  const refreshLines = useCallback(async () => {
    // Guard: never hit the API for a non-materialized carton (optimistic open
    // stub id, or no selection). A bad id only ever 404s "Package not found".
    if (!Number.isFinite(receivingId) || receivingId <= 0) {
      setLines([]);
      return;
    }
    try {
      const res = await fetch(`/api/receiving/${receivingId}`, {
        cache: 'no-store',
      });
      const body = (await res.json().catch(() => null)) as CartonResponse | null;
      if (!res.ok || !body?.success) {
        // Carton not visible yet — an optimistic/just-promoted open, a mid-create
        // race, or a stale unfound-queue stub. Degrade silently to an empty card;
        // the reconciling feed refresh re-runs this once the row lands. NEVER
        // toast a raw "Package not found" at the operator (degrade-not-fail).
        setLines([]);
        return;
      }
      setLines(body.lines ?? []);
      if (body.receiving) {
        setCartonHeader({
          source: body.receiving.source ?? null,
          zoho_purchaseorder_id: body.receiving.zoho_purchaseorder_id ?? null,
          zoho_purchaseorder_number: body.receiving.zoho_purchaseorder_number ?? null,
        });
        // intake_type maps onto the SoT's `receiving_type` slot.
        setClassification(
          columnsToClassification({
            is_return: body.receiving.is_return,
            return_platform: body.receiving.return_platform,
            source_platform: body.receiving.source_platform,
            receiving_type: body.receiving.intake_type,
          }),
        );
      }
    } catch {
      // Network/parse failure on a background auto-load — degrade to an empty
      // card, no toast. A real refresh re-runs on the next feed event.
      setLines([]);
    }
  }, [receivingId]);

  // Persist a door-classification pick: map it to the carton columns and PATCH,
  // then broadcast the same `receiving-package-updated` event the platform/type
  // pills fire so the sibling carton-context surfaces stay in sync. intake_type
  // only accepts PO|RETURN|TRADE_IN at the carton level (PICKUP is a carton
  // source, not an intake_type), so it is skipped for LOCAL_PICKUP to avoid a
  // 400 that would roll back the return columns.
  const saveClassification = useCallback(
    async (next: IntakeClassification) => {
      setClassification(next);
      const cols = classificationToColumns(next);
      const intakeType =
        cols.receiving_type && cols.receiving_type !== 'PICKUP' ? cols.receiving_type : null;
      const payload: Record<string, unknown> = {
        is_return: cols.is_return,
        return_platform: cols.return_platform,
        source_platform: cols.source_platform,
        ...(intakeType ? { intake_type: intakeType } : {}),
      };
      try {
        const res = await fetch(`/api/receiving/${receivingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          toast.error(b?.error ?? `Could not set the receiving type (${res.status})`);
          return;
        }
        window.dispatchEvent(new CustomEvent('usav-refresh-data'));
        window.dispatchEvent(
          new CustomEvent('receiving-package-updated', {
            detail: { receiving_id: receivingId, ...payload },
          }),
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not set the receiving type');
      }
    },
    [receivingId],
  );

  useEffect(() => {
    void refreshLines();
  }, [onActiveConditionChange, refreshLines]);

  useEffect(() => {
    if (linkedOrderHint) setCartonHeader(linkedOrderHint);
  }, [
    linkedOrderHint?.source,
    linkedOrderHint?.zoho_purchaseorder_id,
    linkedOrderHint?.zoho_purchaseorder_number,
  ]);

  // Serial-unit ids across the carton's lines — the atoms the Box tab groups.
  const cartonUnitIds = useMemo(
    () => lines.flatMap((l) => (l.serials ?? []).map((s) => s.id)),
    [lines],
  );

  const orderLinked = useMemo(() => {
    if (!cartonHeader) return false;
    if (isSalesOrderDerivedCarton(cartonHeader)) return true;
    const poNum = (cartonHeader.zoho_purchaseorder_number || '').trim();
    return cartonHeader.source === 'zoho_po' && Boolean(poNum);
  }, [cartonHeader]);

  const linkedOrderNumber = (cartonHeader?.zoho_purchaseorder_number || '').trim() || null;

  const showUnlinkPrompt =
    orderLinked && (lines.length === 0 || Boolean(linkError));

  const handleUnlinkOrder = useCallback(
    async () => {
      const ok = await unlinkCarton({
        receivingId,
        lineId: activeLineId,
        onSuccess: () => {
          setLinkError(null);
          setLines([]);
          setCartonHeader({
            source: 'unmatched',
            zoho_purchaseorder_id: null,
            zoho_purchaseorder_number: null,
          });
          onUnlinked?.();
        },
      });
      return ok;
    },
    [activeLineId, onUnlinked, receivingId, unlinkCarton],
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
      setLinkError(null);
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

        const itemName = matchedOrder?.product_title || `Returned serial ${serial}`;
        const clientEventId = `unfound-return-${receivingId}-${serial}`;
        const orderNo = (matchedOrder?.order_id || '').trim();

        const addRes = await fetch('/api/receiving/add-unmatched-line', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': clientEventId },
          body: JSON.stringify({
            receiving_id: receivingId,
            item_name: itemName,
            sku: matchedOrder?.sku || unit?.sku || undefined,
            intake_type: 'return',
            source_order_id: orderNo || undefined,
            // The grade the operator picked on the scan card — without it the
            // line lands on the server default instead of the selected pill.
            condition_grade: cartonScanCondition || undefined,
            client_event_id: clientEventId,
          }),
        });
        const addBody = await addRes.json().catch(() => ({}));
        if (!addRes.ok || !addBody?.success || !addBody?.line?.id) {
          const msg = addBody?.error || 'Could not create the return line';
          setLinkError(msg);
          toast.error(msg);
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

        // Graduate the carton off the Unfound queue: bind the matched order #,
        // classify as RETURN, and tag the platform inferred from the order shape.
        const platform = orderNo ? inferPlatformFromOrderId(orderNo) : null;
        if (orderNo) {
          let poApplied = false;
          try {
            const r1 = await fetch(`/api/receiving/${receivingId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                zoho_purchaseorder_number: orderNo,
                intake_type: 'RETURN',
                is_return: true,
                ...(platform ? { source_platform: platform } : {}),
              }),
            });
            poApplied = r1.ok;
          } catch {
            /* non-fatal — carton stays unfound; operator can bind manually */
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
          // Update the open panel immediately — carton header + the new return
          // line (re-selected off the stub by the host).
          if (poApplied) {
            onLinked?.({
              carton: {
                zoho_purchaseorder_number: orderNo,
                source: 'zoho_po',
                source_platform: platform,
                intake_type: 'RETURN',
              },
              line: addBody.line ?? null,
            });
          }
        }

        await refreshLines();
        window.dispatchEvent(new CustomEvent('usav-refresh-data'));
        if (addBody.line?.id) {
          window.dispatchEvent(
            new CustomEvent('receiving-line-updated', {
              detail: {
                id: addBody.line.id,
                receiving_type: 'RETURN',
                carton_intake_type: 'RETURN',
                receiving_source: orderNo ? 'zoho_po' : undefined,
                zoho_purchaseorder_number: orderNo || null,
                source_platform: platform,
              },
            }),
          );
        }
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
    [cartonScanCondition, onLinked, receivingId, refreshLines, returnScanBusy, staffId],
  );

  const handleAddLine = useCallback(
    async (
      selection: {
        sku_platform_id_row: number | null;
        sku_catalog_id: number | null;
        sku: string;
        item_name: string;
        image_url: string | null;
        is_repair_service?: boolean;
        ecwid_order_id?: string;
        ecwid_product_url?: string | null;
      },
      opts?: { allowOffPo?: boolean },
    ) => {
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
          ...(opts?.allowOffPo ? { allow_off_po: true } : {}),
          // Only send a POSITIVE platform-row id — an Ecwid line with no catalog
          // platform row carries 0, which the server rejects ("must be a positive
          // integer"). Omit it (→ null) instead so the add still succeeds.
          ...(selection.sku_platform_id_row != null && selection.sku_platform_id_row > 0
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
      setAddOpen(false);

      // The server (add-unmatched-line → recomputeCartonSourceLink) now OWNS the
      // carton's source linkage: a per-line source order flips an unmatched
      // carton to zoho_po (off the Unfound queue) + source_platform='ecwid',
      // with the carton PO# as a first-linked DISPLAY representative. We just
      // mirror the returned carton state into the UI — no client PATCH, so a
      // multi-order box's representative isn't clobbered by the latest add.
      if (selection.is_repair_service || selection.ecwid_order_id) {
        const carton = body.carton as
          | { zoho_purchaseorder_number: string | null; source: string | null; source_platform: string | null }
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
        // Update the open LineEditPanel immediately from the server's returned
        // row — carton header + the full new line (so the host can re-select the
        // real line off an unfound stub instead of waiting for the refetch).
        onLinked?.({
          carton: {
            zoho_purchaseorder_number: carton?.zoho_purchaseorder_number ?? repId ?? null,
            source: carton?.source ?? 'zoho_po',
            source_platform: carton?.source_platform ?? 'ecwid',
          },
          line: body.line ?? null,
        });
        toast.success(repId ? `Linked Ecwid order #${repId}` : 'Repair service linked');
      } else {
        const label = selection.item_name || selection.sku || 'item';
        toast.success(
          opts?.allowOffPo ? `Added off-PO · ${label}` : `Acknowledged · ${label}`,
        );
        window.dispatchEvent(new CustomEvent('usav-refresh-data'));
        // Upgrade an unfound stub / refresh the open panel — carton stays unmatched
        // unless the server promoted it (no source_order_id on catalog-only adds).
        onLinked?.({
          carton: {
            zoho_purchaseorder_number:
              (body.carton as { zoho_purchaseorder_number?: string | null } | null)
                ?.zoho_purchaseorder_number ?? null,
            source:
              (body.carton as { source?: string | null } | null)?.source ?? 'unmatched',
            source_platform:
              (body.carton as { source_platform?: string | null } | null)?.source_platform ??
              null,
          },
          line: body.line ?? null,
        });
      }
    },
    [listingUrlHint, onLinked, receivingId, receivingTypeHint, sourcePlatformHint],
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
    addOpen, setAddOpen,
    assignedBox, setAssignedBox,
    returnScanBusy,
    cartonScanCondition, setCartonScanCondition,
    classification, saveClassification,
    refreshLines,
    cartonUnitIds,
    handleReturnSerialScan,
    handleAddLine,
    handleRemoveLine,
    handleConditionChange,
    orderLinked,
    linkedOrderNumber,
    showUnlinkPrompt,
    linkError,
    unlinking,
    handleUnlinkOrder,
  };
}

export type UnmatchedItemsController = ReturnType<typeof useUnmatchedItems>;
