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
import { ConditionPills } from '@/components/receiving/workspace/ConditionPills';
import { markConditionSet } from '@/components/receiving/workspace/ReceivingProgressStepper';
import { SkuScanRefChip, getLast4 } from '@/components/ui/CopyChip';

interface UnfoundLine {
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
}

export interface UnmatchedItemsSectionProps {
  receivingId: number;
  sourcePlatformHint?: string;
  receivingTypeHint?: string;
  listingUrlHint?: string;
}

interface CartonResponse {
  success: boolean;
  lines?: UnfoundLine[];
  error?: string;
}

export function UnmatchedItemsSection({
  receivingId,
  sourcePlatformHint,
  receivingTypeHint = 'PO',
  listingUrlHint,
}: UnmatchedItemsSectionProps) {
  const [lines, setLines] = useState<UnfoundLine[]>([]);
  const [loading, setLoading] = useState(false);
  /** null = closed; 'search' | 'repair_service' = which mode the popover is in. */
  const [popoverMode, setPopoverMode] = useState<EcwidProductPopoverMode | null>(null);

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

  const handleAddLine = useCallback(
    async (selection: {
      sku_platform_id_row: number;
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
          sku_platform_id_row: selection.sku_platform_id_row,
          sku_catalog_id: selection.sku_catalog_id,
          sku: selection.sku,
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
        {lines.length === 0 && !loading && (
          <p className="py-6 text-center text-label text-gray-500">
            No items yet. Click <span className="font-semibold">Add item</span> to
            search the Ecwid catalog and pick a product.
          </p>
        )}
        {lines.map((line) => (
          <UnmatchedLineRow
            key={line.id}
            line={line}
            onConditionChange={handleConditionChange}
            onRemove={handleRemoveLine}
          />
        ))}
      </div>

      {popoverMode != null ? (
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
  onConditionChange: (lineId: number, condition: string) => Promise<void>;
  onRemove: (lineId: number) => Promise<void>;
}

function UnmatchedLineRow({
  line,
  onConditionChange,
  onRemove,
}: UnmatchedLineRowProps) {
  const [updating, setUpdating] = useState(false);
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
          <ConditionPills
            value={line.condition_grade}
            onChange={(next) => {
              markConditionSet(line.id);
              void handleCondition(next);
            }}
          />
        </div>
      </div>
    </div>
  );
}
