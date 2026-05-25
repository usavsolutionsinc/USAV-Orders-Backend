'use client';

import { BySkuView } from '@/components/inventory/BySkuView';
import { InventoryDetailPanelShell } from './InventoryDetailPanelShell';

export interface SkuDetailsPanelProps {
    sku: string;
    onClose?: () => void;
}

export function SkuDetailsPanel({ sku, onClose }: SkuDetailsPanelProps) {
    return (
        <InventoryDetailPanelShell
            eyebrow="SKU"
            title={sku}
            onClose={onClose}
        >
            <BySkuView sku={sku} />
        </InventoryDetailPanelShell>
    );
}
