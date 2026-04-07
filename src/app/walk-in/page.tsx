'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { RepairTable } from '@/components/repair';
import { SalesTable } from '@/components/walk-in/SalesTable';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';

type WalkInMode = 'repairs' | 'sales';

function WalkInPageContent() {
    const searchParams = useSearchParams();
    const mode: WalkInMode = searchParams.get('mode') === 'sales' ? 'sales' : 'repairs';

    // For repair mode, read the sub-tab
    const rawTab = searchParams.get('tab');
    const repairTab = rawTab === 'incoming' ? 'incoming' : rawTab === 'done' ? 'done' : 'active';

    useRealtimeInvalidation({ repair: mode === 'repairs', walkIn: mode === 'sales' });

    return (
        <div className="flex h-full w-full bg-white">
            <div className="flex-1 flex flex-col min-w-0">
                {mode === 'repairs' ? (
                    <RepairTable filter={repairTab} />
                ) : (
                    <SalesTable />
                )}
            </div>
        </div>
    );
}

export default function WalkInPage() {
    return (
        <Suspense fallback={
            <div className="flex h-full w-full items-center justify-center bg-gray-50">
                <LoadingSpinner size="lg" className="text-emerald-600" />
            </div>
        }>
            <WalkInPageContent />
        </Suspense>
    );
}
