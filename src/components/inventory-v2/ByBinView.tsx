'use client';

import dynamic from 'next/dynamic';
import { Loader2 } from '@/components/Icons';

const LocationDetailView = dynamic(
    () => import('@/components/sku/LocationDetailView').then((mod) => mod.LocationDetailView),
    {
        ssr: false,
        loading: () => (
            <div className="flex items-center justify-center py-16 text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="ml-2 text-sm">Loading bin…</span>
            </div>
        ),
    },
);

interface ByBinViewProps {
    barcode: string;
}

export function ByBinView({ barcode }: ByBinViewProps) {
    return <LocationDetailView barcode={barcode} />;
}
