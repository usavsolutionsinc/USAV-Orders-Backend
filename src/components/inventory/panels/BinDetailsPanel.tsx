'use client';

import { ByBinView } from '@/components/inventory/ByBinView';
import { InventoryDetailPanelShell } from './InventoryDetailPanelShell';

export interface BinDetailsPanelProps {
    barcode: string;
    onClose?: () => void;
}

export function BinDetailsPanel({ barcode, onClose }: BinDetailsPanelProps) {
    return (
        <InventoryDetailPanelShell
            eyebrow="Bin"
            title={barcode}
            onClose={onClose}
        >
            <ByBinView barcode={barcode} />
        </InventoryDetailPanelShell>
    );
}
