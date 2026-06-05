'use client';

import { useQuery } from '@tanstack/react-query';
import type {
    AnyInventoryBucket,
    AnyInventorySearchField,
    InventoryTab,
} from '@/lib/inventory-search';
import {
    ACTIVITY_BUCKET_EVENT_PREFIXES,
    UNIT_BUCKET_CONDITIONS,
    UNIT_BUCKET_STATES,
    type ActivityBucket,
    type BinBucket,
    type SkuBucket,
    type UnitBucket,
} from '@/lib/inventory-search';
import type {
    BinsOverviewCounts,
    BinsOverviewRow,
} from '@/lib/neon/location-queries';
import type { PulseEventRow, UnitListRow } from '@/components/inventory/types';

export interface SkuSearchRow {
    sku: string;
    product_title: string | null;
    stock: number;
    bin_count: number;
    total_qty: number;
}

export interface AlertRow {
    id: number;
    rule: string;
    sku: string | null;
    bin_barcode: string | null;
    severity: 'info' | 'warning' | 'critical' | string;
    raised_at: string;
    resolved_at: string | null;
}

export interface CountRow {
    id: number;
    name: string;
    status: string;
    zone: string | null;
    line_count: number;
    progress_pct: number | null;
    opened_at: string | null;
}

// ─── Unified result row (discriminated union) ────────────────────────────────

export type InventoryResultRow =
    | { kind: 'bin'; row: BinsOverviewRow; key: string }
    | { kind: 'sku'; row: SkuSearchRow; key: string }
    | { kind: 'unit'; row: UnitListRow; key: string }
    | { kind: 'event'; row: PulseEventRow; key: string }
    | { kind: 'alert'; row: AlertRow; key: string }
    | { kind: 'count'; row: CountRow; key: string }
    | { kind: 'triage'; row: any; key: string };

export type InventoryResultKind = InventoryResultRow['kind'];

export interface UseInventorySearchParams {
    tab: InventoryTab;
    query: string;
    field: AnyInventorySearchField;
    buckets: AnyInventoryBucket[];
}

export interface UseInventorySearchResult {
    rows: InventoryResultRow[];
    isFetching: boolean;
    isError: boolean;
    error: unknown;
    /** Tab-specific count buckets, surfaced for chip badges. */
    counts: Partial<Record<string, number>>;
    refetch: () => void;
}

// ─── Bins ────────────────────────────────────────────────────────────────────

async function fetchBins(args: { q: string; field: string; signal?: AbortSignal }) {
    const params = new URLSearchParams();
    // The endpoint already does a broad ILIKE across barcode/name/room/SKU
    // contained, so we send `q` for every field flavor. Field is a UX hint
    // for the placeholder — server-side narrowing lands in Phase 3.
    if (args.q) params.set('q', args.q);
    if (args.field === 'room' && args.q) params.set('room', args.q);
    const res = await fetch(`/api/inventory/bins-overview?${params.toString()}`, { signal: args.signal });
    if (!res.ok) throw new Error(`bins-overview ${res.status}`);
    const data = (await res.json()) as {
        success: boolean;
        rows: BinsOverviewRow[];
        counts: BinsOverviewCounts;
    };
    return data;
}

function applyBinBuckets(rows: BinsOverviewRow[], buckets: BinBucket[]): BinsOverviewRow[] {
    if (buckets.length === 0) return rows;
    return rows.filter((r) => {
        for (const b of buckets) {
            if (b === 'full' && r.fill_pct != null && r.fill_pct >= 0.85) return true;
            if (b === 'low' && r.has_low_stock) return true;
            if (b === 'empty' && r.is_empty) return true;
            if (b === 'stale' && r.is_stale) return true;
            if (b === 'never_counted' && !r.last_counted) return true;
        }
        return false;
    });
}

// ─── SKUs ────────────────────────────────────────────────────────────────────

async function fetchSkus(args: { q: string; signal?: AbortSignal }): Promise<SkuSearchRow[]> {
    if (!args.q) return [];
    const params = new URLSearchParams({ q: args.q });
    const res = await fetch(`/api/inventory/sku-search?${params.toString()}`, { signal: args.signal });
    if (!res.ok) throw new Error(`sku-search ${res.status}`);
    const data = (await res.json()) as { success: boolean; results: SkuSearchRow[] };
    return data.results ?? [];
}

function applySkuBuckets(rows: SkuSearchRow[], buckets: SkuBucket[]): SkuSearchRow[] {
    if (buckets.length === 0) return rows;
    // Heuristics until the endpoint exposes min/max thresholds:
    // in_stock=stock>0, low=stock<=5 && stock>0, oos=stock===0,
    // overstock=stock>=100. "watched" is a placeholder until the watch flag ships.
    return rows.filter((r) => {
        for (const b of buckets) {
            if (b === 'in_stock' && r.stock > 0) return true;
            if (b === 'low' && r.stock > 0 && r.stock <= 5) return true;
            if (b === 'oos' && r.stock === 0) return true;
            if (b === 'overstock' && r.stock >= 100) return true;
            if (b === 'watched') return false; // not implemented Day 1
        }
        return false;
    });
}

