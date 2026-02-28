'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { RepairTable } from '@/components/repair';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

function RepairPageContent() {
    const searchParams = useSearchParams();
    const activeTab = searchParams.get('tab') === 'done' ? 'done' : 'active';
    
    return (
        <div className="flex h-full w-full bg-white">
            <div className="flex-1 flex flex-col min-w-0">
                <RepairTable filter={activeTab} />
            </div>
        </div>
    );
}

export default function RepairPage() {
    return (
        <Suspense fallback={
            <div className="flex h-full w-full items-center justify-center bg-gray-50">
                <LoadingSpinner size="lg" className="text-blue-600" />
            </div>
        }>
            <RepairPageContent />
        </Suspense>
    );
}
