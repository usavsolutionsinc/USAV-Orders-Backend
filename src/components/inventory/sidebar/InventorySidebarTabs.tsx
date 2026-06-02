'use client';

import { Activity, AlertTriangle, Barcode, Box, ClipboardList, Tool } from '@/components/Icons';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import type { InventoryTab } from '@/lib/inventory-search';

const TAB_ITEMS: HorizontalSliderItem[] = [
    { id: 'activity', label: 'Activity', icon: Activity },
    { id: 'bins',     label: 'Bins',     icon: Box },
    { id: 'skus',     label: 'SKUs',     icon: Barcode },
    { id: 'units',    label: 'Units',    icon: Tool },
    { id: 'alerts',   label: 'Alerts',   icon: AlertTriangle },
    { id: 'counts',   label: 'Counts',   icon: ClipboardList },
];

export interface InventorySidebarTabsProps {
    value: InventoryTab;
    onChange: (tab: InventoryTab) => void;
    /** Optional per-tab unread badge (e.g. open alerts count). */
    badges?: Partial<Record<InventoryTab, number>>;
}

export function InventorySidebarTabs({ value, onChange, badges }: InventorySidebarTabsProps) {
    const items = TAB_ITEMS.map((item) =>
        badges?.[item.id as InventoryTab] && badges[item.id as InventoryTab]! > 0
            ? { ...item, badge: 'dot' as const }
            : item,
    );

    return (
        <HorizontalButtonSlider
            items={items}
            value={value}
            onChange={(id) => onChange(id as InventoryTab)}
            variant="nav"
            dense
            className="w-full"
            aria-label="Inventory tab"
        />
    );
}
