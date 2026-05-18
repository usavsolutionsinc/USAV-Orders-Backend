'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X } from '@/components/Icons';

const STORAGE_KEY = 'inventory-moved-banner.dismissed.v1';
// Temporary banner. After this date the banner self-removes regardless of
// dismissal state — bookmarks have had time to update.
const EXPIRES_AT = new Date('2026-06-15T00:00:00Z').getTime();

export function InventoryMovedBanner() {
    const [hidden, setHidden] = useState(true);

    useEffect(() => {
        if (Date.now() >= EXPIRES_AT) return;
        const stored = (() => {
            try {
                return window.localStorage.getItem(STORAGE_KEY);
            } catch {
                return null;
            }
        })();
        if (stored !== '1') setHidden(false);
    }, []);

    if (hidden) return null;

    const dismiss = () => {
        try {
            window.localStorage.setItem(STORAGE_KEY, '1');
        } catch {
            // localStorage blocked — fall back to in-memory hide
        }
        setHidden(true);
    };

    return (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 sm:px-6">
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
                <p>
                    Looking for the warehouse map? It moved to{' '}
                    <Link href="/warehouse" className="font-medium underline">
                        /warehouse
                    </Link>
                    . This page is now the live inventory ledger.
                </p>
                <button
                    type="button"
                    onClick={dismiss}
                    aria-label="Dismiss"
                    className="shrink-0 rounded p-1 text-amber-800 hover:bg-amber-100"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}