// ─── Units ───────────────────────────────────────────────────────────────────

async function fetchUnits(args: {
    q: string;
    field: string;
    buckets: UnitBucket[];
    signal?: AbortSignal;
}): Promise<{ items: UnitListRow[]; total: number }> {
    const params = new URLSearchParams();

    if (args.q) {
        if (args.field === 'sku') params.set('sku', args.q);
        else if (args.field === 'unit_id' || args.field === 'serial_number') params.set('q', args.q);
        else params.set('q', args.q);
    }

    // Map UnitBucket → state[] / condition[] using the agreed enum mapping.
    const states = new Set<string>();
    const conditions = new Set<string>();
    for (const b of args.buckets) {
        for (const s of UNIT_BUCKET_STATES[b] ?? []) states.add(s);
        for (const c of UNIT_BUCKET_CONDITIONS[b] ?? []) conditions.add(c);
    }
    if (states.size > 0) params.set('state', Array.from(states).join(','));
    if (conditions.size > 0) params.set('condition', Array.from(conditions).join(','));
    params.set('limit', '100');

    const res = await fetch(`/api/inventory/units?${params.toString()}`, { signal: args.signal });
    if (!res.ok) throw new Error(`units ${res.status}`);
    const data = (await res.json()) as { success: boolean; items: UnitListRow[]; total: number };
    return { items: data.items ?? [], total: data.total ?? 0 };
}

// ─── Activity ────────────────────────────────────────────────────────────────

async function fetchActivity(args: {
    q: string;
    field: string;
    signal?: AbortSignal;
}): Promise<PulseEventRow[]> {
    const params = new URLSearchParams();
    if (args.q) {
        if (args.field === 'sku') params.set('sku', args.q);
        else if (args.field === 'bin') {
            // bin filter would need a barcode→id lookup; Phase 1 falls back
            // to the free-text feed and filters client-side by bin_name.
        }
    }
    params.set('limit', '50');
    const res = await fetch(`/api/inventory-events?${params.toString()}`, { signal: args.signal });
    if (!res.ok) throw new Error(`inventory-events ${res.status}`);
    const data = (await res.json()) as { success: boolean; events: PulseEventRow[] };
    return data.events ?? [];
}

function applyActivityFilters(
    rows: PulseEventRow[],
    args: { q: string; field: string; buckets: ActivityBucket[] },
): PulseEventRow[] {
    let out = rows;
    if (args.q) {
        const needle = args.q.toLowerCase();
        if (args.field === 'bin') {
            out = out.filter((e) => (e.bin_name ?? '').toLowerCase().includes(needle));
        } else if (args.field === 'user') {
            out = out.filter((e) => (e.actor_name ?? '').toLowerCase().includes(needle));
        } else if (args.field === 'event_type') {
            out = out.filter((e) => e.event_type.toLowerCase().includes(needle));
        } else if (args.field === 'all') {
            out = out.filter((e) =>
                [e.sku, e.bin_name, e.actor_name, e.event_type, e.notes]
                    .filter(Boolean)
                    .some((s) => String(s).toLowerCase().includes(needle)),
            );
        }
    }
    if (args.buckets.length > 0) {
        const prefixes = args.buckets.flatMap((b) => ACTIVITY_BUCKET_EVENT_PREFIXES[b] ?? []);
        if (prefixes.length > 0) {
            out = out.filter((e) => {
                const t = (e.event_type || '').toUpperCase();
                return prefixes.some((p) => t.startsWith(p) || t.includes(p));
            });
        }
    }
    return out;
}

// ─── Alerts ──────────────────────────────────────────────────────────────────

async function fetchAlerts(args: {
    q: string;
    field: string;
    buckets: string[];
    signal?: AbortSignal;
}): Promise<{ items: AlertRow[]; counts: Partial<Record<string, number>> }> {
    const params = new URLSearchParams();
    if (args.q) params.set('q', args.q);
    if (args.field && args.field !== 'all') params.set('field', args.field);
    for (const b of args.buckets) params.append('bucket', b);
    params.set('limit', '100');
    const res = await fetch(`/api/inventory/alerts?${params.toString()}`, { signal: args.signal });
    if (!res.ok) throw new Error(`alerts ${res.status}`);
    const data = (await res.json()) as { success: boolean; items: AlertRow[]; counts: Record<string, number> };
    return { items: data.items ?? [], counts: data.counts ?? {} };
}

// ─── Counts ──────────────────────────────────────────────────────────────────

