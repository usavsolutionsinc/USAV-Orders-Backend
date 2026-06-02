export interface PulseEventRow {
    id: number;
    occurred_at: string;
    event_type: string;
    actor_staff_id: number | null;
    actor_name: string | null;
    station: string | null;
    sku: string | null;
    serial_unit_id: number | null;
    serial_number: string | null;
    bin_id: number | null;
    bin_name: string | null;
    prev_bin_id: number | null;
    prev_bin_name: string | null;
    prev_status: string | null;
    next_status: string | null;
    notes: string | null;
    payload: Record<string, unknown>;
    receiving_id: number | null;
    receiving_line_id: number | null;
}

export interface PulseEventsResponse {
    success: true;
    events: PulseEventRow[];
}

export type InventoryView = 'pulse' | 'by-sku' | 'by-bin' | 'by-unit' | 'by-filter';

export interface InventoryViewState {
    view: InventoryView;
    sku: string | null;
    bin: string | null;
    unit: string | null;
    states: string[];
    conditions: string[];
}

export interface UnitListRow {
    id: number;
    serial_number: string;
    sku: string | null;
    product_title: string;
    current_status: string;
    condition_grade: string | null;
    current_location: string | null;
    updated_at: string;
}

export interface UnitListResponse {
    success: true;
    items: UnitListRow[];
    total: number;
    limit: number;
    offset: number;
}

export const SERIAL_STATUS_VALUES = [
    'UNKNOWN',
    'RECEIVED',
    'TRIAGED',
    'IN_TEST',
    'IN_REPAIR',
    'REPAIR_DONE',
    'TESTED',
    'GRADED',
    'STOCKED',
    'ALLOCATED',
    'PICKED',
    'PACKED',
    'LABELED',
    'STAGED',
    'SHIPPED',
    'RETURNED',
    'RMA',
    'ON_HOLD',
    'SCRAPPED',
] as const;

export const CONDITION_GRADE_VALUES = [
    'BRAND_NEW',
    'LIKE_NEW',
    'REFURBISHED',
    'USED_A',
    'USED_B',
    'USED_C',
    'PARTS',
] as const;

export interface SerialUnitDetailPayload {
    success: true;
    serial_unit: {
        id: number;
        serial_number: string;
        normalized_serial: string;
        sku: string | null;
        sku_catalog_id: number | null;
        current_status: string;
        current_location: string | null;
        condition_grade: string | null;
        origin_source: string | null;
        origin_receiving_line_id: number | null;
        received_at: string | null;
        received_by: number | null;
        created_at: string;
        updated_at: string;
        product_title: string | null;
        received_by_name: string | null;
        origin_tsn_id?: number | null;
        shipping_tracking_number?: string | null;
        shipment_id?: number | null;
        notes?: string | null;
    };
    events: PulseEventRow[];
    /** Present when fetched with `?include=full`. Mirrors the legacy admin timeline. */
    events_full?: TimelineEventRow[];
    conditions?: ConditionHistoryRow[];
    allocations?: AllocationRow[];
    tsn_links?: TsnLinkRow[];
}

export interface TimelineEventRow {
    id: number;
    occurred_at: string;
    event_type: string;
    station: string | null;
    prev_status: string | null;
    next_status: string | null;
    bin_id: number | null;
    bin_name: string | null;
    stock_ledger_id: number | null;
    actor_staff_id: number | null;
    actor_name: string | null;
    scan_token: string | null;
    client_event_id: string | null;
    notes: string | null;
    payload: Record<string, unknown> | null;
}

export interface ConditionHistoryRow {
    id: number;
    assessed_at: string;
    assessed_by_staff_id: number | null;
    assessed_by_name: string | null;
    prev_grade: string | null;
    new_grade: string;
    cosmetic_notes: string | null;
    functional_notes: string | null;
    inventory_event_id: number | null;
}

export interface AllocationRow {
    id: number;
    order_id: number;
    allocated_at: string;
    state: string;
    released_at: string | null;
    released_reason: string | null;
    allocated_by_name: string | null;
}

export interface TsnLinkRow {
    id: number;
    station_source: string | null;
    shipment_id: number | null;
    serial_type: string;
    fnsku: string | null;
    tested_by_name: string | null;
    created_at: string;
}
