/**
 * Shared types + config for the tabbed inventory sidebar.
 *
 * Mirrors the shape of `shipped-search.ts` so the inventory and shipped
 * sidebars stay structurally aligned.
 */

export type InventoryTab =
  | 'activity'
  | 'bins'
  | 'skus'
  | 'units'
  | 'alerts'
  | 'counts'
  | 'triage'
  | 'pulse';

export const INVENTORY_TABS = ['activity', 'bins', 'skus', 'units', 'alerts', 'counts', 'triage', 'pulse'] as const;

// ─── Per-tab search-field unions ─────────────────────────────────────────────

export type BinSearchField = 'all' | 'bin_barcode' | 'zone' | 'room' | 'sku_contained';
export type SkuSearchField = 'all' | 'sku' | 'product_title' | 'brand';
export type UnitSearchField = 'all' | 'unit_id' | 'serial_number' | 'sku' | 'order_id' | 'tracking';
export type ActivitySearchField = 'all' | 'sku' | 'bin' | 'user' | 'event_type';
export type AlertSearchField = 'all' | 'sku' | 'bin' | 'rule';
export type CountSearchField = 'all' | 'campaign' | 'zone' | 'counter';
export type TriageSearchField = 'all' | 'sku' | 'issue_id' | 'reporter';
export type PulseSearchField = 'all' | 'unit_id' | 'serial_number' | 'sku' | 'user';

export type SearchFieldForTab<T extends InventoryTab> =
    T extends 'bins' ? BinSearchField :
    T extends 'skus' ? SkuSearchField :
    T extends 'units' ? UnitSearchField :
    T extends 'activity' ? ActivitySearchField :
    T extends 'alerts' ? AlertSearchField :
    T extends 'counts' ? CountSearchField :
    T extends 'triage' ? TriageSearchField :
    T extends 'pulse' ? PulseSearchField :
    never;

export type AnyInventorySearchField =
    | BinSearchField
    | SkuSearchField
    | UnitSearchField
    | ActivitySearchField
    | AlertSearchField
    | CountSearchField
    | TriageSearchField
    | PulseSearchField;

// ─── Per-tab bucket-filter unions (multi-select) ─────────────────────────────

export type BinBucket = 'full' | 'low' | 'empty' | 'stale' | 'never_counted';
export type SkuBucket = 'in_stock' | 'low' | 'oos' | 'overstock' | 'watched';
export type UnitBucket = 'available' | 'allocated' | 'picked' | 'shipped' | 'held' | 'damaged' | 'rtv';
export type ActivityBucket = 'receive' | 'move' | 'pick' | 'ship' | 'adjust' | 'count' | 'hold';
export type AlertBucket = 'low_stock' | 'stale_count' | 'never_counted' | 'drift' | 'unresolved';
export type CountBucket = 'open' | 'in_progress' | 'reconciling' | 'closed';

export type BucketForTab<T extends InventoryTab> =
    T extends 'bins' ? BinBucket :
    T extends 'skus' ? SkuBucket :
    T extends 'units' ? UnitBucket :
    T extends 'activity' ? ActivityBucket :
    T extends 'alerts' ? AlertBucket :
    T extends 'counts' ? CountBucket :
    never;

export type AnyInventoryBucket =
    | BinBucket
    | SkuBucket
    | UnitBucket
    | ActivityBucket
    | AlertBucket
    | CountBucket;

// ─── Field configs (label, placeholder, helper text) ─────────────────────────

export interface InventoryFieldConfig {
    id: string;
    label: string;
    placeholder: string;
    helperText: string;
}

