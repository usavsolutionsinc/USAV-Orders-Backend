'use client';

import dynamic from 'next/dynamic';
import { Loader2 } from '@/components/Icons';

// The legacy SkuDetailView is heavy (saves, stock adjust, event timeline).
// Lazy-load so the Pulse view stays light when nothing is selected.
const SkuDetailView = dynamic(() => import('@/components/sku/SkuDetailView'), {
    ssr: false,
    loading: () => (
        <div className="flex items-center justify-center py-16 text-text-faint">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="ml-2 text-sm">Loading SKU…</span>
        </div>
    ),
});

interface BySkuViewProps {
    sku: string;
}

export function BySkuView({ sku }: BySkuViewProps) {
    return <SkuDetailView sku={sku} variant="page" />;
}
