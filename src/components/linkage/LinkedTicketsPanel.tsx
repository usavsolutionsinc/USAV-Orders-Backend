'use client';

/**
 * LinkedTicketsPanel — the closed-loop linkage display: given any one of
 * {order#, tracking#, serial#}, render the composed loop (order ↔ tracking[] ↔
 * serial[]) plus the Zendesk support tickets linked anywhere on it.
 *
 * Reused verbatim on the packing station and receiving surfaces. It is a dumb
 * display: it fetches `/api/order-linkage` and renders through the CopyChip SoT
 * (OrderIdChip / TrackingChip / SerialChip / TicketChip) — no linkage logic
 * lives here (that is `src/lib/order-linkage.ts`).
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OrderLinkage } from '@/lib/order-linkage';
import { OrderIdChip, TrackingChip, SerialChip, TicketChip } from '@/components/ui/CopyChip';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

interface LinkedTicketsPanelProps {
  order?: string | null;
  tracking?: string | null;
  serial?: string | null;
  /** Compact variant for tight sidebars (smaller header, tighter gaps). */
  dense?: boolean;
  /**
   * Render nothing until a real linked order resolves (no header, no empty box).
   * Use on surfaces where most rows have no outbound loop — e.g. receiving,
   * where only a returned serial resolves — so the panel stays silent otherwise.
   */
  hideWhenEmpty?: boolean;
  className?: string;
}

/** Debounce a value so live-typed identifiers (e.g. a serial being scanned) do
 *  not fire a resolve request on every keystroke. */
function useDebounced<T>(value: T, ms = 400): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

const last4 = (v: string | null | undefined): string => {
  const s = String(v ?? '').trim();
  return s.length <= 4 ? s || '—' : s.slice(-4);
};

function statusDotClass(status: string | null): string {
  const s = (status ?? '').toLowerCase();
  if (s.includes('solved') || s.includes('closed')) return 'bg-emerald-500';
  if (s.includes('pending')) return 'bg-amber-500';
  if (s.includes('open') || s.includes('new')) return 'bg-rose-500';
  return 'bg-surface-strong';
}

export function LinkedTicketsPanel({
  order,
  tracking,
  serial,
  dense = false,
  hideWhenEmpty = false,
  className = '',
}: LinkedTicketsPanelProps) {
  const dOrder = useDebounced((order ?? '').trim());
  const dTracking = useDebounced((tracking ?? '').trim());
  const dSerial = useDebounced((serial ?? '').trim());
  const enabled = Boolean(dOrder || dTracking || dSerial);

  const { data, isLoading, isError } = useQuery<OrderLinkage>({
    queryKey: ['order-linkage', dOrder, dTracking, dSerial],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dOrder) params.set('order', dOrder);
      if (dTracking) params.set('tracking', dTracking);
      if (dSerial) params.set('serial', dSerial);
      const res = await fetch(`/api/order-linkage?${params.toString()}`);
      if (!res.ok) throw new Error(`order-linkage ${res.status}`);
      const json = await res.json();
      return json.linkage as OrderLinkage;
    },
  });

  if (!enabled) return null;
  // Silent on surfaces where most rows have no outbound loop (receiving).
  if (hideWhenEmpty && (!data || !data.order)) return null;

  const headerCls = dense
    ? 'text-eyebrow font-black uppercase tracking-widest text-text-soft'
    : 'text-eyebrow font-black uppercase tracking-widest text-text-soft';

  return (
    <section className={`space-y-2 ${className}`}>
      <p className={headerCls}>Linkage</p>

      {isLoading && (
        <div className="text-caption text-text-faint">Resolving links…</div>
      )}

      {isError && (
        <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-3 py-2 text-center text-caption text-rose-600">
          Could not resolve linkage.
        </div>
      )}

      {!isLoading && !isError && data && !data.order && (
        <div className="rounded-xl border border-dashed border-border-soft bg-surface-canvas px-3 py-2 text-center text-caption text-text-faint">
          No linked order found.
        </div>
      )}

      {!isLoading && !isError && data?.order && (
        <div className="space-y-2">
          {/* The loop: order ↔ tracking[] ↔ serial[] */}
          <div className="flex flex-wrap items-center gap-1.5">
            {data.order.orderId && (
              <OrderIdChip value={data.order.orderId} display={data.order.orderId} dense />
            )}
            {data.trackings.map((t) =>
              t.tracking ? (
                <TrackingChip
                  key={t.shipmentId}
                  value={t.tracking}
                  display={last4(t.tracking)}
                  dense
                />
              ) : null,
            )}
            {data.serials.map((s, i) => (
              <SerialChip key={`${s.serialUnitId ?? 'tsn'}-${i}`} value={s.serial} dense />
            ))}
          </div>

          {/* Linked Zendesk tickets */}
          {data.tickets.length === 0 ? (
            <div className="text-caption text-text-faint">No linked tickets.</div>
          ) : (
            <ul className="divide-y divide-border-hairline">
              {data.tickets.map((tk) => (
                <li key={tk.zendeskTicketId ?? tk.supportTicketId ?? tk.label} className="flex items-center gap-2 py-1.5">
                  <HoverTooltip label={tk.status ?? 'unknown status'} asChild focusable={false}>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass(tk.status)}`} />
                  </HoverTooltip>
                  {tk.openUrl ? (
                    <a
                      href={tk.openUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0"
                    >
                      <TicketChip value={tk.label} display={tk.label} />
                    </a>
                  ) : (
                    <TicketChip value={tk.label} display={tk.label} />
                  )}
                  {tk.subject && (
                    <span className="truncate text-caption text-text-muted">{tk.subject}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export default LinkedTicketsPanel;
