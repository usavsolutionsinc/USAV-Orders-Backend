'use client';

import { useEffect } from 'react';
import { ChevronDown, X } from '@/components/Icons';
import { microBadge } from '@/design-system/tokens/typography/presets';
import {
    dispatchCloseInventoryDetails,
    dispatchNavigateInventoryDetails,
} from '@/lib/inventory-events-channel';

export interface InventoryDetailPanelShellProps {
    title: string;
    subtitle?: string;
    eyebrow: string;
    onClose?: () => void;
    /** When false, hides the up/down nav arrows in the header. */
    showNavigation?: boolean;
    children: React.ReactNode;
}

/**
 * Inline container shared by all inventory detail panels.
 *
 * Phase 2 mounted this as a fixed right-side slide-in. Phase 5b refactors
 * to render as the *main* right-pane content — the panel now fills its
 * parent and uses normal flex flow. The previous overlay behavior is gone:
 * detail content is the primary view, not a slide-over.
 */
export function InventoryDetailPanelShell({
    title,
    subtitle,
    eyebrow,
    onClose,
    showNavigation = true,
    children,
}: InventoryDetailPanelShellProps) {
    const close = () => {
        onClose?.();
        dispatchCloseInventoryDetails();
    };

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close();
            else if (e.key === '[') dispatchNavigateInventoryDetails('up');
            else if (e.key === ']') dispatchNavigateInventoryDetails('down');
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <section
            className="flex h-full min-h-0 w-full flex-col bg-white"
            role="region"
            aria-label={`${eyebrow} detail`}
        >
            <header className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
                <div className="min-w-0 flex-1">
                    <p className={`${microBadge} text-blue-600`}>{eyebrow}</p>
                    <h2 className="mt-1 truncate text-xl font-black uppercase tracking-tight text-gray-900">
                        {title}
                    </h2>
                    {subtitle ? (
                        <p className="mt-1 truncate text-sm text-gray-600">{subtitle}</p>
                    ) : null}
                </div>
                <div className="flex items-center gap-1">
                    {showNavigation ? (
                        <>
                            <button
                                type="button"
                                onClick={() => dispatchNavigateInventoryDetails('up')}
                                className="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-500 transition-colors hover:border-blue-200 hover:text-blue-600"
                                title="Previous result ([)"
                                aria-label="Previous result"
                            >
                                <ChevronDown className="h-4 w-4 rotate-180" />
                            </button>
                            <button
                                type="button"
                                onClick={() => dispatchNavigateInventoryDetails('down')}
                                className="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-500 transition-colors hover:border-blue-200 hover:text-blue-600"
                                title="Next result (])"
                                aria-label="Next result"
                            >
                                <ChevronDown className="h-4 w-4" />
                            </button>
                        </>
                    ) : null}
                    <button
                        type="button"
                        onClick={close}
                        className="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-500 transition-colors hover:border-red-200 hover:text-red-600"
                        title="Close (Esc)"
                        aria-label="Close detail"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">
                {children}
            </div>
        </section>
    );
}
