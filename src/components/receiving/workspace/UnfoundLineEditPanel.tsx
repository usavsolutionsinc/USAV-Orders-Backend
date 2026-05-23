'use client';

/**
 * Right-pane workspace editor for an UNMATCHED receiving carton.
 *
 * Mounted in place of LineEditPanel when the underlying receiving row has
 * source='unmatched' — i.e. the tracking number scanned in but Zoho had no
 * matching PO. Operator adds lines manually via the EcwidProductSearchPopover.
 *
 * Shell intentionally mirrors LineEditPanel (PaneHeaderActionBar +
 * WorkspaceCard + StickyActionBar) so navigating between matched/unmatched
 * lines feels continuous. Body is variant-specific: no Zoho refresh, no
 * Zendesk claim modal, no PO lines accordion. Just the carton header
 * (listing URL, ref #, location 📍), platform + type pills, and the lines
 * the operator builds up from Ecwid picks.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AnimatePresence } from 'framer-motion';
import { Plus, RefreshCw, X } from '@/components/Icons';
import { toast } from '@/lib/toast';
import { WorkspaceCard } from '@/design-system/components';
import { StickyActionBar } from '@/design-system/components/StickyActionBar';
import {
  PaneHeaderActionBar,
  type PaneHeaderActionBarAction,
} from '@/components/ui/pane-header';
import { ReceivingCartonStaffDropdown } from '@/components/sidebar/receiving/ReceivingCartonStaffDropdown';
import {
  CONDITION_OPTS,
  COND_LABEL,
} from '@/components/station/receiving-constants';
import {
  RECEIVING_TYPE_OPTS,
  SOURCE_PLATFORM_OPTS,
  detectPlatformFromUrl,
} from '@/components/sidebar/receiving/receiving-sidebar-shared';
import {
  dispatchLineUpdated,
  type ReceivingLineRow,
} from '@/components/station/ReceivingLinesTable';
import { EcwidProductSearchPopover } from '@/components/receiving/unfound/EcwidProductSearchPopover';

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface CartonResponse {
  success: boolean;
  carton?: {
    id: number;
    receiving_tracking_number: string | null;
    listing_url: string | null;
    listing_reference: string | null;
    location_code: string | null;
    source_platform: string | null;
    receiving_type: string | null;
  };
  lines?: UnfoundLine[];
  error?: string;
}

export interface UnfoundLineEditPanelProps {
  row: ReceivingLineRow;
  staffId: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  canPrev?: boolean;
  canNext?: boolean;
}

// ─── Subcomponents (module-scope, per react-best-practices) ───────────────────

interface PillRowProps<T extends string> {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T | null;
  onChange: (next: T) => void;
  /** Variant tone — affects active pill color */
  tone?: 'blue' | 'orange' | 'emerald';
}

function PillRow<T extends string>({
  options,
  value,
  onChange,
  tone = 'blue',
}: PillRowProps<T>) {
  const activeClass =
    tone === 'orange'
      ? 'bg-orange-500 text-white'
      : tone === 'emerald'
      ? 'bg-emerald-600 text-white'
      : 'bg-blue-600 text-white';

  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value || '__empty__'}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors ${
              active
                ? activeClass
                : 'border border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
          >
            {opt.label || 'Unknown'}
          </button>
        );
      })}
    </div>
  );
}

interface ConditionPillRowProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

