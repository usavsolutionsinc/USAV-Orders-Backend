'use client';

import {
    Activity,
    AlertTriangle,
    Barcode,
    Box,
    ClipboardList,
    FileText,
    Layers,
    Layout,
    List,
    MapPin,
    Package,
    Tool,
    User,
} from '@/components/Icons';
import { SearchBar } from '@/components/ui/SearchBar';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { microBadge } from '@/design-system/tokens/typography/presets';
import {
    INVENTORY_SEARCH_FIELDS,
    getInventorySearchHelperText,
    getInventorySearchPlaceholder,
    type AnyInventorySearchField,
    type InventoryTab,
} from '@/lib/inventory-search';

const FIELD_ICON: Record<string, HorizontalSliderItem['icon']> = {
    all: Layers,
    bin_barcode: Barcode,
    zone: MapPin,
    room: Layout,
    sku_contained: Barcode,
    sku: Barcode,
    product_title: FileText,
    brand: Layout,
    unit_id: List,
    serial_number: Tool,
    order_id: ClipboardList,
    tracking: Package,
    bin: Box,
    user: User,
    event_type: Activity,
    rule: AlertTriangle,
    campaign: ClipboardList,
    counter: User,
};

export interface InventoryScopedSearchBarProps {
    tab: InventoryTab;
    value: string;
    onChange: (next: string) => void;
    field: AnyInventorySearchField;
    onFieldChange: (next: AnyInventorySearchField) => void;
    isSearching?: boolean;
    autoFocus?: boolean;
    rightElement?: React.ReactNode;
}

export function InventoryScopedSearchBar({
    tab,
    value,
    onChange,
    field,
    onFieldChange,
    isSearching,
    autoFocus,
    rightElement,
}: InventoryScopedSearchBarProps) {
    const fields = INVENTORY_SEARCH_FIELDS[tab];
    const items: HorizontalSliderItem[] = fields.map((f) => ({
        id: f.id,
        label: f.label,
        icon: FIELD_ICON[f.id],
    }));

    return (
        <div className="space-y-3">
            <SearchBar
                value={value}
                onChange={onChange}
                placeholder={getInventorySearchPlaceholder(tab, field)}
                isSearching={isSearching}
                variant="blue"
                autoFocus={autoFocus}
                rightElement={rightElement}
            />
            <HorizontalButtonSlider
                items={items}
                value={field}
                onChange={(id) => onFieldChange(id as AnyInventorySearchField)}
                variant="nav"
                size="md"
                aria-label={`${tab} search field`}
            />
            <p className={`${microBadge} text-gray-500 px-1`}>
                {getInventorySearchHelperText(tab, field)}
            </p>
        </div>
    );
}