export const INVENTORY_SEARCH_FIELDS: Record<InventoryTab, InventoryFieldConfig[]> = {
    bins: [
        { id: 'all',          label: 'All',          placeholder: 'Search bins, zones, rooms, or SKU contained',  helperText: 'Searches barcode, name, room, zone, and SKUs held in each bin.' },
        { id: 'bin_barcode',  label: 'Bin Barcode',  placeholder: 'Scan or type a bin barcode',                   helperText: 'Matches barcode exactly and as a prefix.' },
        { id: 'zone',         label: 'Zone',         placeholder: 'Zone letter (e.g. A, B, C…)',                   helperText: 'Filters bins by their zone letter.' },
        { id: 'room',         label: 'Room',         placeholder: 'Room name',                                    helperText: 'Filters bins to a single room.' },
        { id: 'sku_contained',label: 'SKU Held',     placeholder: 'SKU or product title held in this bin',         helperText: 'Finds bins currently holding a SKU or product.' },
    ],
    skus: [
        { id: 'all',           label: 'All',           placeholder: 'Search SKU code or product title',  helperText: 'Searches SKU code and product title.' },
        { id: 'sku',           label: 'SKU',           placeholder: 'Search SKU code',                    helperText: 'Prefix and exact SKU matches rank first.' },
        { id: 'product_title', label: 'Product Title', placeholder: 'Search product title',               helperText: 'Substring match across product titles.' },
        { id: 'brand',         label: 'Brand',         placeholder: 'Brand name',                         helperText: 'Filters SKUs by brand prefix.' },
    ],
    units: [
        { id: 'all',           label: 'All',           placeholder: 'Search any unit identifier',         helperText: 'Searches unit id, serial #, SKU, order id, and tracking.' },
        { id: 'unit_id',       label: 'Unit ID',       placeholder: 'Numeric unit id',                    helperText: 'Exact match on internal serial_unit id.' },
        { id: 'serial_number', label: 'Serial #',      placeholder: 'Serial number',                      helperText: 'Substring match across serial numbers.' },
        { id: 'sku',           label: 'SKU',           placeholder: 'Filter units by SKU',                helperText: 'Exact (case-insensitive) SKU filter.' },
        { id: 'order_id',      label: 'Order ID',      placeholder: 'Allocated order id',                 helperText: 'Filters units allocated to a given order.' },
        { id: 'tracking',      label: 'Tracking #',    placeholder: 'Tracking number',                    helperText: 'Filters shipped units by tracking number.' },
    ],
    activity: [
        { id: 'all',         label: 'All',          placeholder: 'Filter recent activity',     helperText: 'Live feed of inventory events (latest 50).' },
        { id: 'sku',         label: 'SKU',          placeholder: 'Show events for SKU',        helperText: 'Filters the activity feed to one SKU.' },
        { id: 'bin',         label: 'Bin',          placeholder: 'Show events for bin',        helperText: 'Filters the activity feed to one bin barcode.' },
        { id: 'user',        label: 'User',         placeholder: 'Show events by staff name',  helperText: 'Filters events by the staff member who performed them.' },
        { id: 'event_type',  label: 'Event Type',   placeholder: 'Event type keyword',         helperText: 'Filters events by event_type (e.g. SHIPPED, ADJUST).' },
    ],
    alerts: [
        { id: 'all',  label: 'All',  placeholder: 'Search alerts by SKU, bin, or rule', helperText: 'Coming in Phase 3 — feed is read-only stub for now.' },
        { id: 'sku',  label: 'SKU',  placeholder: 'Alerts for SKU',                      helperText: 'Filters alerts to one SKU.' },
        { id: 'bin',  label: 'Bin',  placeholder: 'Alerts for bin',                      helperText: 'Filters alerts to one bin.' },
        { id: 'rule', label: 'Rule', placeholder: 'Alert rule keyword',                   helperText: 'Filters alerts by their rule code.' },
    ],
    counts: [
        { id: 'all',      label: 'All',      placeholder: 'Search cycle counts',  helperText: 'Coming in Phase 3 — feed is read-only stub for now.' },
        { id: 'campaign', label: 'Campaign', placeholder: 'Campaign name',         helperText: 'Filters by campaign name.' },
        { id: 'zone',     label: 'Zone',     placeholder: 'Zone letter',           helperText: 'Filters counts to one zone.' },
        { id: 'counter',  label: 'Counter',  placeholder: 'Staff name',            helperText: 'Filters counts by assigned counter.' },
    ],
    triage: [
        { id: 'all',       label: 'All',       placeholder: 'Search triage issues',  helperText: 'Coming soon — feed is read-only stub for now.' },
        { id: 'sku',       label: 'SKU',       placeholder: 'Issues for SKU',         helperText: 'Filters triage issues to one SKU.' },
        { id: 'issue_id',  label: 'Issue ID',  placeholder: 'Numeric issue id',       helperText: 'Exact match on triage issue id.' },
        { id: 'reporter',  label: 'Reporter',  placeholder: 'Staff name',             helperText: 'Filters issues by the staff member who reported them.' },
    ],
    pulse: [
        { id: 'all',           label: 'All',       placeholder: 'Search live pulse',  helperText: 'Coming soon — feed is read-only stub for now.' },
        { id: 'unit_id',       label: 'Unit ID',   placeholder: 'Numeric unit id',    helperText: 'Exact match on internal serial_unit id.' },
        { id: 'serial_number', label: 'Serial #',  placeholder: 'Serial number',      helperText: 'Substring match across serial numbers.' },
        { id: 'sku',           label: 'SKU',       placeholder: 'Filter pulse by SKU', helperText: 'Exact (case-insensitive) SKU filter.' },
        { id: 'user',          label: 'User',      placeholder: 'Show events by staff name', helperText: 'Filters pulse events by the staff member who performed them.' },
    ],
};

