'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from '@/components/Icons';
import type {
    SerialUnitDetailPayload,
    TimelineEventRow,
    ConditionHistoryRow,
    AllocationRow,
    TsnLinkRow,
} from './types';

interface ByUnitViewProps {
    /** Either a numeric serial_units.id or a serial_number string. */
    ref: string;
}

export function ByUnitView({ ref }: ByUnitViewProps) {
    const [payload, setPayload] = useState<SerialUnitDetailPayload | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        const run = async () => {
            try {
                const res = await fetch(
                    `/api/serial-units/${encodeURIComponent(ref)}?include=full`,
                    { credentials: 'same-origin' },
                );
                if (!res.ok) {
                    let message = `HTTP ${res.status}`;
                    try {
                        const body = await res.json();
                        if (body?.error) message = body.error;
                    } catch {
                        // ignore JSON parse failure
                    }
                    throw new Error(message);
                }
                const data: SerialUnitDetailPayload = await res.json();
                if (!cancelled) setPayload(data);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Failed to load unit';
                if (!cancelled) setError(message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        run();
        return () => {
            cancelled = true;
        };
    }, [ref]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-16 text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="ml-2 text-sm">Loading unit {ref}…</span>
            </div>
        );
    }

    if (error || !payload?.success) {
        return (
            <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
                <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error || `Unit "${ref}" not found.`}
                </div>
            </div>
        );
    }

    const { serial_unit: unit } = payload;
    const events: TimelineEventRow[] = payload.events_full ?? [];
    const conditions: ConditionHistoryRow[] = payload.conditions ?? [];
    const allocations: AllocationRow[] = payload.allocations ?? [];
    const tsnLinks: TsnLinkRow[] = payload.tsn_links ?? [];

    return (
        <div className="mx-auto max-w-5xl space-y-8 px-4 py-6 sm:px-6">
            <header className="space-y-2">
                <div className="flex flex-wrap items-baseline gap-4">
                    <h1 className="font-mono text-2xl font-semibold text-gray-900">
                        {unit.serial_number}
                    </h1>
                    <StatusBadge status={unit.current_status} />
                    {unit.condition_grade ? (
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                            {unit.condition_grade}
                        </span>
                    ) : null}
                </div>
                {unit.product_title ? (
                    <p className="text-sm text-gray-700">{unit.product_title}</p>
                ) : null}
                <p className="text-xs text-gray-500">
                    serial_units.id = <code>{unit.id}</code> · normalized = <code>{unit.normalized_serial}</code>
                </p>
            </header>

            {/* Current state */}
            <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
                <header className="border-b border-gray-100 px-6 py-4">
                    <h2 className="text-lg font-medium text-gray-900">Current state</h2>
                </header>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-6 py-4 text-sm md:grid-cols-3">
                    <Field label="SKU">
                        {unit.sku ? (
                            <Link
                                href={`/inventory?sku=${encodeURIComponent(unit.sku)}`}
                                className="text-blue-600 hover:underline"
                            >
                                {unit.sku}
                            </Link>
                        ) : (
                            '—'
                        )}
                    </Field>
                    <Field label="Location">{unit.current_location ?? '—'}</Field>
                    <Field label="Origin">{unit.origin_source ?? '—'}</Field>
                    <Field label="Received at">
                        {unit.received_at ? new Date(unit.received_at).toLocaleString() : '—'}
                    </Field>
                    <Field label="Receiving line">{unit.origin_receiving_line_id ?? '—'}</Field>
                    <Field label="Origin TSN">{unit.origin_tsn_id ?? '—'}</Field>
                    <Field label="Shipment id">{unit.shipment_id ?? '—'}</Field>
                    <Field label="Tracking">{unit.shipping_tracking_number ?? '—'}</Field>
                    <Field label="Updated at">{new Date(unit.updated_at).toLocaleString()}</Field>
                </dl>
                {unit.notes ? (
                    <div className="border-t border-gray-100 px-6 py-3 text-sm text-gray-700">
                        <span className="text-xs uppercase tracking-wide text-gray-500">Notes</span>
                        <p className="mt-1 whitespace-pre-wrap">{unit.notes}</p>
                    </div>
                ) : null}
            </section>

            {/* Timeline */}
            <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
                <header className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
                    <h2 className="text-lg font-medium text-gray-900">inventory_events timeline</h2>
                    <span className="text-xs text-gray-500">{events.length} events</span>
                </header>
                {events.length === 0 ? (
                    <p className="px-6 py-4 text-sm text-gray-600">
                        No events recorded yet. Events land when a flagged path writes for this unit.
                    </p>
                ) : (
                    <ol className="divide-y divide-gray-100">
                        {events.map((e) => (
                            <li key={e.id} className="px-6 py-3">
                                <div className="flex flex-wrap items-baseline gap-3">
                                    <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700">
                                        {e.event_type}
                                    </code>
                                    <span className="text-xs text-gray-500">
                                        {new Date(e.occurred_at).toLocaleString()}
                                    </span>
                                    {e.station ? (
                                        <span className="text-xs text-gray-600">{e.station}</span>
                                    ) : null}
                                    {e.prev_status || e.next_status ? (
                                        <span className="text-xs">
                                            <StatusBadge status={e.prev_status} /> →{' '}
                                            <StatusBadge status={e.next_status} />
                                        </span>
                                    ) : null}
                                    {e.bin_name ? (
                                        <span className="text-xs text-gray-600">bin {e.bin_name}</span>
                                    ) : null}
                                    <span className="ml-auto text-xs text-gray-500">
                                        {e.actor_name ??
                                            (e.actor_staff_id ? `#${e.actor_staff_id}` : 'system')}
                                    </span>
                                </div>
                                {e.notes ? (
                                    <p className="mt-1 text-sm text-gray-700">{e.notes}</p>
                                ) : null}
                                {e.payload && Object.keys(e.payload).length > 0 ? (
                                    <pre className="mt-2 overflow-x-auto rounded bg-gray-50 px-3 py-2 text-xs text-gray-700">
                                        {JSON.stringify(e.payload, null, 2)}
                                    </pre>
                                ) : null}
                                {e.client_event_id ? (
                                    <p className="mt-1 text-micro text-gray-400">
                                        client_event_id: <code>{e.client_event_id}</code>
                                        {e.stock_ledger_id ? ` · stock_ledger_id: ${e.stock_ledger_id}` : ''}
                                    </p>
                                ) : null}
                            </li>
                        ))}
                    </ol>
                )}
            </section>

            {/* Condition history */}
            {conditions.length > 0 ? (
                <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
                    <header className="border-b border-gray-100 px-6 py-4">
                        <h2 className="text-lg font-medium text-gray-900">Condition history</h2>
                    </header>
                    <ol className="divide-y divide-gray-100 text-sm">
                        {conditions.map((c) => (
                            <li key={c.id} className="flex flex-wrap items-baseline gap-3 px-6 py-3">
                                <span className="text-xs text-gray-500">
                                    {new Date(c.assessed_at).toLocaleString()}
                                </span>
                                <span className="text-xs text-gray-700">
                                    <code className="rounded bg-gray-100 px-1.5 py-0.5">
                                        {c.prev_grade ?? '—'}
                                    </code>{' '}
                                    →{' '}
                                    <code className="rounded bg-gray-100 px-1.5 py-0.5">{c.new_grade}</code>
                                </span>
                                <span className="ml-auto text-xs text-gray-500">
                                    {c.assessed_by_name ??
                                        (c.assessed_by_staff_id ? `#${c.assessed_by_staff_id}` : 'system')}
                                </span>
                                {c.cosmetic_notes || c.functional_notes ? (
                                    <div className="basis-full text-sm text-gray-700">
                                        {c.cosmetic_notes ? <p>cosmetic: {c.cosmetic_notes}</p> : null}
                                        {c.functional_notes ? <p>functional: {c.functional_notes}</p> : null}
                                    </div>
                                ) : null}
                            </li>
                        ))}
                    </ol>
                </section>
            ) : null}

            {/* Allocations */}
            {allocations.length > 0 ? (
                <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
                    <header className="border-b border-gray-100 px-6 py-4">
                        <h2 className="text-lg font-medium text-gray-900">Order allocations</h2>
                    </header>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-100 text-sm">
                            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                                <tr>
                                    <th className="px-6 py-2 text-left font-medium">Order</th>
                                    <th className="px-6 py-2 text-left font-medium">Allocated</th>
                                    <th className="px-6 py-2 text-left font-medium">State</th>
                                    <th className="px-6 py-2 text-left font-medium">Released</th>
                                    <th className="px-6 py-2 text-left font-medium">Reason</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {allocations.map((a) => (
                                    <tr key={a.id}>
                                        <td className="px-6 py-2 font-mono text-xs">#{a.order_id}</td>
                                        <td className="px-6 py-2 text-xs text-gray-500">
                                            {new Date(a.allocated_at).toLocaleString()}
                                        </td>
                                        <td className="px-6 py-2">
                                            <StatusBadge status={a.state} />
                                        </td>
                                        <td className="px-6 py-2 text-xs text-gray-500">
                                            {a.released_at
                                                ? new Date(a.released_at).toLocaleString()
                                                : '—'}
                                        </td>
                                        <td className="px-6 py-2 text-xs text-gray-600">
                                            {a.released_reason ?? '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            ) : null}

            {/* TSN cross-refs */}
            {tsnLinks.length > 0 ? (
                <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
                    <header className="border-b border-gray-100 px-6 py-4">
                        <h2 className="text-lg font-medium text-gray-900">tech_serial_numbers links</h2>
                        <p className="mt-1 text-xs text-gray-500">
                            Legacy audit table. Helpful when joining v1 tech-station logs to v2 lifecycle.
                        </p>
                    </header>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-100 text-sm">
                            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                                <tr>
                                    <th className="px-6 py-2 text-left font-medium">TSN id</th>
                                    <th className="px-6 py-2 text-left font-medium">When</th>
                                    <th className="px-6 py-2 text-left font-medium">Station</th>
                                    <th className="px-6 py-2 text-left font-medium">Type</th>
                                    <th className="px-6 py-2 text-left font-medium">Shipment</th>
                                    <th className="px-6 py-2 text-left font-medium">Tested by</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {tsnLinks.map((t) => (
                                    <tr key={t.id}>
                                        <td className="px-6 py-2 font-mono text-xs">{t.id}</td>
                                        <td className="px-6 py-2 text-xs text-gray-500">
                                            {new Date(t.created_at).toLocaleString()}
                                        </td>
                                        <td className="px-6 py-2 text-xs">{t.station_source ?? '—'}</td>
                                        <td className="px-6 py-2 text-xs">{t.serial_type}</td>
                                        <td className="px-6 py-2 text-xs">{t.shipment_id ?? '—'}</td>
                                        <td className="px-6 py-2 text-xs">{t.tested_by_name ?? '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            ) : null}
        </div>
    );
}

interface FieldProps {
    label: string;
    children: React.ReactNode;
}

function Field({ label, children }: FieldProps) {
    return (
        <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
            <dd className="mt-0.5 text-sm text-gray-900">{children}</dd>
        </div>
    );
}

function StatusBadge({ status }: { status: string | null }) {
    if (!status) return <span className="text-xs text-gray-400">—</span>;
    const palette: Record<string, string> = {
        UNKNOWN: 'bg-gray-100 text-gray-600',
        RECEIVED: 'bg-blue-100 text-blue-700',
        TRIAGED: 'bg-blue-100 text-blue-700',
        IN_TEST: 'bg-indigo-100 text-indigo-700',
        IN_REPAIR: 'bg-amber-100 text-amber-700',
        REPAIR_DONE: 'bg-amber-100 text-amber-700',
        GRADED: 'bg-emerald-100 text-emerald-700',
        TESTED: 'bg-emerald-100 text-emerald-700',
        STOCKED: 'bg-green-100 text-green-700',
        ALLOCATED: 'bg-purple-100 text-purple-700',
        PICKED: 'bg-purple-100 text-purple-700',
        PACKED: 'bg-purple-100 text-purple-700',
        LABELED: 'bg-purple-100 text-purple-700',
        STAGED: 'bg-purple-100 text-purple-700',
        SHIPPED: 'bg-gray-200 text-gray-700',
        RETURNED: 'bg-orange-100 text-orange-700',
        RMA: 'bg-orange-100 text-orange-700',
        ON_HOLD: 'bg-red-100 text-red-700',
        SCRAPPED: 'bg-red-100 text-red-700',
    };
    return (
        <span
            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                palette[status] ?? 'bg-gray-100 text-gray-600'
            }`}
        >
            {status}
        </span>
    );
}
