'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { InventoryViewState } from './types';

function parseList(raw: string | null): string[] {
    if (!raw) return [];
    return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

function readViewState(searchParams: URLSearchParams): InventoryViewState {
    const sku = searchParams.get('sku');
    const bin = searchParams.get('bin');
    const unit = searchParams.get('unit');
    const states = parseList(searchParams.get('state'));
    const conditions = parseList(searchParams.get('condition'));
    if (unit) return { view: 'by-unit', sku: null, bin: null, unit, states, conditions };
    if (sku) return { view: 'by-sku', sku, bin: null, unit: null, states, conditions };
    if (bin) return { view: 'by-bin', sku: null, bin, unit: null, states, conditions };
    if (states.length > 0 || conditions.length > 0) {
        return { view: 'by-filter', sku: null, bin: null, unit: null, states, conditions };
    }
    return { view: 'pulse', sku: null, bin: null, unit: null, states, conditions };
}

export type UrlPatch = {
    sku?: string | null;
    bin?: string | null;
    unit?: string | null;
    states?: string[];
    conditions?: string[];
};

// `/inventory` is the canonical home for the live ledger; sidebar controls
// rendered from `/inventory/po-mailbox` should still write search/filter state
// to the ledger route so navigating back picks up the user's intent.
const INVENTORY_PATH = '/inventory';

export function useInventoryUrlState() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const state = useMemo(
        () => readViewState(new URLSearchParams(searchParams.toString())),
        [searchParams],
    );

    const setUrl = useCallback(
        (next: UrlPatch) => {
            const sp = new URLSearchParams(searchParams.toString());
            const applyKey = (key: 'sku' | 'bin' | 'unit') => {
                const v = next[key];
                if (v === undefined) return;
                if (v) sp.set(key, v);
                else sp.delete(key);
            };
            applyKey('sku');
            applyKey('bin');
            applyKey('unit');

            const applyList = (key: 'state' | 'condition', list: string[] | undefined) => {
                if (list === undefined) return;
                if (list.length > 0) sp.set(key, list.join(','));
                else sp.delete(key);
            };
            applyList('state', next.states);
            applyList('condition', next.conditions);

            const singles: Array<'sku' | 'bin' | 'unit'> = ['sku', 'bin', 'unit'];
            for (const k of singles) {
                if (next[k]) {
                    for (const other of singles) {
                        if (other !== k) sp.delete(other);
                    }
                }
            }
            const qs = sp.toString();
            const targetPath = pathname?.startsWith(INVENTORY_PATH) ? pathname : INVENTORY_PATH;
            router.replace(qs ? `${targetPath}?${qs}` : targetPath);
        },
        [pathname, router, searchParams],
    );

    const clearAll = useCallback(
        () =>
            setUrl({
                sku: null,
                bin: null,
                unit: null,
                states: [],
                conditions: [],
            }),
        [setUrl],
    );

    return { state, setUrl, clearAll };
}
