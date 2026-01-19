import { Suspense } from 'react';
import ShippedSidebar from '@/components/ShippedSidebar';
import { ShippedTable } from '@/components/shipped';
import { Loader2 } from '@/components/Icons';

export default function ShippedPage() {
    return (
        <div className="flex h-full w-full">
            {/* Keep existing ShippedSidebar for search */}
            <ShippedSidebar />
            
            {/* New ShippedTable component reading from Neon DB */}
            <Suspense fallback={
                <div className="flex-1 flex items-center justify-center bg-gray-50">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                </div>
            }>
                <ShippedTable />
            </Suspense>
        </div>
    );
}