async function fetchCounts(args: {
    q: string;
    buckets: string[];
    signal?: AbortSignal;
}): Promise<{ items: CountRow[]; counts: Partial<Record<string, number>> }> {
    const params = new URLSearchParams();
    if (args.q) params.set('q', args.q);
    for (const b of args.buckets) params.append('bucket', b);
    params.set('limit', '50');
    const res = await fetch(`/api/inventory/counts?${params.toString()}`, { signal: args.signal });
    if (!res.ok) throw new Error(`counts ${res.status}`);
    const data = (await res.json()) as { success: boolean; items: CountRow[]; counts: Record<string, number> };
    return { items: data.items ?? [], counts: data.counts ?? {} };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Per-tab inventory search. Routes to the appropriate read endpoint and
 * normalizes the response into the shared `InventoryResultRow` shape so the
 * sidebar's row card can render any kind through the same component.
 *
 * Alerts and Counts tabs return empty results in Phase 1 — their endpoints
 * land in Phase 3. The hook is structured so wiring them later is a one-line
 * swap at the dispatch switch.
 */
export function useInventorySearch(params: UseInventorySearchParams): UseInventorySearchResult {
    const { tab, query, field, buckets } = params;
    const trimmed = query.trim();

    const queryKey = [
        'inventory-search',
        tab,
        trimmed,
        field,
        [...buckets].sort().join(','),
    ] as const;

    // SKUs need a non-empty query (endpoint returns empty otherwise). Bins,
    // Units, Activity all return useful default content with no query.
    const enabled = tab === 'skus' ? trimmed.length > 0 : true;

    const q = useQuery({
        queryKey,
        queryFn: async ({ signal }) => {
            switch (tab) {
                case 'bins': {
                    const data = await fetchBins({ q: trimmed, field, signal });
                    const filtered = applyBinBuckets(data.rows, buckets as BinBucket[]);
                    return { kind: 'bins' as const, rows: filtered, counts: data.counts };
                }
                case 'skus': {
                    const rows = await fetchSkus({ q: trimmed, signal });
                    const filtered = applySkuBuckets(rows, buckets as SkuBucket[]);
                    return { kind: 'skus' as const, rows: filtered };
                }
                case 'units': {
                    const data = await fetchUnits({
                        q: trimmed,
                        field,
                        buckets: buckets as UnitBucket[],
                        signal,
                    });
                    return { kind: 'units' as const, rows: data.items, total: data.total };
                }
                case 'activity': {
                    const rows = await fetchActivity({ q: trimmed, field, signal });
                    const filtered = applyActivityFilters(rows, {
                        q: trimmed,
                        field,
                        buckets: buckets as ActivityBucket[],
                    });
                    return { kind: 'activity' as const, rows: filtered };
                }
                case 'alerts': {
                    const data = await fetchAlerts({
                        q: trimmed,
                        field,
                        buckets: buckets as string[],
                        signal,
                    });
                    return { kind: 'alerts' as const, rows: data.items, counts: data.counts };
                }
                case 'counts': {
                    const data = await fetchCounts({
                        q: trimmed,
                        buckets: buckets as string[],
                        signal,
                    });
                    return { kind: 'counts' as const, rows: data.items, counts: data.counts };
                }
                case 'triage': {
                    return {
                        kind: 'triage' as const,
                        rows: [
                            { id: 'EXP-101', sku: 'SNY-PS5-DISC', type: 'Damaged', severity: 'high', title: 'Box crushed', reporter: 'Michael K.', date: '10m ago' },
                            { id: 'EXP-104', sku: 'MSF-XBS-X', type: 'Mismatch', severity: 'high', title: 'Wrong Edition', reporter: 'Michael K.', date: '5h ago' },
                        ],
                    };
                }
                case 'pulse': {
                    const rows = await fetchActivity({ q: trimmed, field, signal });
                    return { kind: 'activity' as const, rows };
                }
                default:
                    return { kind: 'activity' as const, rows: [] as PulseEventRow[] };
            }
        },
        enabled,
        staleTime: 30_000,
        gcTime: 5 * 60 * 1000,
        placeholderData: (prev) => prev,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
        refetchOnReconnect: false,
    });

    const rows: InventoryResultRow[] = (() => {
        const data = q.data;
        if (!data) return [];
        switch (data.kind) {
            case 'bins':
                return data.rows.map((row) => ({ kind: 'bin' as const, row, key: String(row.id) }));
            case 'skus':
                return data.rows.map((row) => ({ kind: 'sku' as const, row, key: row.sku }));
            case 'units':
                return data.rows.map((row) => ({ kind: 'unit' as const, row, key: String(row.id) }));
            case 'activity':
                return data.rows.map((row) => ({ kind: 'event' as const, row, key: String(row.id) }));
            case 'alerts':
                return data.rows.map((row) => ({ kind: 'alert' as const, row, key: String(row.id) }));
            case 'counts':
                return data.rows.map((row) => ({ kind: 'count' as const, row, key: String(row.id) }));
            case 'triage':
                return data.rows.map((row: any) => ({ kind: 'triage' as const, row, key: row.id }));
        }
    })();

    const counts: Partial<Record<string, number>> = (() => {
        const data = q.data;
        if (!data) return {};
        if (data.kind === 'bins') {
            return {
                empty: data.counts.empty,
                stale: data.counts.stale,
                low: data.counts.low_stock,
                full: data.counts.over_capacity,
            };
        }
        if (data.kind === 'alerts' || data.kind === 'counts') {
            return { ...data.counts };
        }
        return {};
    })();

    return {
        rows,
        isFetching: q.isFetching,
        isError: q.isError,
        error: q.error,
        counts,
        refetch: () => {
            q.refetch();
        },
    };
}
