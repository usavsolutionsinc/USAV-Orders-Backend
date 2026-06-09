'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';
import {
  X,
  Copy as CopyIcon,
  RefreshCw,
  Trash2,
} from '@/components/Icons';
import { PaneHeaderTabs } from '@/components/ui/pane-header';
import { SlideOverBackdrop } from '@/components/ui/SlideOverBackdrop';
import DeleteButton from '@/components/ui/DeleteButton';
import { PoChip, TrackingChip, getLast4 } from '@/components/ui/CopyChip';
import { copyToClipboard } from '@/utils/_dom';
import { toast } from '@/lib/toast';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { getStationChannelName } from '@/lib/realtime/channels';

const STATION_CHANNEL = getStationChannelName();

// ── Tab spec ────────────────────────────────────────────────────────────────
type TabId = 'po' | 'shipment' | 'email' | 'notes';
const TABS: Array<{ value: TabId; label: string }> = [
  { value: 'po',       label: 'PO' },
  { value: 'shipment', label: 'Shipment' },
  { value: 'email',    label: 'Email' },
  { value: 'notes',    label: 'Notes' },
];

// ── Response types (loose — only the fields the panel renders) ──────────────
interface DetailsResponse {
  success: true;
  po: {
    zoho_purchaseorder_id: string;
    zoho_purchaseorder_number: string;
    vendor_id: string | null;
    vendor_name: string | null;
    status: string | null;
    po_date: string | null;
    expected_delivery_date: string | null;
    reference_number: string | null;
    total: string | null;
    currency: string | null;
    last_modified_zoho: string | null;
    last_synced_at: string;
    raw?: Record<string, unknown>;
  } | null;
  receiving: {
    id: number;
    shipment_id: number | null;
    received_at: string | null;
  } | null;
  line_items: Array<{
    line_item_id: string | null;
    item_id: string | null;
    sku: string | null;
    name: string | null;
    description: string | null;
    quantity_expected: number;
    quantity_received: number;
    workflow_status: string | null;
    receiving_line_id: number | null;
    rate: number | null;
    item_total: number | null;
  }>;
  shipment: {
    shipment_id: number;
    tracking_number: string | null;
    carrier: string | null;
    latest_status_category: string | null;
    is_delivered: boolean | null;
    delivered_at: string | null;
    last_checked_at: string | null;
    out_for_delivery_at: string | null;
    events: Array<{
      id: number;
      event_occurred_at: string | null;
      normalized_status_category: string;
      external_status_label: string | null;
      external_status_description: string | null;
      event_city: string | null;
      event_state: string | null;
      exception_description: string | null;
      signed_by: string | null;
    }>;
  } | null;
  receive_events: Array<{
    id: number;
    occurred_at: string;
    event_type: string;
    actor_staff_id: number | null;
    station: string | null;
    sku: string | null;
    serial_unit_id: number | null;
    notes: string | null;
  }>;
  gmail: Array<{
    id: number;
    gmail_msg_id: string;
    gmail_thread_id: string | null;
    email_subject: string | null;
    email_from: string | null;
    email_received: string | null;
    status: string | null;
    scanned_at: string | null;
  }>;
  delivered_emails: Array<{
    gmail_msg_id: string;
    gmail_thread_id: string | null;
    order_number: string;
    email_subject: string | null;
    email_from: string | null;
    snippet: string | null;
    delivered_at: string | null;
  }>;
  zoho_activity: Array<{
    timestamp: string | null;
    label: string;
    description: string | null;
  }>;
  notes: string | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function fmtDate(value: string | null | undefined, pattern = 'MMM d, yyyy'): string {
  if (!value) return '—';
  try {
    return format(typeof value === 'string' ? parseISO(value) : value, pattern);
  } catch {
    return value;
  }
}

function fmtDateTime(value: string | null | undefined): string {
  return fmtDate(value, 'MMM d, yyyy · h:mma');
}

function fmtMoney(total: string | number | null, currency: string | null): string {
  if (total == null || total === '') return '—';
  const n = typeof total === 'number' ? total : Number(total);
  if (!Number.isFinite(n)) return '—';
  const cur = currency || 'USD';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(n);
  } catch {
    return `${cur} ${n.toFixed(2)}`;
  }
}

