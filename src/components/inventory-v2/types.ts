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

export type InventoryV2View = 'pulse' | 'by-sku' | 'by-bin' | 'by-unit';

export interface InventoryV2ViewState {
    view: InventoryV2View;
    sku: string | null;
    bin: string | null;
    unit: string | null;
}

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
    };
    events: PulseEventRow[];
}
