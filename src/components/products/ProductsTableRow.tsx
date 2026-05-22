'use client';

import Link from 'next/link';
import { ChevronRight, ExternalLink } from '@/components/Icons';
import type { ProductListRow } from './types';

interface ProductsTableRowProps {
    row: ProductListRow;
}

export function ProductsTableRow({ row }: ProductsTableRowProps) {
    const skuHref = `/products/${encodeURIComponent(row.sku)}`;
    const inventoryHref = `/inventory?search=${encodeURIComponent(row.sku)}`;
    const adminHref = `/admin/inventory-v2/sku/${encodeURIComponent(row.sku)}`;

    return (
        <div className="group relative flex items-center gap-3 border-b border-gray-100 px-4 py-2.5 hover:bg-blue-50/40 sm:px-6">
            <Link
                href={skuHref}
                aria-label={row.product_title || row.sku}
                className="absolute inset-0 z-0 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
                <span className="sr-only">{row.product_title || row.sku}</span>
            </Link>

            <div className="pointer-events-none relative z-[1] flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-gray-100 bg-gray-50">
                {row.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={row.image_url}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                    />
                ) : (
                    <span className="text-[10px] font-mono uppercase text-gray-400">
                        {(row.sku || '?').slice(0, 3)}
                    </span>
                )}
            </div>

            <div className="pointer-events-none relative z-[1] min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                    <span className="truncate font-mono text-xs text-gray-500">{row.sku}</span>
                    {!row.is_active ? (
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                            Inactive
                        </span>
                    ) : null}
                </div>
                <div className="truncate text-sm text-gray-900">
                    {row.product_title || <span className="text-gray-400">Untitled</span>}
                </div>
            </div>

            <div className="pointer-events-none relative z-[1] hidden shrink-0 text-xs text-gray-500 sm:block">
                {row.category || '—'}
            </div>

            <div className="pointer-events-none relative z-[1] hidden shrink-0 sm:block">
                {row.gtin ? (
                    <span className="font-mono text-[11px] text-gray-500">{row.gtin}</span>
                ) : (
                    <span className="text-[11px] text-gray-300">no GTIN</span>
                )}
            </div>

            <div className="pointer-events-none relative z-[1] hidden shrink-0 sm:block">
                {row.has_ecwid_link ? (
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">
                        Ecwid
                    </span>
                ) : (
                    <span className="text-[10px] uppercase tracking-wide text-gray-300">—</span>
                )}
            </div>

            <div className="relative z-[1] flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <RowAction href={inventoryHref} label="Inventory" />
                <RowAction href={adminHref} label="Admin" external />
            </div>

            <ChevronRight className="pointer-events-none relative z-[1] h-4 w-4 shrink-0 text-gray-300 group-hover:text-gray-500" />
        </div>
    );
}

interface RowActionProps {
    href: string;
    label: string;
    external?: boolean;
}

function RowAction({ href, label, external }: RowActionProps) {
    return (
        <Link
            href={href}
            onClick={(event) => event.stopPropagation()}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-gray-500 hover:bg-white hover:text-gray-900"
        >
            {label}
            {external ? <ExternalLink className="h-3 w-3" /> : null}
        </Link>
    );
}