// ─── Bucket configs (multi-select pills) ─────────────────────────────────────

export interface InventoryBucketConfig {
    id: string;
    label: string;
}

export const INVENTORY_BUCKETS: Record<InventoryTab, InventoryBucketConfig[]> = {
    bins: [
        { id: 'full',           label: 'Full' },
        { id: 'low',            label: 'Low' },
        { id: 'empty',          label: 'Empty' },
        { id: 'stale',          label: 'Stale' },
        { id: 'never_counted',  label: 'Never Counted' },
    ],
    skus: [
        { id: 'in_stock',  label: 'In Stock' },
        { id: 'low',       label: 'Low' },
        { id: 'oos',       label: 'OOS' },
        { id: 'overstock', label: 'Overstock' },
        { id: 'watched',   label: 'Watched' },
    ],
    units: [
        { id: 'available', label: 'Available' },
        { id: 'allocated', label: 'Allocated' },
        { id: 'picked',    label: 'Picked' },
        { id: 'shipped',   label: 'Shipped' },
        { id: 'held',      label: 'Held' },
        { id: 'damaged',   label: 'Damaged' },
        { id: 'rtv',       label: 'RTV' },
    ],
    activity: [
        { id: 'receive', label: 'Receive' },
        { id: 'move',    label: 'Move' },
        { id: 'pick',    label: 'Pick' },
        { id: 'ship',    label: 'Ship' },
        { id: 'adjust',  label: 'Adjust' },
        { id: 'count',   label: 'Count' },
        { id: 'hold',    label: 'Hold' },
    ],
    alerts: [
        { id: 'low_stock',     label: 'Low Stock' },
        { id: 'stale_count',   label: 'Stale Count' },
        { id: 'never_counted', label: 'Never Counted' },
        { id: 'drift',         label: 'Drift' },
        { id: 'unresolved',    label: 'Unresolved' },
    ],
    counts: [
        { id: 'open',         label: 'Open' },
        { id: 'in_progress',  label: 'In Progress' },
        { id: 'reconciling',  label: 'Reconciling' },
        { id: 'closed',       label: 'Closed' },
    ],
    triage: [
        { id: 'critical',      label: 'Critical' },
        { id: 'inbox',         label: 'Inbox' },
        { id: 'investigating', label: 'Investigating' },
        { id: 'pending',       label: 'Pending' },
        { id: 'resolved',      label: 'Resolved' },
    ],
    pulse: [
        { id: 'ship',    label: 'Ship' },
        { id: 'pack',    label: 'Pack' },
        { id: 'pick',    label: 'Pick' },
        { id: 'move',    label: 'Move' },
        { id: 'receive', label: 'Receive' },
    ],
};

// ─── Bucket → serial_status / condition_grade mapping (Units tab) ────────────

import { SERIAL_STATUS_VALUES, CONDITION_GRADE_VALUES } from '@/components/inventory/types';

