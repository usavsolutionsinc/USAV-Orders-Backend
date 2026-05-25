/**
 * Custom-event channel for the inventory detail-panel overlay.
 *
 * Mirrors the `open-shipped-details` / `close-shipped-details` /
 * `navigate-shipped-details` pattern used by the dashboard/shipped sidebar.
 * The sidebar dispatches these; the `InventoryDetailsOverlay` listens.
 */

export type InventoryDetailKind = 'bin' | 'sku' | 'unit' | 'alert' | 'count';

export interface OpenInventoryDetailsPayload {
    kind: InventoryDetailKind;
    /** Public-facing identifier (barcode / sku / serial number / id). */
    ref: string;
    /**
     * Stable list-key (`kind:internalKey`) used to highlight the row in the
     * sidebar list. Mirrors `InventoryResultRow.key`.
     */
    listKey?: string;
}

export interface NavigateInventoryDetailsPayload {
    direction: 'up' | 'down';
}

const OPEN_EVENT = 'open-inventory-details';
const CLOSE_EVENT = 'close-inventory-details';
const NAVIGATE_EVENT = 'navigate-inventory-details';

export function dispatchOpenInventoryDetails(payload: OpenInventoryDetailsPayload): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent<OpenInventoryDetailsPayload>(OPEN_EVENT, { detail: payload }));
}

export function dispatchCloseInventoryDetails(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(CLOSE_EVENT));
}

export function dispatchNavigateInventoryDetails(direction: 'up' | 'down'): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
        new CustomEvent<NavigateInventoryDetailsPayload>(NAVIGATE_EVENT, { detail: { direction } }),
    );
}

export function getOpenInventoryDetailsPayload(detail: unknown): OpenInventoryDetailsPayload | null {
    if (!detail || typeof detail !== 'object') return null;
    const candidate = detail as Partial<OpenInventoryDetailsPayload>;
    if (!candidate.kind || !candidate.ref) return null;
    return {
        kind: candidate.kind,
        ref: candidate.ref,
        listKey: candidate.listKey,
    };
}

export const INVENTORY_DETAILS_EVENTS = {
    OPEN: OPEN_EVENT,
    CLOSE: CLOSE_EVENT,
    NAVIGATE: NAVIGATE_EVENT,
} as const;

/**
 * URL-compatible serialization of a detail-panel selection. The sidebar
 * writes this to `?open=` and the overlay reads it on mount so deep links
 * (e.g. `/inventory/bins?open=bin:A-12-03`) auto-restore the panel.
 */
export function serializeInventoryOpenKey(kind: InventoryDetailKind, ref: string): string {
    return `${kind}:${ref}`;
}

export function parseInventoryOpenKey(raw: string | null | undefined): OpenInventoryDetailsPayload | null {
    if (!raw) return null;
    const idx = raw.indexOf(':');
    if (idx <= 0) return null;
    const kind = raw.slice(0, idx) as InventoryDetailKind;
    const ref = raw.slice(idx + 1);
    if (!ref) return null;
    if (kind !== 'bin' && kind !== 'sku' && kind !== 'unit' && kind !== 'alert' && kind !== 'count') {
        return null;
    }
    return { kind, ref };
}
