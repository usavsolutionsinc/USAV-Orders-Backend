'use client';

/**
 * Auto-match row for an UNFOUND carton — lives inside {@link POUnboxingSection}
 * below PO Items, above Package Pairing. Operator-initiated only; nothing here
 * runs on the scan path (see useUnfoundRefetchActions).
 *
 * Three resolution actions, same weight, differentiated by icon:
 *   • **Order #** (Search) — search our LOCAL shipped records by order number
 *     and compare the serial we shipped against the one in hand. The no-dead-end
 *     path when a scanned serial has no platform match.
 *   • **Zoho** (RefreshCw) — FETCH: re-run the Zoho PO tracking search.
 *   • **Amazon return** (PackageCheck) — FETCH: reverse-tracking SP-API lookup.
 *
 * The row is contextual + single-line: tapping **Order #** re-renders it into a
 * serial-anchored search bar with a back arrow (leftmost). A confirmed match
 * links via import-sales-order, or the operator handles it inline through the
 * support-ticket popover (reply on the linked ticket, or create a new one).
 */

import { useEffect, useRef, useState, type ComponentType, type SVGProps } from 'react';
import {
  RefreshCw,
  Search,
  Check,
  Info,
  AlertTriangle,
  ChevronLeft,
  MessageSquare,
  PackageCheck,
  ExternalLink,
  Send,
  Database,
} from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { Popover } from '@/design-system/primitives/Popover';
import { PaneHeaderTabs } from '@/components/ui/pane-header';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { ListingUrlChip, OrderIdChip } from '@/components/ui/CopyChip';
import { getLast4 } from '@/lib/copy-chip-format';
import { toast } from '@/lib/toast';
import { safeRandomUUID } from '@/lib/safe-uuid';
import {
  useUnfoundRefetchActions,
  type RefetchState,
} from './hooks/useUnfoundRefetchActions';
import { pickMergedRefetchNotice } from './hooks/useUnfoundRefetchActions.classify';
import { useShippedOrderCompare } from './hooks/useShippedOrderCompare';
import type { ShippedOrderCompare, SerialCompareOutcome } from '@/lib/receiving/returned-serial-link';
import { diffSerials, pickClosestShippedSerial, type SerialDiffCell } from '@/lib/receiving/serial-diff';
import { Barcode } from '@/components/Icons';
import { ClaimTicketReply } from '@/components/receiving/workspace/claim/components/ClaimTicketReply';
import { useClaimTicketReply } from '@/components/receiving/workspace/claim/hooks/useClaimTicketReply';
import type { FiledTicket } from '@/components/receiving/workspace/claim/claim-types';
import { WorkspaceSectionTitle } from '../WorkspaceSectionLabel';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

interface UnfoundMatchStripProps {
  receivingId: number | null;
  /** Active line — the ticket entity (create / reply) is scoped to it. */
  lineId?: number | null;
  trackingNumber: string | null;
  /** The serial in hand (last scanned on this carton), compared against the
   *  searched order's shipped serials. Null when nothing has been scanned yet. */
  receivedSerial?: string | null;
  /** Linked Zendesk ticket id → reply mode; null → create mode. */
  providerTicketId?: number | null;
  /** Ticket display label ("#9395"), when linked. */
  ticketNumber?: string | null;
  /** Zendesk deep link, when known. */
  ticketUrl?: string | null;
  /** Refetch the support-ticket link after a create/reply. */
  onTicketChanged?: () => void;
  /** When false, omit top divider (e.g. first block in a pairing-only card). */
  showTopRule?: boolean;
}

