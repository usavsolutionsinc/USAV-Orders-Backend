'use client';

/**
 * Items section for an unmatched (no-Zoho-PO) receiving carton.
 *
 * Mounted by {@link LineEditPanel} where {@link PoLinesAccordion} would
 * sit for a Zoho-matched carton. Owns:
 *   - fetching the carton's existing receiving_lines
 *   - the [+ Add item] CTA + EcwidProductSearchPopover (centered modal)
 *   - per-line condition pill updates
 *
 * Kept deliberately small so LineEditPanel can drop it in without
 * branching on receiving_source for every prop.
 */

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Wrench } from '@/components/Icons';
import { toast } from '@/lib/toast';
import { WorkspaceCard } from '@/design-system/components';
import {
  EcwidProductSearchPopover,
  type EcwidProductPopoverMode,
} from '@/components/receiving/unfound/EcwidProductSearchPopover';
import { SerialCard } from '@/components/receiving/workspace/SerialCard';
import {
  SerialMatchResult,
  useSerialLookup,
  type SerialMatchedOrder,
  type SerialMatchUnit,
} from '@/components/receiving/workspace/SerialMatchResult';
import { markConditionSet } from '@/components/receiving/workspace/ReceivingProgressStepper';
import { dispatchLineUpdated } from '@/components/station/ReceivingLinesTable';
import { SkuScanRefChip, getLast4 } from '@/components/ui/CopyChip';

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
   * Optional render override for the per-line action area (replaces the
   * default `ConditionPills` + serial card). Use this from the testing
   * workspace to drop in `TestingStatusPills` + `InlineSerialAdder` per line so
   * an unmatched carton's items can be tested without round-tripping through
   * receiving. When omitted, the section keeps its default receiving behavior.
   */
  renderLineActions?: (line: UnfoundLine, helpers: UnmatchedLineRenderHelpers) => React.ReactNode;
  /** "Scan a serial number" card. Hidden in triage — serials are an unbox step. */
  showSerialScan?: boolean;
}

interface CartonResponse {
  success: boolean;
  lines?: UnfoundLine[];
  error?: string;
}