function ConditionPillRow({ value, onChange, disabled }: ConditionPillRowProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {CONDITION_OPTS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              active
                ? opt.value === 'PARTS'
                  ? 'bg-orange-700 text-white'
                  : 'bg-blue-600 text-white'
                : 'border border-gray-200 bg-white text-gray-500 hover:border-gray-300'
            }`}
          >
            {COND_LABEL[opt.value] ?? opt.label}
          </button>
        );
      })}
    </div>
  );
}

interface UnfoundLineCardProps {
  line: UnfoundLine;
  onConditionChange: (lineId: number, condition: string) => Promise<void>;
}

function UnfoundLineCard({ line, onConditionChange }: UnfoundLineCardProps) {
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
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-start gap-3">
        {line.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={line.image_url}
            alt=""
            className="h-12 w-12 shrink-0 rounded border border-gray-100 object-cover"
            loading="lazy"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-gray-900">
            {line.item_name ?? line.sku ?? `Line ${line.id}`}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
            <span className="tabular-nums">
              {line.quantity_received ?? 0}/{line.quantity_expected ?? 1}
            </span>
            {line.sku && (
              <span className="font-mono tracking-wide">{line.sku}</span>
            )}
            {line.listing_reference && (
              <span className="text-amber-600">#{line.listing_reference}</span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3">
        <ConditionPillRow
          value={line.condition_grade}
          onChange={handleCondition}
          disabled={updating}
        />
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function UnfoundLineEditPanel({
  row,
  staffId,
  onClose,
}: UnfoundLineEditPanelProps) {
  const receivingId = row.receiving_id;

  const [listingUrl, setListingUrl] = useState('');
  const [listingRef, setListingRef] = useState('');
  const [locationCode, setLocationCode] = useState('');
  const [sourcePlatform, setSourcePlatform] = useState<string>(
    row.source_platform || '',
  );
  const [receivingType, setReceivingType] = useState<string>(
    row.receiving_type || 'PO',
  );
  const [lines, setLines] = useState<UnfoundLine[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [receiving, setReceiving] = useState(false);

  const receiveInFlightRef = useRef(false);

  // ─── Fetch carton + lines ───────────────────────────────────────────────────
  const refreshLines = useCallback(async () => {
    if (receivingId == null) return;
    setLinesLoading(true);
    try {
      const res = await fetch(`/api/receiving/${receivingId}`, {
        cache: 'no-store',
      });
      const body = (await res.json()) as CartonResponse;
      if (!res.ok || !body.success) {
        throw new Error(body.error ?? `fetch failed (${res.status})`);
      }
      const c = body.carton;
      if (c) {
        setListingUrl((prev) => prev || c.listing_url || '');
        setListingRef((prev) => prev || c.listing_reference || '');
        setLocationCode((prev) => prev || c.location_code || '');
        if (c.source_platform) setSourcePlatform(c.source_platform);
        if (c.receiving_type) setReceivingType(c.receiving_type);
      }
      setLines(body.lines ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load lines');
    } finally {
      setLinesLoading(false);
    }
  }, [receivingId]);

  useEffect(() => {
    void refreshLines();
  }, [refreshLines]);

  // ─── Listing URL → auto-detect platform (override-preserving) ───────────────
  useEffect(() => {
    if (!listingUrl.trim()) return;
    const detected = detectPlatformFromUrl(listingUrl);
    // Only auto-fill when the operator hasn't set a platform yet — don't
    // overwrite an explicit choice.
    if (detected && !sourcePlatform) setSourcePlatform(detected);
  }, [listingUrl, sourcePlatform]);

  // ─── Mutations ──────────────────────────────────────────────────────────────
  const handleAddLine = useCallback(
    async (selection: {
      sku_platform_id_row: number;
      sku_catalog_id: number | null;
      sku: string;
      item_name: string;
      image_url: string | null;
    }) => {
      if (receivingId == null) {
        toast.error('Cannot add line: receiving id missing');
        return;
      }
      const clientEventId = `add-line-${receivingId}-${Date.now()}`;
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
          source_platform_pill: sourcePlatform || undefined,
          intake_type: receivingType.toLowerCase(),
          listing_url: listingUrl || undefined,
          listing_reference: listingRef || undefined,
          location_code: locationCode || undefined,
          client_event_id: clientEventId,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        toast.error(body.error ?? `add line failed (${res.status})`);
        return;
      }
      // Optimistic append + image_url stitched in from the selection
      setLines((prev) => [
        ...prev,
        {
          ...body.line,
          image_url: selection.image_url,
        },
      ]);
      setPopoverOpen(false);
      toast.success('Item added');
    },
    [
      listingRef,
      listingUrl,
      locationCode,
      receivingId,
      receivingType,
      sourcePlatform,
    ],
  );

  const handleConditionChange = useCallback(
    async (lineId: number, conditionGrade: string) => {
      // Optimistic update
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
        // Revert by re-fetch
        await refreshLines();
        return;
      }
      dispatchLineUpdated({ id: lineId, condition_grade: conditionGrade });
    },
    [refreshLines],
  );

  const handleMarkReceived = useCallback(async () => {
    if (receiveInFlightRef.current) return;
    if (receivingId == null) {
      toast.error('Cannot receive: missing receiving id');
      return;
    }
    if (lines.length === 0) {
      toast.error('Add at least one item before receiving');
      return;
    }
    receiveInFlightRef.current = true;
    setReceiving(true);
    const clientEventId = `mark-${receivingId}-${Date.now()}`;
    try {
      const res = await fetch('/api/receiving/mark-received-po', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': clientEventId,
        },
        body: JSON.stringify({
          receiving_id: receivingId,
          staff_id: Number(staffId) || null,
          intent: 'scan_only',
          client_event_id: clientEventId,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        throw new Error(body.error ?? `receive failed (${res.status})`);
      }
      toast.success('Received');
      await refreshLines();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Receive failed');
    } finally {
      receiveInFlightRef.current = false;
      setReceiving(false);
    }
  }, [lines.length, receivingId, refreshLines, staffId]);

  // ─── UI helpers ─────────────────────────────────────────────────────────────
  const platformValue = useMemo(
    () => sourcePlatform as string,
    [sourcePlatform],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-50">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 pb-32 sm:px-6">
          {/* Header utility bar */}
          <PaneHeaderActionBar
            actions={[
              {
                key: 'refresh',
                label: 'Refresh',
                icon: (
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${linesLoading ? 'animate-spin' : ''}`}
                  />
                ),
                onClick: () => void refreshLines(),
                disabled: linesLoading,
                title: 'Refresh lines',
                ariaLabel: 'Refresh lines',
              },
              {
                key: 'close',
                label: 'Close',
                icon: <X className="h-3.5 w-3.5" />,
                onClick: onClose,
                title: 'Close panel',
                ariaLabel: 'Close',
              },
            ] satisfies PaneHeaderActionBarAction[]}
          />

          {/* Staff card (reused from matched flow) */}
          <WorkspaceCard bodyClassName="px-0 py-0">
            <ReceivingCartonStaffDropdown
              receivingId={receivingId}
              staffId={staffId}
            />
          </WorkspaceCard>

          {/* Header: listing URL + reference # + location 📍 */}
          <WorkspaceCard>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  value={listingUrl}
                  onChange={(e) => setListingUrl(e.target.value)}
                  placeholder="ebay.com/itm/…"
                  className="min-w-[200px] flex-1 border-b border-gray-200 bg-transparent px-1 py-1 text-[13px] outline-none focus:border-blue-500"
                />
                <label className="flex items-center gap-1 text-[11px] text-gray-500">
                  <span className="font-bold uppercase tracking-wider">#</span>
                  <input
                    type="text"
                    value={listingRef}
                    onChange={(e) => setListingRef(e.target.value)}
                    placeholder="3675"
                    className="w-20 border-b border-gray-200 bg-transparent px-1 py-1 text-[13px] tabular-nums outline-none focus:border-blue-500"
                  />
                </label>
                <label className="flex items-center gap-1 text-[11px] text-gray-500">
                  <span>📍</span>
                  <input
                    type="text"
                    value={locationCode}
                    onChange={(e) => setLocationCode(e.target.value)}
                    placeholder="1314"
                    className="w-20 border-b border-gray-200 bg-transparent px-1 py-1 text-[13px] tabular-nums outline-none focus:border-blue-500"
                  />
                </label>
              </div>

              {/* Platform + Type pill rows */}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <PillRow
                  options={SOURCE_PLATFORM_OPTS.filter(
                    (o) => o.value !== '',
                  ).map((o) => ({ value: o.value, label: o.label }))}
                  value={platformValue}
                  onChange={(v) => setSourcePlatform(v)}
                  tone="blue"
                />
                <div className="h-5 w-px bg-gray-200" />
                <PillRow
                  options={RECEIVING_TYPE_OPTS.filter(
                    (o) => o.value !== 'PICKUP',
                  )}
                  value={receivingType}
                  onChange={(v) => setReceivingType(v)}
                  tone="emerald"
                />
              </div>
            </div>
          </WorkspaceCard>

          {/* PO items */}
          <WorkspaceCard
            label={`PO Items · ${lines.length}`}
            actions={
              <button
                type="button"
                onClick={() => setPopoverOpen(true)}
                className="flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white hover:bg-blue-700"
              >
                <Plus className="h-3 w-3" />
                Add item
              </button>
            }
          >
            <div className="relative">
              <AnimatePresence>
                {popoverOpen && receivingId != null && (
                  <EcwidProductSearchPopover
                    receivingId={receivingId}
                    onSelect={handleAddLine}
                    onClose={() => setPopoverOpen(false)}
                  />
                )}
              </AnimatePresence>

              <div className="space-y-2">
                {lines.length === 0 && !linesLoading && (
                  <p className="py-6 text-center text-[12px] text-gray-500">
                    No items yet. Click <span className="font-semibold">Add item</span> to
                    search the Ecwid catalog and pick a product.
                  </p>
                )}
                {lines.map((line) => (
                  <UnfoundLineCard
                    key={line.id}
                    line={line}
                    onConditionChange={handleConditionChange}
                  />
                ))}
              </div>
            </div>
          </WorkspaceCard>
        </div>
      </div>

      {/* Sticky action bar */}
      <StickyActionBar
        primary={{
          label: receiving ? 'Receiving…' : 'Mark Received',
          onClick: () => void handleMarkReceived(),
          disabled: receiving || lines.length === 0,
          isLoading: receiving,
          tone: 'emerald',
          title:
            lines.length === 0
              ? 'Add at least one item before receiving'
              : undefined,
        }}
      />
    </div>
  );
}