export function UnfoundMatchStrip({
  receivingId,
  lineId = null,
  trackingNumber,
  receivedSerial = null,
  providerTicketId = null,
  ticketNumber = null,
  ticketUrl = null,
  onTicketChanged,
  showTopRule = true,
}: UnfoundMatchStripProps) {
  const { zoho, amazon, busy, checkZoho, checkAmazon } = useUnfoundRefetchActions(
    receivingId,
    trackingNumber,
  );
  const compare = useShippedOrderCompare();
  const [orderSearchOpen, setOrderSearchOpen] = useState(false);
  const hasTracking = Boolean(trackingNumber?.trim());
  const noReceiving = receivingId == null;
  const notice = pickMergedRefetchNotice(zoho, amazon);

  const closeSearch = () => {
    setOrderSearchOpen(false);
    compare.reset();
  };

  return (
    <div
      className={showTopRule ? 'space-y-2 border-t border-border-hairline pt-3' : 'space-y-2'}
    >
      <WorkspaceSectionTitle as="p">Auto-match</WorkspaceSectionTitle>

      {orderSearchOpen ? (
        <OrderSearchRow
          state={compare.state}
          receivedSerial={receivedSerial}
          disabled={noReceiving}
          receivingId={receivingId}
          lineId={lineId}
          providerTicketId={providerTicketId}
          ticketNumber={ticketNumber}
          ticketUrl={ticketUrl}
          onTicketChanged={onTicketChanged}
          onBack={closeSearch}
          onSearch={(order, serial) => void compare.search(order, serial)}
          onClear={compare.reset}
        />
      ) : (
        // Three peer actions, one uniform treatment — differentiated by icon.
        // Order # searches local records; Zoho / Amazon fetch from the platform.
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <StripButton
            icon={Search}
            label="Order #"
            tooltip="Search our shipped records by order number and compare the serial we shipped against the one in hand"
            disabled={noReceiving}
            onClick={() => setOrderSearchOpen(true)}
          />
          <StripButton
            icon={RefreshCw}
            label="Zoho"
            tooltip="Fetch from platform — re-run the Zoho PO tracking search"
            state={zoho}
            disabled={noReceiving || busy}
            onClick={() => void checkZoho()}
          />
          <StripButton
            icon={PackageCheck}
            label="Amazon return"
            tooltip={
              hasTracking
                ? 'Fetch from platform — match by reverse tracking ID (Amazon Returns SP-API)'
                : 'Add a tracking number to this carton first'
            }
            state={amazon}
            disabled={noReceiving || !hasTracking || busy}
            onClick={() => void checkAmazon()}
          />
        </div>
      )}

      {!orderSearchOpen && notice ? <MergedNotice state={notice} /> : null}
    </div>
  );
}

/** One uniform Auto-match action. Async lanes (Zoho / Amazon) pass `state` for
 *  the loading spinner; the Order # toggle omits it. */
function StripButton({
  icon: Icon,
  label,
  tooltip,
  state,
  disabled,
  onClick,
}: {
  icon: IconComponent;
  label: string;
  tooltip: string;
  state?: RefetchState;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <HoverTooltip label={tooltip} asChild focusable={false}>
      <Button
        variant="secondary"
        size="sm"
        loading={state?.status === 'loading'}
        disabled={disabled}
        onClick={onClick}
        className="min-h-11 w-full justify-start gap-2 rounded-lg px-3"
        icon={<Icon className="h-4 w-4 shrink-0" />}
      >
        <span className="truncate text-caption font-bold">{label}</span>
      </Button>
    </HoverTooltip>
  );
}

/**
 * The contextual search bar the row becomes when Order # is tapped: a back arrow
 * (leftmost) + a serial-anchored order-number search. The compare result +
 * ticket popover render below.
 */