async function copyValue(value: string | null | undefined, label: string) {
  if (!value) return;
  const ok = await copyToClipboard(value);
  if (ok) toast.success(`${label} copied`);
  else toast.error(`Couldn't copy ${label.toLowerCase()}`);
}

function shortCarrier(carrier: string | null | undefined): string {
  const c = (carrier || '').toUpperCase();
  if (c.includes('FEDEX')) return 'FedEx';
  if (c.includes('USPS')) return 'USPS';
  if (c.includes('UPS')) return 'UPS';
  return carrier ? String(carrier) : '';
}

function deliveredAgoLabel(deliveredAt: string | null | undefined): string | null {
  if (!deliveredAt) return null;
  const d = new Date(deliveredAt);
  if (Number.isNaN(d.getTime())) return null;
  return `${formatDistanceToNowStrict(d)} ago`;
}

// Color-code a carrier event's timeline dot by its normalized status so the
// operator can eyeball the trail — delivery (green), exception (red),
// out-for-delivery (amber), label created / pre-transit (gray), and the
// in-transit default (blue).
function eventDotClass(category: string | null | undefined): string {
  const c = (category || '').toLowerCase();
  if (c.includes('deliver') && !c.includes('out')) return 'bg-emerald-500';
  if (c.includes('exception') || c.includes('fail') || c.includes('return')) return 'bg-rose-500';
  if (c.includes('out_for_delivery') || c.includes('ofd')) return 'bg-amber-500';
  if (c.includes('pre_transit') || c.includes('label') || c.includes('created') || c.includes('unknown'))
    return 'bg-gray-300';
  return 'bg-blue-500';
}

// Split a carrier event's date and time so the timeline can lead with a clear,
// scannable time and tuck the location on its own line.
function fmtEventTime(value: string | null | undefined): { date: string; time: string } {
  return { date: fmtDate(value, 'MMM d'), time: fmtDate(value, 'h:mma') };
}

// Day key for grouping the event trail into "Jun 6 / Jun 5 / …" bands.
function eventDayKey(value: string | null | undefined): string {
  return fmtDate(value, 'EEE, MMM d');
}

// Tone for the status hero — mirrors the dot colors so the headline status
// reads the same as its trail. Returns the wrapper + accent classes.
function heroTone(category: string | null | undefined, delivered: boolean | null): {
  wrap: string;
  status: string;
  dot: string;
} {
  const c = (category || '').toLowerCase();
  if (delivered || (c.includes('deliver') && !c.includes('out')))
    return { wrap: 'border-emerald-200 bg-emerald-50', status: 'text-emerald-800', dot: 'bg-emerald-500' };
  if (c.includes('exception') || c.includes('fail') || c.includes('return'))
    return { wrap: 'border-rose-200 bg-rose-50', status: 'text-rose-800', dot: 'bg-rose-500' };
  if (c.includes('out_for_delivery') || c.includes('ofd'))
    return { wrap: 'border-amber-200 bg-amber-50', status: 'text-amber-800', dot: 'bg-amber-500' };
  if (c.includes('pre_transit') || c.includes('label') || c.includes('created') || c.includes('unknown'))
    return { wrap: 'border-gray-200 bg-gray-50', status: 'text-gray-700', dot: 'bg-gray-400' };
  return { wrap: 'border-blue-200 bg-blue-50', status: 'text-blue-800', dot: 'bg-blue-500' };
}

