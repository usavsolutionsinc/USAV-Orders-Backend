'use client';

import React from 'react';
import { useSearchParams } from 'next/navigation';
import ReceivingLinesTable from './station/ReceivingLinesTable';
import { LocalPickupCatalogPanel } from './work-orders/LocalPickupCatalogPanel';
import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';
import { useRealtimeToasts } from '@/hooks/useRealtimeToasts';

export default function ReceivingDashboard() {
    useRealtimeInvalidation({ receiving: true });
    useRealtimeToasts('receiving');
    const searchParams = useSearchParams();
    const mode = searchParams.get('mode') ?? 'receive';
    const isPickupMode = mode === 'pickup';

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
                            <ReceivingLinesTable />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