function OrderSearchRow({
  state,
  receivedSerial,
  disabled,
  receivingId,
  lineId,
  providerTicketId,
  ticketNumber,
  ticketUrl,
  onTicketChanged,
  onBack,
  onSearch,
  onClear,
}: {
  state: ReturnType<typeof useShippedOrderCompare>['state'];
  receivedSerial: string | null;
  disabled: boolean;
  receivingId: number | null;
  lineId: number | null;
  providerTicketId: number | null;
  ticketNumber: string | null;
  ticketUrl: string | null;
  onTicketChanged?: () => void;
  onBack: () => void;
  onSearch: (orderNumber: string, serial: string) => void;
  onClear: () => void;
}) {
  const [orderNumber, setOrderNumber] = useState('');
  const [serial, setSerial] = useState(receivedSerial ?? '');
  const trimmedOrder = orderNumber.trim();
  const trimmedSerial = serial.trim();

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <IconButton
          type="button"
          icon={<ChevronLeft className="h-4 w-4" />}
          ariaLabel="Back to auto-match options"
          tone="neutral"
          onClick={onBack}
        />
        <form
          className="min-w-0 flex-1 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmedOrder) onSearch(trimmedOrder, trimmedSerial);
          }}
        >
          {/* Serial in hand — the unit being investigated (scan or type). */}
          <div className="relative">
            <Barcode className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-500" aria-hidden />
            <input
              autoFocus
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              placeholder="Serial in hand — scan or type…"
              disabled={disabled}
              className="min-h-11 w-full min-w-0 rounded-lg border-0 bg-surface-card pl-9 pr-3 font-mono text-caption font-semibold text-text-default ring-1 ring-inset ring-border-soft placeholder:font-sans placeholder:text-text-faint focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
          </div>
          {/* Order # — to find what we shipped and contrast serials. */}
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" aria-hidden />
              <input
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                placeholder="Order number…"
                disabled={disabled}
                className="min-h-11 w-full min-w-0 rounded-lg border-0 bg-surface-card pl-9 pr-3 text-caption font-semibold text-text-default ring-1 ring-inset ring-border-soft placeholder:text-text-faint focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              loading={state.status === 'loading'}
              disabled={disabled || !trimmedOrder}
              className="min-h-11 shrink-0 gap-2 rounded-lg px-3"
              icon={<Search className="h-4 w-4 shrink-0" />}
            >
              <span className="text-caption font-bold">Search</span>
            </Button>
          </div>
        </form>
      </div>

      {state.status === 'error' && state.message ? (
        <CompareLine tone="danger" icon={AlertTriangle} text={state.message} />
      ) : null}
      {state.status === 'not-found' && state.message ? (
        <CompareLine tone="warning" icon={Info} text={state.message} />
      ) : null}
      {state.status === 'found' && state.result?.order ? (
        <CompareResult
          result={state.result}
          receivedSerial={trimmedSerial || null}
          receivingId={receivingId}
          lineId={lineId}
          providerTicketId={providerTicketId}
          ticketNumber={ticketNumber}
          ticketUrl={ticketUrl}
          onTicketChanged={onTicketChanged}
          onClear={onClear}
        />
      ) : null}
    </div>
  );
}

const OUTCOME_META: Record<
  SerialCompareOutcome,
  { tone: 'success' | 'danger' | 'warning' | 'neutral'; icon: IconComponent; label: string }
> = {
  match: { tone: 'success', icon: Check, label: 'Serials match — this is the unit we shipped' },
  mismatch: { tone: 'danger', icon: AlertTriangle, label: 'Serial mismatch — not the unit on this order' },
  no_received: { tone: 'neutral', icon: Info, label: 'Scan a serial to compare against this order' },
  no_shipped_serial: { tone: 'warning', icon: Info, label: 'No serial on record for this order' },
};

