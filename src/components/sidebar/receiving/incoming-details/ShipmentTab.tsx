import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Link2 } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { TrackingChip, getLast4 } from '@/components/ui/CopyChip';
import { EventTimeline } from '@/components/ui/EventTimeline';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { carrierEventsToTimeline } from '@/lib/timeline';
import { toast } from '@/lib/toast';
import { IncomingAttachTrackingPopover } from '@/components/sidebar/receiving/IncomingAttachTrackingPopover';
import {
  type DetailsResponse,
  deliveredAgoLabel,
  fmtDateTime,
  heroTone,
  prettyStatus,
  shortCarrier,
} from './incoming-details-shared';
import { Empty } from './incoming-details-primitives';

export function ShipmentTab({ data }: { data: DetailsResponse }) {
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

  if (!s) {
    const poId = (data.po?.zoho_purchaseorder_id || '').trim();
    return (
      <div className="space-y-3">
        <Empty msg="No shipment linked yet — the Zoho PO reference# is empty or hasn't resolved to a tracking number. Attach a tracking number below, or wait for the next sync run." />
        {poId ? (
          <div className="flex justify-center">
            <IncomingAttachTrackingPopover
              presetPo={{ poId, poNumber: data.po?.zoho_purchaseorder_number ?? null }}
              onAttached={() => {
                queryClient.invalidateQueries({ queryKey: ['incoming-details'] });
                queryClient.invalidateQueries({ queryKey: ['receiving-lines-table'] });
                queryClient.invalidateQueries({ queryKey: ['receiving-lines-incoming-summary'] });
              }}
              trigger={
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Link2 />}
                  className="border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                >
                  Add tracking
                </Button>
              }
            />
          </div>
        ) : null}
      </div>
    );
  }

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
            <div className="flex items-center gap-1 text-eyebrow font-black uppercase tracking-wider text-text-soft">
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
              <div className="mt-1 text-caption font-semibold text-text-muted">{subLine}</div>
            ) : null}
            <div className="mt-0.5 text-eyebrow font-semibold text-text-faint">
              Last checked {fmtDateTime(s.last_checked_at)}
            </div>
          </div>
          <HoverTooltip label="Force a fresh poll against the carrier API" asChild>
            <Button
              variant="brand"
              size="sm"
              icon={<RefreshCw />}
              loading={repolling}
              onClick={() => void repoll()}
              ariaLabel="Force a fresh poll against the carrier API"
              className="h-7 shrink-0 bg-none bg-surface-inverse px-2 text-white hover:bg-surface-inverse-hover"
            >
              {repolling ? 'Polling…' : 'Re-poll'}
            </Button>
          </HoverTooltip>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-eyebrow font-black uppercase tracking-wider text-text-soft">
          Recent carrier events
        </h3>
        <EventTimeline
          items={carrierEventsToTimeline(s.events)}
          emptyMessage="No carrier events yet."
        />
      </div>
    </div>
  );
}
