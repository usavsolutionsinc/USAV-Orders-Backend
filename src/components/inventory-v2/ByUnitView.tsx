'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, ExternalLink } from '@/components/Icons';
import { EventRow } from './EventRow';
import type { SerialUnitDetailPayload } from './types';

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
                const res = await fetch(`/api/serial-units/${encodeURIComponent(ref)}`, {
                    credentials: 'same-origin',
                });
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

    const { serial_unit: unit, events } = payload;
    const status = unit.current_status;
    const adminHref = `/admin/inventory-v2/units/${unit.id}`;

    return (
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
            <header className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-2 text-xs text-gray-500">
                        <span className="font-mono">#{unit.id}</span>
                        <span className="font-mono text-gray-700">{unit.serial_number}</span>
                    </div>
                    <h1 className="mt-1 truncate text-lg font-semibold text-gray-900">
                        {unit.product_title || unit.sku || 'Unknown SKU'}
                    </h1>
                </div>
                <Link
                    href={adminHref}
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                >
                    Open full timeline
                    <ExternalLink className="h-3 w-3" />
                </Link>
            </header>

            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                <Field label="Status" value={status} mono />
                <Field label="Condition" value={unit.condition_grade} mono />
                <Field label="Location" value={unit.current_location} mono />
                <Field
                    label="SKU"
                    value={unit.sku}
                    mono
                    link={unit.sku ? `/inventory?sku=${encodeURIComponent(unit.sku)}` : null}
                />
            </dl>

            <section className="mt-6">
                <h2 className="mb-2 px-1 text-sm font-semibold text-gray-900">
                    Recent activity ({events.length})
                </h2>
                {events.length === 0 ? (
                    <p className="px-1 text-xs text-gray-400">No events for this unit yet.</p>
                ) : (
                    <ul role="list" className="rounded-md border border-gray-200 bg-white">
                        {events.map((event) => <EventRow key={event.id} event={event} />)}
                    </ul>
                )}
            </section>
        </div>
    );
}

interface FieldProps {
    label: string;
    value: string | null;
    mono?: boolean;
    link?: string | null;
}

function Field({ label, value, mono, link }: FieldProps) {
    return (
        <div>
            <dt className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                {label}
            </dt>
            <dd className={`mt-0.5 ${mono ? 'font-mono' : ''} ${value ? 'text-gray-900' : 'text-gray-400'}`}>
                {value && link ? (
                    <Link href={link} className="text-blue-700 hover:underline">
                        {value}
                    </Link>
                ) : (
                    value || '—'
                )}
            </dd>
        </div>
    );
}