/** Serial-anchored compare summary → the claim prefill. */
function buildTicketPrefill(result: ShippedOrderCompare, receivedSerial: string | null): string {
  const o = result.order;
  const shipped = result.shipped_serials[0] ?? '—';
  const verdict =
    result.serial_match === 'match'
      ? 'serials match'
      : result.serial_match === 'mismatch'
        ? 'SERIAL MISMATCH'
        : result.serial_match === 'no_shipped_serial'
          ? 'no serial on record for this order'
          : 'no received serial to compare';
  return [
    o?.order_id ? `Return for order ${o.order_id}` : 'Return — order lookup',
    o?.product_title ? `Item: ${o.product_title}` : '',
    `Shipped serial: ${shipped}`,
    `Received serial: ${receivedSerial ?? '—'}`,
    `Serial check: ${verdict}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Found-order display: title + order chip, then the serial comparison as the
 * crux (shipped vs received via the shared CopyChip last-4 chips), a single
 * tone-carrying verdict line, and the actions (listing + support-ticket popover).
 */
function CompareResult({
  result,
  receivedSerial,
  receivingId,
  lineId,
  providerTicketId,
  ticketNumber,
  ticketUrl,
  onTicketChanged,
  onClear,
}: {
  result: ShippedOrderCompare;
  receivedSerial: string | null;
  receivingId: number | null;
  lineId: number | null;
  providerTicketId: number | null;
  ticketNumber: string | null;
  ticketUrl: string | null;
  onTicketChanged?: () => void;
  onClear: () => void;
}) {
  const { order, shipped_serials, serial_match } = result;
  if (!order) return null;
  const meta = OUTCOME_META[serial_match];
  // Contrast the received serial against the CLOSEST serial we shipped on this
  // order (fewest differing chars) so a single mistyped digit reads as a near
  // match, not a blank "no match".
  const closest = pickClosestShippedSerial(receivedSerial, shipped_serials);
  const diff = diffSerials(receivedSerial, closest);
  const verdictText =
    serial_match === 'mismatch'
      ? `${diff.diffCount} character${diff.diffCount === 1 ? '' : 's'} differ — not the unit on this order`
      : meta.label;

  return (
    <div className="space-y-2.5 rounded-lg bg-surface-card px-3 py-2.5 ring-1 ring-inset ring-border-soft">
      {/* Identity — title leads, order id chip + clear on the right. */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {order.product_title ? (
            // ds-allow-title
            <p className="truncate text-caption font-bold text-text-default" title={order.product_title}>
              {order.product_title}
            </p>
          ) : (
            <p className="text-caption font-bold text-text-muted">Order found</p>
          )}
          {order.sku ? (
            <p className="truncate text-eyebrow font-semibold uppercase tracking-widest text-text-faint">
              {order.sku}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {order.order_id ? (
            <OrderIdChip value={order.order_id} display={getLast4(order.order_id)} />
          ) : null}
          <button
            type="button"
            onClick={onClear}
            className="text-eyebrow font-black uppercase tracking-widest text-text-faint hover:text-text-muted"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Serial compare & contrast — the crux. Character-level diff of the serial
          we shipped vs the one in hand; differing characters highlighted. */}
      <SerialContrast received={receivedSerial} shipped={closest} />
      <CompareLine tone={meta.tone} icon={meta.icon} text={verdictText} />

      {/* Actions — log the received serial into the system, listing, ticket. */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-hairline pt-2">
        {order.listing_url ? (
          <ListingUrlChip rawUrl={order.listing_url} openHref={order.listing_url} previewDisplay="View listing" />
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <LogSerialButton
            receivingId={receivingId}
            lineId={lineId}
            serial={receivedSerial}
            orderNumber={order.order_id}
            shippedSerial={closest}
            serialMatch={serial_match}
          />
          <SupportTicketPopover
            receivingId={receivingId}
            lineId={lineId}
            providerTicketId={providerTicketId}
            ticketNumber={ticketNumber}
            ticketUrl={ticketUrl}
            prefill={buildTicketPrefill(result, receivedSerial)}
            onChanged={onTicketChanged}
          />
        </div>
      </div>
    </div>
  );
}

/** Compare & contrast two serials as aligned character rows — matching chars
 *  tinted, differing chars highlighted, so the difference is legible at a glance. */
function SerialContrast({ received, shipped }: { received: string | null; shipped: string | null }) {
  const diff = diffSerials(received, shipped);
  return (
    <div className="space-y-1.5 rounded-lg bg-surface-canvas px-2.5 py-2 ring-1 ring-inset ring-border-soft">
      <SerialContrastRow label="Received" cells={diff.received} present={Boolean((received ?? '').trim())} />
      <SerialContrastRow label="Shipped" cells={diff.shipped} present={Boolean((shipped ?? '').trim())} />
    </div>
  );
}

function SerialContrastRow({
  label,
  cells,
  present,
}: {
  label: string;
  cells: SerialDiffCell[];
  present: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-1 w-14 shrink-0 text-eyebrow font-black uppercase tracking-widest text-text-faint">
        {label}
      </span>
      {!present || cells.length === 0 ? (
        <span className="font-mono text-caption text-text-faint">—</span>
      ) : (
        <span className="flex flex-wrap gap-0.5">
          {cells.map((c, i) => (
            <span
              key={i}
              className={`inline-flex h-5 min-w-[1.15ch] items-center justify-center rounded px-0.5 font-mono text-caption font-bold ${
                c.match
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-300'
              }`}
            >
              {c.ch}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

/** Log the received serial INTO the system for investigation (find-or-create
 *  serial_units + an investigate note). Disabled until a serial is entered. */
function LogSerialButton({
  receivingId,
  lineId,
  serial,
  orderNumber,
  shippedSerial,
  serialMatch,
}: {
  receivingId: number | null;
  lineId: number | null;
  serial: string | null;
  orderNumber: string | null;
  shippedSerial: string | null;
  serialMatch: SerialCompareOutcome;
}) {
  const [status, setStatus] = useState<'idle' | 'logging' | 'logged'>('idle');
  const trimmed = (serial ?? '').trim();

  const log = async () => {
    if (!trimmed || status !== 'idle') return;
    setStatus('logging');
    try {
      const res = await fetch('/api/receiving/log-serial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': safeRandomUUID() },
        body: JSON.stringify({
          serial_number: trimmed,
          receiving_id: receivingId,
          receiving_line_id: lineId,
          order_number: orderNumber,
          shipped_serial: shippedSerial,
          serial_match: serialMatch,
          client_event_id: safeRandomUUID(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        toast.error(data?.error || 'Could not log the serial');
        setStatus('idle');
        return;
      }
      toast.success(
        data.paired_to_line
          ? data.already_attached
            ? 'Serial already paired to this line'
            : 'Serial paired to the line & flagged unfound'
          : 'Serial logged to the system for investigation',
      );
      setStatus('logged');
      // Reflect the newly-paired serial on the carton/line surfaces.
      if (data.paired_to_line) {
        window.dispatchEvent(new CustomEvent('usav-refresh-data'));
        if (lineId != null) {
          window.dispatchEvent(
            new CustomEvent('receiving-line-updated', { detail: { id: lineId } }),
          );
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error');
      setStatus('idle');
    }
  };

  return (
    <HoverTooltip
      label="Add this serial to the system and flag it for investigation"
      asChild
      focusable={false}
    >
      <Button
        type="button"
        variant="secondary"
        size="sm"
        loading={status === 'logging'}
        disabled={!trimmed || status !== 'idle'}
        onClick={() => void log()}
        className="shrink-0 gap-1.5 rounded-lg px-3"
        icon={status === 'logged' ? <Check className="h-4 w-4" /> : <Database className="h-4 w-4" />}
      >
        <span className="text-caption font-bold">{status === 'logged' ? 'Logged' : 'Log serial'}</span>
      </Button>
    </HoverTooltip>
  );
}

/* ─────────────────────────── support ticket popover ─────────────────────────── */

/**
 * "Ticket" → popover with the support ticket INLINE. Reply on the linked Zendesk
 * ticket (reuses {@link ClaimTicketReply} + {@link useClaimTicketReply}) or
 * create a new one from the serial-compare summary — no full modal.
 */
function SupportTicketPopover({
  receivingId,
  lineId,
  providerTicketId,
  ticketNumber,
  ticketUrl,
  prefill,
  onChanged,
}: {
  receivingId: number | null;
  lineId: number | null;
  providerTicketId: number | null;
  ticketNumber: string | null;
  ticketUrl: string | null;
  prefill: string;
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const hasTicket = providerTicketId != null;
  const [mode, setMode] = useState<'reply' | 'create'>(hasTicket ? 'reply' : 'create');

  // Keep the mode consistent with linkage as it changes (e.g. after a create).
  useEffect(() => {
    setMode(hasTicket ? 'reply' : 'create');
  }, [hasTicket]);

  return (
    <>
      <Button
        ref={anchorRef}
        type="button"
        variant="secondary"
        size="sm"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="shrink-0 gap-1.5 rounded-lg px-3"
        icon={<MessageSquare className="h-4 w-4 shrink-0" />}
      >
        <span className="text-caption font-bold">{hasTicket ? 'Ticket' : 'File ticket'}</span>
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} placement="bottom-end">
        <div
          role="dialog"
          aria-label="Support ticket"
          className="w-[340px] max-w-[calc(100vw-24px)] space-y-2.5 p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <MessageSquare className="h-4 w-4 shrink-0 text-orange-500" />
              <span className="truncate text-caption font-bold text-text-default">
                {hasTicket ? `Ticket ${ticketNumber ?? ''}`.trim() : 'New support ticket'}
              </span>
            </div>
            {hasTicket && ticketUrl ? (
              <HoverTooltip label="Open in Zendesk" asChild>
                <a
                  href={ticketUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open in Zendesk"
                  className="rounded-md p-1 text-text-faint transition hover:bg-surface-sunken hover:text-text-muted"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </HoverTooltip>
            ) : null}
          </div>

          {hasTicket ? (
            <PaneHeaderTabs<'reply' | 'create'>
              tabs={[
                { value: 'reply', label: 'Reply' },
                { value: 'create', label: 'New ticket' },
              ]}
              value={mode}
              onChange={setMode}
              className="rounded-lg border border-border-soft px-1 py-0.5"
            />
          ) : null}

          {mode === 'reply' && providerTicketId != null ? (
            <TicketReplyInline
              open={open}
              ticketId={providerTicketId}
              ticketNumber={ticketNumber ?? `#${providerTicketId}`}
              ticketUrl={ticketUrl}
            />
          ) : (
            <TicketCreateInline
              receivingId={receivingId}
              lineId={lineId}
              prefill={prefill}
              onCreated={() => {
                onChanged?.();
                setOpen(false);
              }}
            />
          )}
        </div>
      </Popover>
    </>
  );
}