// Humanize a normalized status category ("in_transit" → "In transit") for the
// hero headline, preferring the carrier's own latest label when present.
function prettyStatus(value: string | null | undefined): string {
  if (!value) return 'Unknown';
  const s = value.replace(/[_-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// ── Panel ──────────────────────────────────────────────────────────────────
export interface IncomingDetailsPanelProps {
  /**
   * Zoho PO id to key the panel on. Null for a shipment-anchored "Delivered ·
   * not scanned" box that never resolved to a PO — pass {@link shipmentId}
   * instead and the panel opens in shipment-only mode (Shipment tab + a hard
   * "Remove from Incoming" delete; PO/Email/Notes show empty states).
   */
  zohoPurchaseOrderId: string | null;
  /** Display label for the close button — typically the PO number. */
  poNumberHint?: string | null;
  /** Shipment id (shipping_tracking_numbers.id) for the PO-less fallback. */
  shipmentId?: number | null;
  onClose: () => void;
}

/**
 * Tabbed details panel for a single incoming PO. Mounts over the table in
 * `mode=incoming` when a row is clicked. Data comes from one consolidated
 * endpoint (`/api/receiving-lines/incoming/details`) — single round-trip,
 * react-query cache key by PO id so tab switches don't re-fetch.
 */
export function IncomingDetailsPanel({ zohoPurchaseOrderId, poNumberHint, shipmentId, onClose }: IncomingDetailsPanelProps) {
  // Shipment-only mode: a delivered box with no resolved PO. The panel keys on
  // the shipment id instead, defaults to the Shipment tab, hides PO-only actions
  // (Sync), and its delete hard-removes the shipment from Incoming.
  const isShipmentOnly = !zohoPurchaseOrderId && shipmentId != null;
  // Stable react-query key for the details fetch in either mode.
  const detailsKey = zohoPurchaseOrderId ?? (shipmentId != null ? `shipment:${shipmentId}` : '');

  const [tab, setTab] = useState<TabId>(isShipmentOnly ? 'shipment' : 'po');
  const [syncing, setSyncing] = useState(false);
  const queryClient = useQueryClient();

  // Reset to the default tab when the row changes (PO id or shipment id).
  useEffect(() => setTab(isShipmentOnly ? 'shipment' : 'po'), [zohoPurchaseOrderId, shipmentId, isShipmentOnly]);

  const invalidateIncoming = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['incoming-details', detailsKey] });
    queryClient.invalidateQueries({ queryKey: ['receiving-lines-table'] });
    queryClient.invalidateQueries({ queryKey: ['receiving-lines-incoming-summary'] });
    queryClient.invalidateQueries({ queryKey: ['incoming-delivered-unscanned'] });
  }, [queryClient, detailsKey]);

  // Per-order Sync — re-pull this one PO's Zoho header/status + re-poll its
  // shipment, without running the whole Incoming sweep.
  const syncOne = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/receiving-lines/incoming/sync-one', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ po_id: zohoPurchaseOrderId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        toast.error(body?.error || `Sync failed (${res.status})`);
        return;
      }
      const status = body?.mirror?.status as string | null;
      const polled = body?.shipment?.polled as boolean | undefined;
      toast.success(
        `Synced${status ? ` · Zoho: ${status}` : ''}${polled ? ' · carrier re-polled' : ''}`,
      );
      invalidateIncoming();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }, [syncing, zohoPurchaseOrderId, invalidateIncoming]);

  // Delete — clears the Incoming row. For a PO it removes EVERY receiving_line
  // for that PO (Zoho untouched; a future sync may re-add it). For a PO-less
  // delivered box it hard-deletes the shipment row (there's no receiving_line to
  // delete) so the "Delivered · not scanned" entry stops surfacing.
  // Throws on failure so the shared DeleteButton skips its onDeleted (close).
  const handleDelete = useCallback(async () => {
    const url = isShipmentOnly
      ? `/api/receiving-lines?shipment_id=${encodeURIComponent(String(shipmentId))}`
      : `/api/receiving-lines?po_id=${encodeURIComponent(zohoPurchaseOrderId ?? '')}`;
    const res = await fetch(url, { method: 'DELETE' });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.success) {
      const msg = body?.error || `Delete failed (${res.status})`;
      toast.error(msg);
      throw new Error(msg);
    }
    toast.success(
      isShipmentOnly
        ? 'Removed from Incoming'
        : `Removed from Incoming (${body?.deleted ?? 0} line${body?.deleted === 1 ? '' : 's'})`,
    );
    invalidateIncoming();
  }, [isShipmentOnly, shipmentId, zohoPurchaseOrderId, invalidateIncoming]);

  const { data, isLoading, isError } = useQuery<DetailsResponse>({
    queryKey: ['incoming-details', detailsKey],
    queryFn: async () => {
      const qs = isShipmentOnly
        ? `shipment_id=${encodeURIComponent(String(shipmentId))}`
        : `po_id=${encodeURIComponent(zohoPurchaseOrderId ?? '')}`;
      const res = await fetch(`/api/receiving-lines/incoming/details?${qs}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`details ${res.status}`);
      return res.json();
    },
    enabled: Boolean(detailsKey),
    staleTime: 15_000,
    // Polling fallback so the carrier status stays live (like the carrier's
    // own site) even when realtime/Ably is unavailable. Only this open panel
    // polls — one PO row per minute — and pauses when the tab is hidden, so the
    // DB cost stays negligible.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  // Realtime: a carrier webhook (or poll) that updates this shipment fires
  // `shipment.changed`; refresh the panel + the incoming list/summary instantly
  // so the displayed status matches the carrier's live state without a reload.
  useAblyChannel(STATION_CHANNEL, 'shipment.changed', () => {
    queryClient.invalidateQueries({ queryKey: ['incoming-details', detailsKey] });
    queryClient.invalidateQueries({ queryKey: ['receiving-lines-table'] });
    queryClient.invalidateQueries({ queryKey: ['receiving-lines-incoming-summary'] });
  });

  const headerPo = poNumberHint || data?.po?.zoho_purchaseorder_number || '';
  // Shipment-only rows have no PO chip — fall back to the tracking# so the
  // header still identifies the box.
  const headerTracking = isShipmentOnly
    ? (data?.shipment?.tracking_number || '').trim()
    : '';

  return (
    <>
      <SlideOverBackdrop onClose={onClose} />
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 350, mass: 0.5 }}
        className="fixed right-0 top-0 z-[100] flex h-screen w-[420px] flex-col overflow-hidden border-l border-gray-200 bg-white shadow-[-20px_0_50px_rgba(0,0,0,0.05)]"
      >
      {/* Header — PO chip (last-4 copy) + vendor + close. */}
      <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {headerPo ? (
              <PoChip value={headerPo} display={getLast4(headerPo)} />
            ) : headerTracking ? (
              <TrackingChip value={headerTracking} display={getLast4(headerTracking)} />
            ) : (
              <span className="font-mono text-sm font-bold text-gray-400">—</span>
            )}
            {data?.po?.vendor_name ? (
              <span className="truncate text-caption font-semibold text-gray-500">
                · {data.po.vendor_name}
              </span>
            ) : null}
          </div>
          {/* Sync re-pulls the PO header from Zoho — only meaningful when there
              IS a PO. A shipment-only box uses the Shipment tab's "Re-poll"
              (carrier) instead. */}
          {isShipmentOnly ? null : (
            <button
              type="button"
              onClick={() => void syncOne()}
              disabled={syncing}
              aria-label="Sync this PO"
              title="Re-pull this PO from Zoho + re-poll its shipment"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 text-eyebrow font-black uppercase tracking-wider text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing' : 'Sync'}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details panel"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

      </div>

      {/* Tab nav — reuses PaneHeaderTabs (active tab = bg-gray-900 + white
          text) so this panel matches the shipped + work-order detail panes. */}
      <div className="shrink-0 border-b border-gray-200">
        <PaneHeaderTabs<TabId>
          tabs={TABS}
          value={tab}
          onChange={setTab}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-caption font-semibold text-gray-400">
            Loading details…
          </div>
        ) : isError || !data?.success ? (
          <div className="flex h-full items-center justify-center text-caption font-semibold text-rose-600">
            Could not load PO details.
          </div>
        ) : (
          <div className="p-4">
            {tab === 'po' && <PoTab data={data} />}
            {tab === 'shipment' && <ShipmentTab data={data} />}
            {tab === 'email' && <EmailTab data={data} />}
            {tab === 'notes' && (
              <NotesTab
                receivingId={data.receiving?.id ?? null}
                initialValue={data.notes ?? ''}
              />
            )}
          </div>
        )}
      </div>

      {/* Footer — destructive action. Reuses the shared DeleteButton styled to
          match the shipped panel's DeleteOrderControl (solid red, Trash2,
          two-step confirm). Removes every receiving_line for this PO (the
          Incoming row); Zoho is untouched. */}
      <div className="shrink-0 border-t border-gray-200 bg-white px-4 py-2.5">
        <DeleteButton
          onConfirm={handleDelete}
          onDeleted={onClose}
          icon={<Trash2 className="w-3.5 h-3.5" />}
          label="Delete"
          armedLabel="Click Again To Confirm"
          className="w-full h-10 inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-micro font-black uppercase tracking-wider disabled:opacity-50"
        />
      </div>
      </motion.div>
    </>
  );
}

// ── Tab subcomponents ──────────────────────────────────────────────────────
function Row({ label, value, copyValue: cv }: { label: string; value: React.ReactNode; copyValue?: string | null }) {
  return (
    <div className="flex items-start gap-3 border-b border-gray-100 py-2 last:border-b-0">
      <span className="w-36 shrink-0 text-eyebrow font-black uppercase tracking-wider text-gray-500">
        {label}
      </span>
      <div className="min-w-0 flex-1 break-words text-caption font-semibold text-gray-900">
        {value}
      </div>
      {cv ? (
        <button
          type="button"
          onClick={() => copyValue(cv, label)}
          className="shrink-0 text-gray-400 hover:text-gray-700"
          title={`Copy ${label}`}
        >
          <CopyIcon className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

function PoTab({ data }: { data: DetailsResponse }) {
  const po = data.po;
  if (!po) return <Empty msg="PO not found in zoho_po_mirror yet — wait for the next sync tick." />;
  return (
    <div>
      <Row
        label="PO #"
        value={<PoChip value={po.zoho_purchaseorder_number} display={getLast4(po.zoho_purchaseorder_number)} />}
      />
      <Row label="Status" value={po.status ?? '—'} />
      <Row label="Vendor" value={po.vendor_name ?? '—'} />
      <Row label="Reference #" value={po.reference_number ?? '—'} copyValue={po.reference_number} />
      <Row label="PO Date" value={fmtDate(po.po_date)} />
      <Row label="Expected delivery" value={fmtDate(po.expected_delivery_date)} />
      <Row label="Total" value={fmtMoney(po.total, po.currency)} />
      <Row label="Modified in Zoho" value={fmtDateTime(po.last_modified_zoho)} />
      <Row label="Synced locally" value={fmtDateTime(po.last_synced_at)} />
    </div>
  );
}

function ShipmentTab({ data }: { data: DetailsResponse }) {
  const s = data.shipment;
  const queryClient = useQueryClient();
  const [repolling, setRepolling] = useState(false);

  const repoll = useCallback(async () => {
    if (!s) return;
    setRepolling(true);
    try {
      const res = await fetch('/api/shipping/track/sync-one', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipmentId: s.shipment_id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body?.error || `Re-poll failed (${res.status})`);
        return;
      }
      toast.success(`Refreshed · ${body.status ?? 'updated'}`);
      // Refresh both the panel data and the row list / summary tiles so
      // any status change is reflected end-to-end.
      queryClient.invalidateQueries({ queryKey: ['incoming-details'] });
      queryClient.invalidateQueries({ queryKey: ['receiving-lines-table'] });
      queryClient.invalidateQueries({ queryKey: ['receiving-lines-incoming-summary'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Re-poll failed');
    } finally {
      setRepolling(false);
    }
  }, [s, queryClient]);

  if (!s)
    return (
      <Empty msg="No shipment linked yet — Zoho PO reference# is empty or hasn't resolved to a tracking number. The next sync run will retry." />
    );

  const tone = heroTone(s.latest_status_category, s.is_delivered);
  const headline = prettyStatus(s.latest_status_category);
  const deliveredAgo = deliveredAgoLabel(s.delivered_at);
  const subLine = s.is_delivered
    ? `Delivered ${fmtDateTime(s.delivered_at)}${deliveredAgo ? ` · ${deliveredAgo}` : ''}`
    : s.out_for_delivery_at
      ? `Out for delivery · ${fmtDateTime(s.out_for_delivery_at)}`
      : null;

  return (
    <div>
      {/* Status hero — at-a-glance carrier + live status + the one date that
          matters, with the re-poll action anchored here. */}
      <div className={`mb-3 rounded-xl border p-3 ${tone.wrap}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-eyebrow font-black uppercase tracking-wider text-gray-500">
              <span>{shortCarrier(s.carrier) || s.carrier || 'Carrier'}</span>
              {s.tracking_number ? (
                <>
                  <span aria-hidden>·</span>
                  <TrackingChip value={s.tracking_number} display={getLast4(s.tracking_number)} dense />
                </>
              ) : null}
            </div>
            <div className={`mt-1 flex items-center gap-2 text-base font-black ${tone.status}`}>
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot}`} />
              {headline}
            </div>
            {subLine ? (
              <div className="mt-1 text-caption font-semibold text-gray-600">{subLine}</div>
            ) : null}
            <div className="mt-0.5 text-eyebrow font-semibold text-gray-400">
              Last checked {fmtDateTime(s.last_checked_at)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void repoll()}
            disabled={repolling}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-gray-900 px-2 text-eyebrow font-black uppercase tracking-wider text-white hover:bg-gray-800 disabled:opacity-50"
            title="Force a fresh poll against the carrier API"
          >
            <RefreshCw className={`h-3 w-3 ${repolling ? 'animate-spin' : ''}`} />
            {repolling ? 'Polling…' : 'Re-poll'}
          </button>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-eyebrow font-black uppercase tracking-wider text-gray-500">
          Recent carrier events
        </h3>
        {s.events.length === 0 ? (
          <Empty msg="No carrier events yet." />
        ) : (
          <ol className="relative ml-1 border-l border-gray-200">
            {s.events.map((e, i) => {
              const { time } = fmtEventTime(e.event_occurred_at);
              const location = e.event_city
                ? `${e.event_city}${e.event_state ? ', ' + e.event_state : ''}`
                : null;
              const isLatest = i === 0;
              const dayKey = eventDayKey(e.event_occurred_at);
              const showDay = i === 0 || dayKey !== eventDayKey(s.events[i - 1]?.event_occurred_at);
              return (
                <li key={e.id} className="relative">
                  {showDay ? (
                    <div className="-ml-px mb-1.5 mt-1 border-l-2 border-transparent pl-5 text-eyebrow font-black uppercase tracking-wider text-gray-400 first:mt-0">
                      {dayKey}
                    </div>
                  ) : null}
                  <div className="relative pb-4 pl-5 last:pb-0">
                    <span
                      className={`absolute -left-[5px] top-[5px] h-2.5 w-2.5 rounded-full ring-2 ring-white ${eventDotClass(
                        e.normalized_status_category,
                      )} ${isLatest ? 'shadow-[0_0_0_3px_rgba(59,130,246,0.15)]' : ''}`}
                    />
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`text-caption font-bold ${isLatest ? 'text-gray-900' : 'text-gray-700'}`}>
                        {e.external_status_label || e.normalized_status_category}
                      </span>
                      <span className="shrink-0 whitespace-nowrap text-eyebrow font-semibold tabular-nums text-gray-400">
                        {time}
                      </span>
                    </div>
                    {e.external_status_description ? (
                      <div className="mt-0.5 text-caption text-gray-600">{e.external_status_description}</div>
                    ) : null}
                    {location ? (
                      <div className="mt-0.5 text-eyebrow font-semibold uppercase tracking-wide text-gray-400">
                        {location}
                      </div>
                    ) : null}
                    {e.signed_by ? (
                      <div className="mt-1 inline-flex items-center rounded bg-emerald-50 px-1.5 py-0.5 text-eyebrow font-bold text-emerald-700">
                        Signed by {e.signed_by}
                      </div>
                    ) : null}
                    {e.exception_description ? (
                      <div className="mt-1 inline-flex items-center rounded bg-rose-50 px-1.5 py-0.5 text-eyebrow font-bold text-rose-700">
                        {e.exception_description}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

// Simplified delivery view: just the email(s). An "ORDER DELIVERED" email
// (eBay) is the delivery signal for the email-driven Delivered · not scanned
// surface; this tab shows the raw email so the operator can eyeball it. Falls
// back to any PO-mailbox worklist emails when there's no delivery signal yet.
function EmailTab({ data }: { data: DetailsResponse }) {
  const delivered = data.delivered_emails ?? [];
  const worklist = data.gmail ?? [];

  if (delivered.length === 0 && worklist.length === 0) {
    return <Empty msg="No PO-mailbox email matched this order yet." />;
  }

  return (
    <div className="space-y-3">
      {delivered.map((e) => (
        <div key={`d-${e.gmail_msg_id}`} className="rounded-lg border border-rose-200 bg-rose-50 p-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-rose-600 px-2 py-0.5 text-eyebrow font-black uppercase tracking-wide text-white">
              Order delivered
            </span>
            <span className="tabular-nums text-caption font-bold text-gray-700">{e.order_number}</span>
            <span className="ml-auto text-eyebrow font-semibold text-gray-500">{fmtDateTime(e.delivered_at)}</span>
          </div>
          {e.email_subject ? (
            <div className="mt-2 text-label font-bold text-gray-900">{e.email_subject}</div>
          ) : null}
          {e.email_from ? (
            <div className="mt-0.5 text-caption font-semibold text-gray-600">{e.email_from}</div>
          ) : null}
          {e.snippet ? (
            <p className="mt-2 whitespace-pre-wrap text-caption leading-relaxed text-gray-700">{e.snippet}</p>
          ) : null}
        </div>
      ))}

      {worklist.length > 0 ? (
        <div className="space-y-2">
          {delivered.length > 0 ? (
            <div className="pt-1 text-eyebrow font-black uppercase tracking-wide text-gray-400">
              PO mailbox
            </div>
          ) : null}
          {worklist.map((e) => (
            <div key={`w-${e.gmail_msg_id}`} className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex items-center gap-2">
                {e.status ? (
                  <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-eyebrow font-bold uppercase tracking-wide text-gray-600">
                    {e.status}
                  </span>
                ) : null}
                <span className="ml-auto text-eyebrow font-semibold text-gray-500">{fmtDateTime(e.email_received)}</span>
              </div>
              {e.email_subject ? (
                <div className="mt-1.5 text-label font-bold text-gray-900">{e.email_subject}</div>
              ) : null}
              {e.email_from ? (
                <div className="mt-0.5 text-caption font-semibold text-gray-600">{e.email_from}</div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function NotesTab({
  receivingId,
  initialValue,
}: {
  receivingId: number | null;
  initialValue: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Resync local draft when the panel reopens against a different PO whose
  // receiving row carries different support_notes.
  useEffect(() => setValue(initialValue), [initialValue, receivingId]);

  const save = useCallback(async () => {
    if (receivingId == null) {
      toast.error('No receiving row to attach notes to');
      return;
    }
    const trimmed = value.trim();
    if (trimmed === (initialValue || '').trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/receiving/${receivingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ support_notes: trimmed || null }),
      });
      const data = await res.json();
      if (!data?.success) throw new Error(data?.error || 'save failed');
      toast.success('Notes saved');
      queryClient.invalidateQueries({ queryKey: ['incoming-details'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Notes save failed');
    } finally {
      setSaving(false);
    }
  }, [receivingId, value, initialValue, queryClient]);

  // Save on click-off: any pointer-down outside the textarea commits the draft
  // (no-ops when unchanged). Covers clicking elsewhere in the panel, another
  // tab, or the close button/backdrop — more reliable than focus-blur, which
  // can be skipped when the panel unmounts. Ref keeps the listener stable while
  // always calling the latest `save`.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const el = textareaRef.current;
      if (el && !el.contains(e.target as Node)) void saveRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  if (receivingId == null) {
    return (
      <Empty msg="No receiving row for this PO yet — notes will be available after the next Zoho sync." />
    );
  }

  return (
    <div>
      <label className="block text-eyebrow font-black uppercase tracking-wider text-gray-500">
        Carton notes
      </label>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={6}
        placeholder="Vendor context, claim handoff, anything the receiver should see…"
        className="mt-1 w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-caption font-medium leading-snug text-gray-900 placeholder:text-gray-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10"
      />
      <div className="mt-2 text-eyebrow font-semibold text-gray-400">
        {saving ? 'Saving…' : 'Saves when you click away'}
      </div>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="flex h-32 items-center justify-center px-4 text-center text-caption font-medium text-gray-400">
      {msg}
    </div>
  );
}
