'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import {
  FileText,
  X,
  Copy as CopyIcon,
} from '@/components/Icons';
import { PaneHeaderTabs } from '@/components/ui/pane-header';
import { SlideOverBackdrop } from '@/components/ui/SlideOverBackdrop';
import { copyToClipboard } from '@/utils/_dom';
import { toast } from '@/lib/toast';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { getStationChannelName } from '@/lib/realtime/channels';

const STATION_CHANNEL = getStationChannelName();

// ── Tab spec ────────────────────────────────────────────────────────────────
type TabId = 'po' | 'shipment' | 'notes';
const TABS: Array<{ value: TabId; label: string }> = [
  { value: 'po',       label: 'PO' },
  { value: 'shipment', label: 'Shipment' },
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

// ── Panel ──────────────────────────────────────────────────────────────────
export interface IncomingDetailsPanelProps {
  zohoPurchaseOrderId: string;
  /** Display label for the close button — typically the PO number. */
  poNumberHint?: string | null;
  onClose: () => void;
}

/**
 * Tabbed details panel for a single incoming PO. Mounts over the table in
 * `mode=incoming` when a row is clicked. Data comes from one consolidated
 * endpoint (`/api/receiving-lines/incoming/details`) — single round-trip,
 * react-query cache key by PO id so tab switches don't re-fetch.
 */
export function IncomingDetailsPanel({ zohoPurchaseOrderId, poNumberHint, onClose }: IncomingDetailsPanelProps) {
  const [tab, setTab] = useState<TabId>('po');
  const queryClient = useQueryClient();

  // Reset to default tab when the PO changes (different row clicked).
  useEffect(() => setTab('po'), [zohoPurchaseOrderId]);

  const { data, isLoading, isError } = useQuery<DetailsResponse>({
    queryKey: ['incoming-details', zohoPurchaseOrderId],
    queryFn: async () => {
      const res = await fetch(
        `/api/receiving-lines/incoming/details?po_id=${encodeURIComponent(zohoPurchaseOrderId)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error(`details ${res.status}`);
      return res.json();
    },
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
    queryClient.invalidateQueries({ queryKey: ['incoming-details', zohoPurchaseOrderId] });
    queryClient.invalidateQueries({ queryKey: ['receiving-lines-table'] });
    queryClient.invalidateQueries({ queryKey: ['receiving-lines-incoming-summary'] });
  });

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
      {/* Header — PO badge + close. */}
      <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-blue-600" />
            <span className="truncate font-mono text-sm font-bold text-gray-900">
              {poNumberHint || data?.po?.zoho_purchaseorder_number || '—'}
            </span>
            {data?.po?.vendor_name ? (
              <span className="truncate text-caption font-semibold text-gray-500">
                · {data.po.vendor_name}
              </span>
            ) : null}
          </div>
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
            {tab === 'notes' && (
              <NotesTab
                receivingId={data.receiving?.id ?? null}
                initialValue={data.notes ?? ''}
              />
            )}
          </div>
        )}
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
      <Row label="PO #" value={po.zoho_purchaseorder_number} copyValue={po.zoho_purchaseorder_number} />
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
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-eyebrow font-black uppercase tracking-wider text-gray-500">
          Carrier-side state
        </span>
        <button
          type="button"
          onClick={() => void repoll()}
          disabled={repolling}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-gray-900 px-2 text-eyebrow font-black uppercase tracking-wider text-white hover:bg-gray-800 disabled:opacity-50"
          title="Force a fresh poll against the carrier API"
        >
          {repolling ? 'Polling…' : 'Re-poll'}
        </button>
      </div>
      <div className="space-y-0 pb-3">
        <Row label="Tracking #" value={s.tracking_number ?? '—'} copyValue={s.tracking_number} />
        <Row label="Carrier" value={s.carrier ?? '—'} />
        <Row label="Status" value={s.latest_status_category ?? '—'} />
        <Row
          label="Delivered"
          value={
            s.is_delivered
              ? `${fmtDateTime(s.delivered_at)}`
              : s.out_for_delivery_at
                ? `OFD ${fmtDateTime(s.out_for_delivery_at)}`
                : 'Not yet'
          }
        />
        <Row label="Last checked" value={fmtDateTime(s.last_checked_at)} />
      </div>
      <div className="mt-2">
        <h3 className="mb-2 text-eyebrow font-black uppercase tracking-wider text-gray-500">
          Recent carrier events
        </h3>
        {s.events.length === 0 ? (
          <Empty msg="No carrier events yet." />
        ) : (
          <ol className="relative space-y-2 border-l border-gray-200 pl-3">
            {s.events.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[7px] top-1.5 h-2.5 w-2.5 rounded-full bg-blue-500" />
                <div className="text-caption font-semibold text-gray-900">
                  {e.external_status_label || e.normalized_status_category}
                </div>
                <div className="text-eyebrow font-semibold text-gray-500">
                  {fmtDateTime(e.event_occurred_at)}
                  {e.event_city ? ` · ${e.event_city}${e.event_state ? ', ' + e.event_state : ''}` : ''}
                </div>
                {e.external_status_description ? (
                  <div className="mt-0.5 text-caption text-gray-600">{e.external_status_description}</div>
                ) : null}
                {e.signed_by ? (
                  <div className="mt-0.5 text-eyebrow font-semibold text-emerald-700">Signed by {e.signed_by}</div>
                ) : null}
                {e.exception_description ? (
                  <div className="mt-0.5 text-eyebrow font-semibold text-rose-700">{e.exception_description}</div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
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
