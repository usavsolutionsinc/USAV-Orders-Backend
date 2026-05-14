'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import ReceivingLinesTable from './station/ReceivingLinesTable';
import { LocalPickupCatalogPanel } from './work-orders/LocalPickupCatalogPanel';
import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';
import { useRealtimeToasts } from '@/hooks/useRealtimeToasts';

export default function ReceivingDashboard() {
    const [activeReceivingId, setActiveReceivingId] = useState<number | null>(null);
    useRealtimeInvalidation({ receiving: true });
    useRealtimeToasts('receiving');
    const searchParams = useSearchParams();
    const mode = searchParams.get('mode') ?? 'receive';
    const isPickupMode = mode === 'pickup';

    useEffect(() => {
        const handlePoLoaded = (e: Event) => {
            const detail = (e as CustomEvent<{ receiving_id?: number }>).detail;
            if (detail?.receiving_id) setActiveReceivingId(detail.receiving_id);
        };
        const handleClear = () => setActiveReceivingId(null);

        window.addEventListener('receiving-po-loaded', handlePoLoaded);
        window.addEventListener('receiving-clear-line', handleClear);
        return () => {
            window.removeEventListener('receiving-po-loaded', handlePoLoaded);
            window.removeEventListener('receiving-clear-line', handleClear);
        };
    }, []);

    return (
        <div className="flex h-full w-full overflow-hidden bg-[linear-gradient(180deg,#f8fbfb_0%,#ffffff_16%)]">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <div className="flex min-h-0 flex-1 overflow-hidden">
                    {isPickupMode ? (
                        <div className="flex-1 min-w-0 overflow-hidden">
                            <LocalPickupCatalogPanel />
                        </div>
                    ) : (
                        <div className="flex-1 min-w-0 overflow-hidden">
                            <ReceivingLinesTable receivingId={activeReceivingId} />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