/** Map a UnitBucket to the serial_status_enum values it covers. */
export const UNIT_BUCKET_STATES: Record<UnitBucket, ReadonlyArray<(typeof SERIAL_STATUS_VALUES)[number]>> = {
    available: ['STOCKED', 'GRADED', 'TESTED'],
    allocated: ['ALLOCATED'],
    picked:    ['PICKED'],
    shipped:   ['PACKED', 'LABELED', 'STAGED', 'SHIPPED'],
    held:      ['ON_HOLD'],
    damaged:   [],
    rtv:       ['RETURNED', 'RMA', 'SCRAPPED'],
};

/** Damaged is a condition grade, not a status. */
export const UNIT_BUCKET_CONDITIONS: Partial<Record<UnitBucket, ReadonlyArray<(typeof CONDITION_GRADE_VALUES)[number]>>> = {
    damaged: ['PARTS', 'USED_C'],
};

// ─── Activity bucket → event_type prefix mapping ─────────────────────────────
// Tentative — verified against `inventory_events.event_type` values in Phase 1.

export const ACTIVITY_BUCKET_EVENT_PREFIXES: Record<ActivityBucket, ReadonlyArray<string>> = {
    receive: ['RECEIVING_', 'RECEIVED'],
    move:    ['LOCATION_TRANSFER', 'BIN_TO_BIN', 'MOVE'],
    pick:    ['ALLOCATED', 'PICKED'],
    ship:    ['PACKED', 'SHIPPED', 'LABELED'],
    adjust:  ['QTY_ADJUST', 'CONDITION_ADJUST', 'ADJUST'],
    count:   ['COUNT_'],
    hold:    ['ON_HOLD', 'HOLD_RELEASED', 'HOLD'],
};

// ─── Lookups & helpers ───────────────────────────────────────────────────────

const FIELD_MAP: Record<InventoryTab, Map<string, InventoryFieldConfig>> = (() => {
    const out = {} as Record<InventoryTab, Map<string, InventoryFieldConfig>>;
    for (const tab of INVENTORY_TABS) {
        const map = new Map<string, InventoryFieldConfig>();
        for (const f of INVENTORY_SEARCH_FIELDS[tab]) map.set(f.id, f);
        out[tab] = map;
    }
    return out;
})();

const BUCKET_MAP: Record<InventoryTab, Set<string>> = (() => {
    const out = {} as Record<InventoryTab, Set<string>>;
    for (const tab of INVENTORY_TABS) {
        out[tab] = new Set(INVENTORY_BUCKETS[tab].map((b) => b.id));
    }
    return out;
})();

export function normalizeInventoryTab(raw: string | null | undefined): InventoryTab {
    const v = String(raw || '').trim().toLowerCase();
    return (INVENTORY_TABS as readonly string[]).includes(v) ? (v as InventoryTab) : 'activity';
}

export function normalizeSearchField<T extends InventoryTab>(
    tab: T,
    raw: string | null | undefined,
): SearchFieldForTab<T> {
    const v = String(raw || '').trim().toLowerCase();
    if (FIELD_MAP[tab].has(v)) return v as SearchFieldForTab<T>;
    return 'all' as SearchFieldForTab<T>;
}

export function normalizeBuckets<T extends InventoryTab>(
    tab: T,
    raw: string | null | undefined,
): BucketForTab<T>[] {
    if (!raw) return [];
    return raw
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => BUCKET_MAP[tab].has(s)) as BucketForTab<T>[];
}

export function getFieldConfig(tab: InventoryTab, field: string): InventoryFieldConfig {
    return FIELD_MAP[tab].get(field) ?? INVENTORY_SEARCH_FIELDS[tab][0];
}

export function getInventorySearchPlaceholder(tab: InventoryTab, field: string): string {
    return getFieldConfig(tab, field).placeholder;
}

export function getInventorySearchHelperText(tab: InventoryTab, field: string): string {
    return getFieldConfig(tab, field).helperText;
}

/**
 * Resolve the active tab from the pathname. `/inventory/<tab>` segments match
 * directly; anything else (including bare `/inventory`) falls back to the
 * default Activity tab.
 */
export function inventoryTabFromPathname(pathname: string | null | undefined): InventoryTab {
    if (!pathname) return 'activity';
    const m = pathname.match(/^\/inventory\/([a-z]+)(?:[\/?#]|$)/i);
    if (!m) return 'activity';
    return normalizeInventoryTab(m[1]);
}
