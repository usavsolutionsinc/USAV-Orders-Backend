'use client';

import { Suspense, useState, useEffect } from 'react';
import { ShippedTable } from '@/components/shipped';
import { Loader2 } from '@/components/Icons';

function ShippedPageContent() {
    const [refreshKey, setRefreshKey] = useState(0);

    useEffect(() => {
        const handleRefresh = () => setRefreshKey((prev) => prev + 1);
        window.addEventListener('dashboard-refresh', handleRefresh as any);
        window.addEventListener('usav-refresh-data', handleRefresh as any);
        return () => {
            window.removeEventListener('dashboard-refresh', handleRefresh as any);
            window.removeEventListener('usav-refresh-data', handleRefresh as any);
        };
    }, []);

    return (
        <div className="flex h-full w-full">
            <Suspense fallback={
                <div className="flex-1 flex items-center justify-center bg-gray-50">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                </div>
            }>
                <ShippedTable key={refreshKey} />
            </Suspense>
        </div>
    );
}

export default function ShippedPage() {
    return (
        <Suspense fallback={
            <div className="flex h-full w-full items-center justify-center bg-gray-50">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        }>
            <ShippedPageContent />
        </Suspense>
    );
}
