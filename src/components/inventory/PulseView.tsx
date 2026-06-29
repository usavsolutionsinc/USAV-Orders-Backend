'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { EventRow } from './EventRow';
import type { PulseEventRow, PulseEventsResponse } from './types';

const PULSE_LIMIT = 50;
const REFRESH_INTERVAL_MS = 30_000;

export function PulseView() {
    const [events, setEvents] = useState<PulseEventRow[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [fetching, setFetching] = useState(false);
    const lastFetchRef = useRef<number>(0);

    const fetchEvents = async () => {
        setFetching(true);
        setError(null);
        try {
            const res = await fetch(`/api/inventory-events?limit=${PULSE_LIMIT}`, {
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
            const data: PulseEventsResponse = await res.json();
            setEvents(data.events);
            lastFetchRef.current = Date.now();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to load events';
            setError(message);
        } finally {
            setFetching(false);
        }
    };

    useEffect(() => {
        fetchEvents();
        const handle = window.setInterval(() => {
            // Only refetch when the document is visible — avoids burning
            // Neon CU when an operator's laptop is locked.
            if (document.visibilityState === 'visible') fetchEvents();
        }, REFRESH_INTERVAL_MS);
        return () => window.clearInterval(handle);
    }, []);

    if (events === null && fetching) {
        return (
            <div className="flex items-center justify-center py-16 text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="ml-2 text-sm">Loading recent activity…</span>
            </div>
        );
    }

    if (error && events === null) {
        return (
            <div className="mx-4 my-8 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:mx-6">
                {error}
            </div>
        );
    }

    return (
        <section>
            <header className="flex items-center justify-between px-4 py-2 sm:px-6">
                <div>
                    <h2 className="text-sm font-semibold text-gray-900">Recent activity</h2>
                    <p className="text-xs text-gray-500">
                        Last {events?.length ?? 0} inventory events · auto-refresh 30s
                    </p>
                </div>
                <Button
                    variant="secondary"
                    size="sm"
                    icon={<RefreshCw />}
                    loading={fetching}
                    onClick={fetchEvents}
                >
                    Refresh
                </Button>
            </header>

            {events && events.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-gray-400 sm:px-6">
                    No inventory events yet.
                </div>
            ) : (
                <ul role="list">
                    {events?.map((event) => <EventRow key={event.id} event={event} />)}
                </ul>
            )}
        </section>
    );
}
