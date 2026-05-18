'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { InventoryV2SearchBar, type ResolvedSearchTarget } from './InventoryV2SearchBar';
import { InventoryFilterChips } from './InventoryFilterChips';
import { PulseView } from './PulseView';
import { BySkuView } from './BySkuView';
import { ByBinView } from './ByBinView';
import { ByUnitView } from './ByUnitView';
import { ByFilterResultList } from './ByFilterResultList';
import type { InventoryV2ViewState } from './types';

function parseList(raw: string | null): string[] {
    if (!raw) return [];
    return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

function readViewState(searchParams: URLSearchParams): InventoryV2ViewState {
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

type UrlPatch = {
    sku?: string | null;
    bin?: string | null;
    unit?: string | null;
    states?: string[];
    conditions?: string[];
};

export function InventoryV2Shell() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const state = useMemo(
        () => readViewState(new URLSearchParams(searchParams.toString())),
        [searchParams],
    );

    const initialSearchValue = state.sku || state.bin || state.unit || '';

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

            // Single-target views (sku / bin / unit) are mutually exclusive with each other.
            const singles: Array<'sku' | 'bin' | 'unit'> = ['sku', 'bin', 'unit'];
            for (const k of singles) {
                if (next[k]) {
                    for (const other of singles) {
                        if (other !== k) sp.delete(other);
                    }
                }
            }
            const qs = sp.toString();
            router.replace(qs ? `${pathname}?${qs}` : pathname);
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

    const handleSubmit = useCallback(
        (target: ResolvedSearchTarget) => {
            switch (target.kind) {
                case 'clear':
                    setUrl({ sku: null, bin: null, unit: null });
                    return;
                case 'sku':
                    setUrl({ sku: target.sku });
                    return;
                case 'bin':
                    setUrl({ bin: target.barcode });
                    return;
                case 'unit':
                    setUrl({ unit: target.ref });
                    return;
                case 'tracking':
                    toast.message('Tracking lookup', {
                        description: `Detected ${target.carrier ?? 'tracking'} — open the order in Operations.`,
                    });
                    return;
                case 'unknown':
                default:
                    toast.message('No match', {
                        description: 'Try a SKU code, bin barcode (e.g., A-12-03), or a unit id / serial.',
                    });
                    return;
            }
        },
        [setUrl],
    );

    const hasNonFilterTarget =
        state.view === 'by-sku' || state.view === 'by-bin' || state.view === 'by-unit';
    const hasAnyTarget = hasNonFilterTarget || state.view === 'by-filter';

    return (
        <div className="flex h-full min-h-0 flex-col bg-gray-50">
            <header className="sticky top-0 z-10 border-b border-gray-200 bg-white px-4 py-3 sm:px-6">
                <div className="mx-auto flex max-w-5xl flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                        <h1 className="text-xl font-semibold text-gray-900">Inventory</h1>
                        {hasAnyTarget ? (
                            <button
                                type="button"
                                onClick={clearAll}
                                className="text-xs text-gray-500 underline hover:text-gray-900"
                            >
                                Back to recent activity
                            </button>
                        ) : null}
                    </div>
                    <InventoryV2SearchBar
                        initial={initialSearchValue}
                        onSubmit={handleSubmit}
                    />
                    {/* Filter chips compose with search: searching for a SKU still
                        narrows by state/condition. The shell falls back to the
                        ByFilter view only when no single-target field is set. */}
                    <InventoryFilterChips
                        states={state.states}
                        conditions={state.conditions}
                        onChange={(patch) => setUrl(patch)}
                        onClear={() => setUrl({ states: [], conditions: [] })}
                    />
                </div>
            </header>

            <div className="mx-auto w-full max-w-5xl flex-1 overflow-y-auto">
                {state.view === 'by-sku' && state.sku ? (
                    <BySkuView sku={state.sku} />
                ) : state.view === 'by-bin' && state.bin ? (
                    <ByBinView barcode={state.bin} />
                ) : state.view === 'by-unit' && state.unit ? (
                    <ByUnitView ref={state.unit} />
                ) : state.view === 'by-filter' ? (
                    <ByFilterResultList
                        states={state.states}
                        conditions={state.conditions}
                    />
                ) : (
                    <PulseView />
                )}
            </div>
        </div>
    );
}
