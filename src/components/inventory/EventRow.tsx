'use client';

import Link from 'next/link';
import type { PulseEventRow } from './types';
import { inventoryStatusBadgeClass } from './status-classes';

interface EventRowProps {
    event: PulseEventRow;
}

function statusBadgeClass(status: string | null): string {
    if (!status) return 'bg-gray-100 text-gray-500';
    return inventoryStatusBadgeClass(status);
}

function relativeTime(iso: string): string {
    const date = new Date(iso);
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (Number.isNaN(diffMin)) return '—';
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`;
    if (diffMin < 10080) return `${Math.floor(diffMin / 1440)}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function EventRow({ event }: EventRowProps) {
    const occurred = new Date(event.occurred_at);
    const absoluteTime = Number.isNaN(occurred.getTime())
        ? ''
        : occurred.toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
          });

    const skuHref = event.sku ? `/inventory?sku=${encodeURIComponent(event.sku)}` : null;
    const binHref = event.bin_name ? `/inventory?bin=${encodeURIComponent(event.bin_name)}` : null;
    const unitHref =
        event.serial_unit_id != null
            ? `/admin/inventory/units/${event.serial_unit_id}`
            : null;

    return (
        <li className="flex items-start gap-3 border-b border-gray-100 px-4 py-2.5 hover:bg-blue-50/40 sm:px-6">
            <div className="w-16 shrink-0 text-right text-caption text-gray-400" title={absoluteTime}>
                {relativeTime(event.occurred_at)}
            </div>

            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-micro uppercase tracking-wide text-gray-700">
                        {event.event_type}
                    </span>
                    {event.prev_status || event.next_status ? (
                        <span className="flex items-center gap-1 text-caption text-gray-500">
                            {event.prev_status ? (
                                <span className={`rounded px-1.5 py-0.5 ${statusBadgeClass(event.prev_status)}`}>
                                    {event.prev_status}
                                </span>
                            ) : null}
                            {event.prev_status && event.next_status ? <span>→</span> : null}
                            {event.next_status ? (
                                <span className={`rounded px-1.5 py-0.5 ${statusBadgeClass(event.next_status)}`}>
                                    {event.next_status}
                                </span>
                            ) : null}
                        </span>
                    ) : null}
                </div>

                <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                    {skuHref ? (
                        <Link
                            href={skuHref}
                            className="truncate font-mono text-xs text-blue-700 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {event.sku}
                        </Link>
                    ) : null}
                    {unitHref ? (
                        <Link
                            href={unitHref}
                            className="font-mono text-xs text-gray-600 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                        >
                            #{event.serial_unit_id}
                            {event.serial_number ? ` · ${event.serial_number}` : ''}
                        </Link>
                    ) : null}
                    {binHref ? (
                        <Link
                            href={binHref}
                            className="text-xs text-gray-600 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {event.bin_name}
                            {event.prev_bin_name && event.prev_bin_name !== event.bin_name
                                ? ` (from ${event.prev_bin_name})`
                                : ''}
                        </Link>
                    ) : null}
                </div>

                {event.notes ? (
                    <div className="mt-1 truncate text-xs text-gray-500">{event.notes}</div>
                ) : null}
            </div>

            <div className="hidden shrink-0 text-right text-caption text-gray-400 sm:block">
                {event.actor_name || (event.station ? `[${event.station}]` : '')}
            </div>
        </li>
    );
}
