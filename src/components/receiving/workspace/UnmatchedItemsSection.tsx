'use client';

/**
 * Items section for an unmatched (no-Zoho-PO) receiving carton.
 *
 * Mounted by {@link LineEditPanel} where {@link PoLinesAccordion} would
 * sit for a Zoho-matched carton. Owns:
 *   - fetching the carton's existing receiving_lines
 *   - the [+] CTA → CartonAddPopover (Item = zoho_catalog search · Web · Box)
 *   - [Link repair service] → EcwidProductSearchPopover (repair_service / -RS
 *     order picker ONLY; the Ecwid search is not used to add Zoho items here)
 *   - per-line condition pill updates
 *
 * Kept deliberately small so LineEditPanel can drop it in without
 * branching on receiving_source for every prop.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, PackageOpen, Plus, Trash2, Wrench } from '@/components/Icons';
import { toast } from '@/lib/toast';
import { WorkspaceCard } from '@/design-system/components';
import {
  EcwidProductSearchPopover,
  type EcwidProductPopoverMode,
} from '@/components/receiving/unfound/EcwidProductSearchPopover';
import {
  CartonAddPopover,
  type AssignedBox,
} from '@/components/receiving/workspace/CartonAddPopover';
import { HandlingUnitChip } from '@/components/receiving/HandlingUnitChip';
import { SerialCard, SerialChipWithMenu } from '@/components/receiving/workspace/SerialCard';
import {
  SerialMatchResult,
  useSerialLookup,
  type SerialMatchedOrder,
  type SerialMatchUnit,
} from '@/components/receiving/workspace/SerialMatchResult';
import { markConditionSet } from '@/components/receiving/workspace/ReceivingProgressStepper';
import { dispatchLineUpdated } from '@/components/station/ReceivingLinesTable';
import { SkuScanRefChip, getLast4 } from '@/components/ui/CopyChip';
import { ConditionBadge, ProgressBadge } from '@/components/receiving/workspace/PoLinesAccordion';

export interface UnfoundLine {
  id: number;
  sku: string | null;
  item_name: string | null;
  quantity_expected: number | null;
  quantity_received: number | null;
  condition_grade: string;
  workflow_status: string | null;
  listing_reference: string | null;
  location_code: string | null;
  image_url?: string | null;
  /** `/api/receiving/[id]` populates this when the carton has serials saved against any line. */
  serials?: Array<{ id: number; serial_number: string }>;
}

/** Helpers passed to a custom {@link UnmatchedItemsSectionProps.renderLineActions}. */
export interface UnmatchedLineRenderHelpers {
  /** Update condition_grade via /api/receiving/lines/[id]/condition. */
  onConditionChange: (next: string) => void;
  /** Optimistic-set + refresh trigger so the parent can know to refetch. */
  refresh: () => void;
}

export interface UnmatchedItemsSectionProps {
  receivingId: number;
  /** Staff id for serial scans (POST /api/receiving/scan-serial). */
  staffId?: string;
  sourcePlatformHint?: string;
  receivingTypeHint?: string;
  listingUrlHint?: string;
  /**
   * RETURN flow: a per-line serial that matched a shipped order fires this so
   * the parent can pair the order with the carton + open a prefilled claim.
   */
  onFileReturnClaim?: (matchedOrder: SerialMatchedOrder | null, serial: string) => void;
  /**
   * Fired whenever a condition grade is picked on this carton (per-line pill or
   * the carton-level serial-scan card). LineEditPanel mirrors it into the panel
   * `cond` state so the printed/previewed label reflects the operator's last
   * grade — matched cartons report this up via ActiveLineConditionSerial, so
   * without it the label would never update for an unfound carton.
   */
  onActiveConditionChange?: (condition: string) => void;
  /**
   * Optional render override for the per-line action area (replaces the
   * default `ConditionPills` + serial card). Use this from the testing
   * workspace to drop in `TestingStatusPills` + `InlineSerialAdder` per line so
   * an unmatched carton's items can be tested without round-tripping through
   * receiving. When omitted, the section keeps its default receiving behavior.
   */
  renderLineActions?: (line: UnfoundLine, helpers: UnmatchedLineRenderHelpers) => React.ReactNode;
  /** "Scan a serial number" card. Hidden in triage — serials are an unbox step. */
  showSerialScan?: boolean;
  /**
   * Triage only: header CTA that re-opens this carton in unbox mode (deep
   * link `/receiving?recvId=…`). Omitted in the unbox workspace itself.
   */
  onOpenInUnbox?: () => void;
}