/** Reply composer — reuses the shared claim reply hook + presentational form. */
function TicketReplyInline({
  open,
  ticketId,
  ticketNumber,
  ticketUrl,
}: {
  open: boolean;
  ticketId: number;
  ticketNumber: string;
  ticketUrl: string | null;
}) {
  const reply = useClaimTicketReply({ open, ticketId });
  const filedTicket: FiledTicket = { id: ticketId, number: ticketNumber, url: ticketUrl ?? null };
  return <ClaimTicketReply reply={reply} filedTicket={filedTicket} />;
}

/**
 * Create a support ticket inline from the compare summary. Posts to the same
 * receiving claim route the modal uses (claimType 'return'); on success the
 * caller refetches the ticket link so the popover flips to reply mode.
 */
function TicketCreateInline({
  receivingId,
  lineId,
  prefill,
  onCreated,
}: {
  receivingId: number | null;
  lineId: number | null;
  prefill: string;
  onCreated: () => void;
}) {
  const [body, setBody] = useState(prefill);
  const [isPublic, setIsPublic] = useState(false);
  const [sending, setSending] = useState(false);

  // Re-seed the draft when the compare (hence prefill) changes.
  useEffect(() => setBody(prefill), [prefill]);

  const create = async () => {
    const text = body.trim();
    if (sending || receivingId == null) return;
    setSending(true);
    try {
      const res = await fetch('/api/receiving/zendesk-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': safeRandomUUID() },
        body: JSON.stringify({
          receivingId,
          lineId,
          claimType: 'return',
          description: text || undefined,
          notePublic: isPublic,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        toast.error(data?.error || 'Could not create the ticket');
        return;
      }
      toast.success(`Ticket ${data.ticketNumber ?? ''} created`.trim());
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="space-y-2">
      <PaneHeaderTabs<'internal' | 'public'>
        tabs={[
          { value: 'internal', label: 'Internal' },
          { value: 'public', label: 'Email customer' },
        ]}
        value={isPublic ? 'public' : 'internal'}
        onChange={(next) => setIsPublic(next === 'public')}
        className="rounded-lg border border-border-soft px-1 py-0.5"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={5}
        placeholder="Ticket details…"
        className="block w-full resize-y rounded-lg border border-border-default bg-surface-card px-3 py-2 text-caption font-medium leading-snug text-text-default outline-none focus:border-border-emphasis focus:ring-2 focus:ring-text-soft/20"
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-mini font-semibold text-text-faint">
          {isPublic ? 'Emails the customer.' : 'Private note — no email sent.'}
        </p>
        <Button
          variant="primary"
          size="sm"
          icon={<Send className="h-4 w-4" />}
          loading={sending}
          onClick={() => void create()}
          disabled={receivingId == null}
        >
          Create ticket
        </Button>
      </div>
    </section>
  );
}

/* ─────────────────────────── shared bits ─────────────────────────── */

const LINE_TONE: Record<'success' | 'danger' | 'warning' | 'neutral', string> = {
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  danger: 'bg-rose-50 text-rose-700 ring-rose-200',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200',
  neutral: 'bg-surface-canvas text-text-muted ring-border-soft',
};

function CompareLine({
  tone,
  icon: Icon,
  text,
}: {
  tone: 'success' | 'danger' | 'warning' | 'neutral';
  icon: IconComponent;
  text: string;
}) {
  return (
    <div
      className={`flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-caption ring-1 ring-inset ${LINE_TONE[tone]}`}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 font-semibold">{text}</span>
    </div>
  );
}

function MergedNotice({ state }: { state: RefetchState }) {
  if (!state.message) return null;

  const tone =
    state.status === 'matched'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : state.status === 'error' || state.status === 'unsupported'
        ? 'bg-rose-50 text-rose-700 ring-rose-200'
        : 'bg-surface-canvas text-text-muted ring-border-soft';
  const Icon =
    state.status === 'matched'
      ? Check
      : state.status === 'error' || state.status === 'unsupported'
        ? AlertTriangle
        : Info;

  return (
    <div
      className={`flex items-start gap-2 rounded-lg px-3 py-2 text-caption ring-1 ring-inset ${tone}`}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0">{state.message}</span>
    </div>
  );
}
