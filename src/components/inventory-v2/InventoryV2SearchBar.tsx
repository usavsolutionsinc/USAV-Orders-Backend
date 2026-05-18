'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, X } from '@/components/Icons';
import { parseScannedUrl, classifyInput } from '@/lib/scan-resolver';

interface InventoryV2SearchBarProps {
    initial: string;
    onSubmit: (input: ResolvedSearchTarget) => void;
}

export type ResolvedSearchTarget =
    | { kind: 'clear' }
    | { kind: 'sku'; sku: string }
    | { kind: 'bin'; barcode: string }
    | { kind: 'unit'; ref: string }
    | { kind: 'tracking'; tracking: string; carrier: string | null }
    // For unrecognized input we still let the URL hold it so a future
    // ByFilter view can pick it up; the shell falls back to Pulse for now.
    | { kind: 'unknown'; raw: string };

// Loose detector for bin codes (e.g., A-12-03). Mirrors the conventions
// used elsewhere in the codebase: letter, dash, digits, dash, digits.
const BIN_BARCODE_RE = /^[A-Za-z]\d*-\d+-\d+$/;
const SKU_LIKE_RE = /^[A-Za-z0-9][A-Za-z0-9-]+[A-Za-z0-9]$/;
// A short integer (≤7 digits) is a serial_units.id. GTINs are 8-14 digits
// and tracking patterns get classified earlier — so unit ids are unambiguous.
const UNIT_ID_RE = /^\d{1,7}$/;

function resolveInput(rawInput: string): ResolvedSearchTarget {
    const raw = rawInput.trim();
    if (!raw) return { kind: 'clear' };

    // 1. Try URL parse (GS1 Digital Link, internal /l|/s|/o prefix, etc.)
    const url = parseScannedUrl(raw);
    if (url) {
        if (url.type === 'unit') {
            // GS1 unit scans carry a unit serial. The serial_units endpoint
            // accepts a serial number, so route there directly.
            return { kind: 'unit', ref: url.unitSerial };
        } else if (url.type === 'stock') {
            return { kind: 'sku', sku: url.sku };
        } else if (url.type === 'location') {
            return { kind: 'bin', barcode: url.locationRef };
        }
        // gs1_product / gs1_lot / order / package / generic — defer to fallback
    }

    // 2. Classify by pattern
    const classified = classifyInput(raw);
    if (classified.type === 'tracking') {
        return { kind: 'tracking', tracking: classified.normalized, carrier: classified.carrier };
    }
    if (classified.type === 'serial_full' || classified.type === 'serial_partial') {
        return { kind: 'unit', ref: classified.normalized };
    }

    // 3. Heuristic shape checks
    if (UNIT_ID_RE.test(raw)) {
        return { kind: 'unit', ref: raw };
    }
    if (BIN_BARCODE_RE.test(raw)) {
        return { kind: 'bin', barcode: raw };
    }
    if (SKU_LIKE_RE.test(raw) && raw.includes('-')) {
        // SKU codes typically have at least one dash and are uppercase.
        return { kind: 'sku', sku: raw };
    }

    return { kind: 'unknown', raw };
}

export function InventoryV2SearchBar({ initial, onSubmit }: InventoryV2SearchBarProps) {
    const [draft, setDraft] = useState(initial);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setDraft(initial);
    }, [initial]);

    // `/` or `⌘K` from anywhere focuses the input.
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            const inEditable =
                target &&
                (target.tagName === 'INPUT' ||
                    target.tagName === 'TEXTAREA' ||
                    target.isContentEditable);

            if ((event.key === '/' || (event.key === 'k' && (event.metaKey || event.ctrlKey))) && !inEditable) {
                event.preventDefault();
                inputRef.current?.focus();
                inputRef.current?.select();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        const resolved = resolveInput(draft);
        onSubmit(resolved);
    };

    return (
        <form onSubmit={handleSubmit} className="relative w-full">
            <label className="sr-only" htmlFor="inventory-v2-search">
                Search SKU, unit, bin, serial, or tracking
            </label>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
                id="inventory-v2-search"
                ref={inputRef}
                type="search"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Search or scan: SKU · unit · bin · serial · tracking…"
                className="block w-full rounded-md border border-gray-200 bg-white py-2 pl-9 pr-20 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                autoComplete="off"
                spellCheck={false}
            />
            <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                {draft ? (
                    <button
                        type="button"
                        onClick={() => {
                            setDraft('');
                            onSubmit({ kind: 'clear' });
                        }}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        aria-label="Clear search"
                    >
                        <X className="h-4 w-4" />
                    </button>
                ) : null}
                <kbd className="hidden rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] text-gray-500 sm:inline-block">
                    /
                </kbd>
            </div>
        </form>
    );
}