interface CartonResponse {
  success: boolean;
  lines?: UnfoundLine[];
  error?: string;
}

/**
 * Infer the sales platform from an order number's shape — Amazon order ids
 * are 3-7-7 digit groups, eBay's are 2-5-5. Anything else returns null (the
 * operator keeps whatever pill they set). Used to tag a return-matched carton
 * without a server round-trip; the order # itself is the authoritative link.
 */
function inferPlatformFromOrderId(orderId: string): string | null {
  if (/^\d{3}-\d{7}-\d{7}$/.test(orderId)) return 'amazon';
  if (/^\d{2}-\d{5}-\d{5}$/.test(orderId)) return 'ebay';
  return null;
}

export function UnmatchedItemsSection({
  receivingId,
  staffId,
  sourcePlatformHint,
  receivingTypeHint = 'PO',
  listingUrlHint,
  onFileReturnClaim,
  onActiveConditionChange,
  renderLineActions,
  showSerialScan = true,
  onOpenInUnbox,
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

  return (
    <WorkspaceCard
      label={`PO items · ${lines.length}`}
      actions={
        <div className="flex items-center gap-1.5">
          {assignedBox ? (
            <HandlingUnitChip
              handlingUnitId={assignedBox.id}
              code={assignedBox.code}
              unitCount={assignedBox.total}
              dense
            />
          ) : null}
          {onOpenInUnbox ? (
            <button
              type="button"
              onClick={onOpenInUnbox}
              title="Open this carton in unbox mode (serial scan, photos, receive)"
              className="flex h-6 items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 text-caption font-bold uppercase tracking-wider text-blue-700 hover:bg-blue-100"
            >
              <PackageOpen className="h-3 w-3" />
              Open in unbox
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setPopoverMode('repair_service')}
            title="Pick a recent Ecwid repair-service order (-RS) to link to this carton"
            className="flex h-6 items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2.5 text-caption font-bold uppercase tracking-wider text-sky-700 hover:bg-sky-100"
          >
            <Wrench className="h-3 w-3" />
            Link repair service
          </button>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            aria-label="Add to carton"
            title="Add to carton — internal catalog item, web search, or a handling-unit box"
            className="flex h-6 w-6 items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      }
    >
      <div className="space-y-2">
        {/* Primary entry for an unfound carton: scan a serial. On a shipped-serial
            match we pull the product details and create + populate the line — no
            manual Add-item step. Rendered as a regular unbox serial card (white
            card chrome + condition pills), not a themed callout. */}
        {showSerialScan ? (
          <SerialCard
            saved={[]}
            expected={null}
            isSubmitting={returnScanBusy}
            showSavedChips={false}
            condition={cartonScanCondition}
            onConditionChange={(next) => {
              setCartonScanCondition(next);
              onActiveConditionChange?.(next);
            }}
            onAdd={(sn) => handleReturnSerialScan(sn)}
            resultSlot={
              // Importing loader — the only feedback surface for the scan.
              // On success the imported line row below (and the bound PO# /
              // platform chips above) ARE the result; no match band.
              returnScanBusy ? (
                <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-caption font-bold uppercase tracking-wider text-gray-600">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                  Matching serial — importing the sales order…
                </div>
              ) : undefined
            }
          />
        ) : null}
        {lines.map((line) => (
          <UnmatchedLineRow
            key={line.id}
            line={line}
            receivingId={receivingId}
            staffId={staffId}
            receivingType={receivingTypeHint}
            onConditionChange={handleConditionChange}
            onRemove={handleRemoveLine}
            onFileReturnClaim={onFileReturnClaim}
            renderActions={
              renderLineActions
                ? (helpers) => renderLineActions(line, helpers)
                : undefined
            }
            refresh={refreshLines}
          />
        ))}
      </div>

      {/* Unified add popover: Item (internal catalog) · Web (eBay Browse) · Box
          (handling-unit LPN). Replaces the old standalone "+ Add item". */}
      {addOpen ? (
        <CartonAddPopover
          tabs={['item', 'web', 'box']}
          unitIds={cartonUnitIds}
          onAddLine={handleAddLine}
          onAssignedBox={setAssignedBox}
          onClose={() => setAddOpen(false)}
        />
      ) : null}

      {/* Ecwid search is ONLY for Link-repair-service now (the -RS order
          picker). Adding a Zoho item to the PO goes through CartonAddPopover's
          Item tab (zoho_catalog search), NOT this popover. repair_service mode
          loads recent -RS orders and ignores searchFieldOverride entirely. */}
      {popoverMode === 'repair_service' ? (
        <EcwidProductSearchPopover
          receivingId={receivingId}
          popoverMode={popoverMode}
          onSelect={handleAddLine}
          onClose={() => setPopoverMode(null)}
        />
      ) : null}
    </WorkspaceCard>
  );
}

interface UnmatchedLineRowProps {
  line: UnfoundLine;
  receivingId: number;
  staffId?: string;
  receivingType: string;
  onConditionChange: (lineId: number, condition: string) => Promise<void>;
  onRemove: (lineId: number) => Promise<void>;
  onFileReturnClaim?: (matchedOrder: SerialMatchedOrder | null, serial: string) => void;
  /**
   * When provided, replaces the default ConditionPills with a caller-rendered
   * action area. Receives the same helpers the default renderer uses so the
   * caller can still trigger condition changes from inside its custom UI.
   */
  renderActions?: (helpers: UnmatchedLineRenderHelpers) => React.ReactNode;
  refresh: () => void;
}

function UnmatchedLineRow({
  line,
  receivingId,
  staffId,
  receivingType,
  onConditionChange,
  onRemove,
  onFileReturnClaim,
  renderActions,
  refresh,
}: UnmatchedLineRowProps) {
  const [updating, setUpdating] = useState(false);
  const [serialSubmitting, setSerialSubmitting] = useState(false);
  // Per-line serial-match lookup for the RETURN flow — mirrors the matched
  // carton's SerialCard behavior so an unfound return can be paired to the
  // order it shipped on.
  const serialLookup = useSerialLookup();
  const isReturn = String(receivingType || '').toUpperCase() === 'RETURN';
  const saved = (line.serials ?? []) as Array<{ id: number; serial_number: string }>;

  // Submit a serial against this unfound line. Runs the return lookup first
  // (so it reflects prior inventory, not the row we're about to write), then
  // POSTs the scan and refreshes the carton so the new chip + qty land.
  const submitSerial = useCallback(
    async (raw: string) => {
      const serial = raw.trim();
      if (!serial || serialSubmitting) return;
      setSerialSubmitting(true);
      try {
        if (isReturn) await serialLookup.check(serial);
        const res = await fetch('/api/receiving/scan-serial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            receiving_id: receivingId,
            receiving_line_id: line.id,
            serial_number: serial,
            staff_id: Number(staffId) || undefined,
            condition_grade: line.condition_grade || undefined,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.success) {
          toast.error(json?.error || 'Scan failed');
          return;
        }
        dispatchLineUpdated({ id: line.id });
        refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Scan failed');
      } finally {
        setSerialSubmitting(false);
      }
    },
    [isReturn, line.condition_grade, line.id, receivingId, refresh, serialLookup, serialSubmitting, staffId],
  );

  const deleteSerial = useCallback(
    async (serial: { id?: number; serial_number: string }) => {
      if (serial.id == null) return;
      if (!window.confirm(`Remove serial ${serial.serial_number}?`)) return;
      try {
        const res = await fetch('/api/receiving/scan-serial', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serial_unit_id: serial.id, receiving_line_id: line.id }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.success) {
          toast.error(json?.error || 'Could not remove serial');
          return;
        }
        refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not remove serial');
      }
    },
    [line.id, refresh],
  );

  const handleCondition = useCallback(
    async (next: string) => {
      if (next === line.condition_grade) return;
      setUpdating(true);
      try {
        await onConditionChange(line.id, next);
      } finally {
        setUpdating(false);
      }
    },
    [line.condition_grade, line.id, onConditionChange],
  );

  return (
    <div className="rounded-xl border border-blue-300 bg-blue-50/60 p-3">
      <div className="flex items-start gap-3">
        {line.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={line.image_url}
            alt=""
            className="h-12 w-12 shrink-0 rounded border border-blue-100 object-cover"
            loading="lazy"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="truncate text-label font-bold text-gray-900">
            {line.item_name ?? line.sku ?? `Line ${line.id}`}
          </div>
          {/* Meta row — EXACTLY PoLinesAccordion's second row (qty ·
              condition · sku chip · serial chips, shared badge components)
              so an unfound / auto-generated-from-serial line reads the same
              as a matched PO item. */}
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-micro font-semibold uppercase tracking-widest text-gray-500">
            <ProgressBadge
              received={line.quantity_received ?? 0}
              expected={line.quantity_expected ?? 1}
            />
            <span aria-hidden>·</span>
            <ConditionBadge grade={line.condition_grade} />
            {line.sku ? (
              <>
                <span aria-hidden>·</span>
                <SkuScanRefChip value={line.sku} display={getLast4(line.sku)} />
              </>
            ) : null}
            {saved.length > 0 ? (
              <>
                <span aria-hidden>·</span>
                {saved.map((s, i) => {
                  const sn = (s.serial_number || '').trim();
                  if (!sn) return null;
                  // Menu chip (delete on hover) — the ONLY serial display on
                  // the row now; the SerialCard below has its saved chips off
                  // so the serial isn't shown twice.
                  return (
                    <SerialChipWithMenu
                      key={`${sn}-${i}`}
                      serial={s}
                      isEditing={false}
                      onDelete={(target) => void deleteSerial(target)}
                    />
                  );
                })}
              </>
            ) : null}
          </div>
        </div>
        {/* Right-edge trash — removes the line via DELETE /api/receiving-lines.
            Confirms before deleting so an accidental tap doesn't lose work. */}
        <button
          type="button"
          onClick={() => void onRemove(line.id)}
          aria-label="Remove item"
          title="Remove item"
          className="shrink-0 self-start rounded-md p-1.5 text-gray-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 border-t border-blue-200/60 pt-3">
        <div
          className={updating ? 'pointer-events-none opacity-60' : undefined}
          aria-busy={updating || undefined}
        >
          {renderActions ? (
            renderActions({
              onConditionChange: (next) => {
                markConditionSet(line.id);
                void handleCondition(next);
              },
              refresh,
            })
          ) : (
            // Full serial card per line — integrated condition picker + serial
            // scan + (RETURN) the serial-match band. This is why an unfound
            // carton can now capture serials the same way a matched line does.
            <SerialCard
              embedded
              saved={saved}
              expected={line.quantity_expected ?? null}
              isSubmitting={serialSubmitting}
              // Saved chips render in the row's meta line (with the delete
              // menu) — suppress the card's own bottom chip list so the
              // serial doesn't display twice.
              showSavedChips={false}
              condition={line.condition_grade}
              onConditionChange={(next) => {
                markConditionSet(line.id);
                void handleCondition(next);
              }}
              onAdd={(sn) => submitSerial(sn)}
              onDeleteSerial={(s) => void deleteSerial(s)}
              resultSlot={
                isReturn ? (
                  <SerialMatchResult
                    state={serialLookup.state}
                    unit={serialLookup.unit}
                    serial={serialLookup.serial}
                    matchedOrder={serialLookup.matchedOrder}
                    onFileClaim={
                      onFileReturnClaim
                        ? (mo) => onFileReturnClaim(mo, serialLookup.serial)
                        : undefined
                    }
                  />
                ) : undefined
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