export function UnmatchedItemsSection({
  receivingId,
  staffId,
  sourcePlatformHint,
  receivingTypeHint = 'PO',
  listingUrlHint,
  onFileReturnClaim,
  renderLineActions,
  showSerialScan = true,
}: UnmatchedItemsSectionProps) {
  const [lines, setLines] = useState<UnfoundLine[]>([]);
  const [loading, setLoading] = useState(false);
  /** null = closed; 'search' | 'repair_service' = which mode the popover is in. */
  const [popoverMode, setPopoverMode] = useState<EcwidProductPopoverMode | null>(null);

  // Carton-level serial matcher. An unfound carton has no lines until something
  // is added, so this lets the operator scan a serial directly: on a
  // shipped-serial match we create a line populated from the matched sales order
  // (title + sku, classified intake_type='return') and attach the serial — no
  // manual Add-item step.
  const [returnScanBusy, setReturnScanBusy] = useState(false);
  const [returnMatch, setReturnMatch] = useState<{
    state: 'found' | 'not-found';
    unit: SerialMatchUnit | null;
    serial: string;
    matchedOrder: SerialMatchedOrder | null;
  } | null>(null);

  const refreshLines = useCallback(async () => {
    setLoading(true);
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
    } finally {
      setLoading(false);
    }
  }, [receivingId]);

  useEffect(() => {
    void refreshLines();
  }, [refreshLines]);

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
        setReturnMatch({ state: found ? 'found' : 'not-found', unit, serial, matchedOrder });

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
          }),
        });
        const scanBody = await scanRes.json().catch(() => ({}));
        if (!scanRes.ok || !scanBody?.success) {
          toast.error(scanBody?.error || 'Line created, but the serial scan failed');
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
    [receivingId, refreshLines, returnScanBusy, staffId],
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
          // Forwarded so downstream tagging (Zoho receive, repair queue,
          // line list filters) can branch on repair-service lines.
          is_repair_service: selection.is_repair_service || undefined,
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

      // Repair-service linking side-effects on the carton itself. Done as
      // TWO sequential PATCHes so the critical PO# write isn't rolled
      // back if the source_platform write hits the DB check constraint
      // (e.g. 'ecwid' migration not yet applied in this environment).
      //
      //   1. zoho_purchaseorder_number = Ecwid order#  → /api/receiving/[id]
      //      auto-flips receiving.source 'unmatched' → 'zoho_po' (carton
      //      drops off the Unfound queue).
      //   2. source_platform = 'ecwid' → drives the ECWID-RS pill in the
      //      workspace header. Best-effort; logged on failure.
      if (selection.is_repair_service) {
        let poApplied = false;
        if (selection.ecwid_order_id) {
          try {
            const r1 = await fetch(`/api/receiving/${receivingId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                zoho_purchaseorder_number: selection.ecwid_order_id,
              }),
            });
            poApplied = r1.ok;
          } catch {
            /* surfaced below via toast */
          }
        }
        try {
          await fetch(`/api/receiving/${receivingId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_platform: 'ecwid' }),
          });
        } catch {
          /* non-fatal — pill stays as Unfound until operator picks one */
        }
        window.dispatchEvent(new CustomEvent('usav-refresh-data'));
        window.dispatchEvent(
          new CustomEvent('receiving-package-updated', {
            detail: {
              receiving_id: receivingId,
              source_platform: 'ecwid',
              zoho_purchaseorder_number: poApplied
                ? selection.ecwid_order_id
                : null,
            },
          }),
        );
        toast.success(
          poApplied && selection.ecwid_order_id
            ? `Linked Ecwid order #${selection.ecwid_order_id}`
            : 'Repair service linked',
        );
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
          <button
            type="button"
            onClick={() => setPopoverMode('repair_service')}
            title="Pick a recent Ecwid repair-service order (-RS) to link to this carton"
            className="flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1 text-caption font-bold uppercase tracking-wider text-sky-700 hover:bg-sky-100"
          >
            <Wrench className="h-3 w-3" />
            Link repair service
          </button>
          <button
            type="button"
            onClick={() => setPopoverMode('search')}
            className="flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-caption font-bold uppercase tracking-wider text-white hover:bg-blue-700"
          >
            <Plus className="h-3 w-3" />
            Add item
          </button>
        </div>
      }
    >
      <div className="space-y-2">
        {/* Primary entry for an unfound carton: scan a serial. On a shipped-serial
            match we pull the product details and create + populate the line — no
            manual Add-item step. Always shown (Add item stays as the fallback for
            serials with no match). */}
        {showSerialScan ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
          <p className="mb-1 text-micro font-black uppercase tracking-[0.14em] text-emerald-700">
            Scan a serial number
          </p>
          <p className="mb-2 text-micro font-medium leading-snug text-emerald-700/80">
            Pulls the product details from the order it shipped on and adds the line for you.
          </p>
          <SerialCard
            embedded
            saved={[]}
            expected={null}
            isSubmitting={returnScanBusy}
            showSavedChips={false}
            onAdd={(sn) => handleReturnSerialScan(sn)}
            resultSlot={
              returnMatch ? (
                <SerialMatchResult
                  state={returnMatch.state}
                  unit={returnMatch.unit}
                  serial={returnMatch.serial}
                  matchedOrder={returnMatch.matchedOrder}
                  onFileClaim={
                    onFileReturnClaim
                      ? (mo) => onFileReturnClaim(mo, returnMatch.serial)
                      : undefined
                  }
                />
              ) : undefined
            }
          />
        </div>
        ) : null}
        {lines.length === 0 && !loading && (
          <p className="py-6 text-center text-label text-gray-500">
            No items yet.{showSerialScan ? ' Scan a serial above, or click' : ' Click'}{' '}
            <span className="font-semibold">Add item</span> to search the Zoho
            catalog and pick a product.
          </p>
        )}
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

      {popoverMode != null ? (
        <EcwidProductSearchPopover
          receivingId={receivingId}
          popoverMode={popoverMode}
          // "Add item" searches the Zoho catalog (items source of truth), not
          // Ecwid titles/SKUs. Only affects 'search' mode; 'repair_service'
          // still loads recent Ecwid -RS orders.
          searchFieldOverride="zoho_catalog"
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
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-micro font-semibold uppercase tracking-widest text-gray-500">
            <span className="tabular-nums normal-case tracking-normal font-semibold">
              {line.quantity_received ?? 0}/{line.quantity_expected ?? 1}
            </span>
            {line.sku ? (
              // Same SkuScanRefChip used by PoLinesAccordion so matched
              // and unmatched cartons render the SKU chip identically
              // (yellow / pencil / last-4 display, click to copy).
              <SkuScanRefChip
                value={line.sku}
                display={getLast4(line.sku)}
              />
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
