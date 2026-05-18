'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Loader2, ExternalLink } from '@/components/Icons';
import type { ProductDetailPayload } from './types';

interface ProductDetailProps {
    sku: string;
}

export function ProductDetail({ sku }: ProductDetailProps) {
    const [payload, setPayload] = useState<ProductDetailPayload | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        const run = async () => {
            try {
                const res = await fetch(`/api/products/${encodeURIComponent(sku)}`, {
                    credentials: 'same-origin',
                });
                if (!res.ok) {
                    let message = `HTTP ${res.status}`;
                    try {
                        const body = await res.json();
                        if (body?.error) message = body.error;
                    } catch {
                        // ignore JSON parse failure
                    }
                    throw new Error(message);
                }
                const data: ProductDetailPayload = await res.json();
                if (!cancelled) setPayload(data);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Failed to load product';
                if (!cancelled) setError(message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        run();
        return () => {
            cancelled = true;
        };
    }, [sku]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="ml-2 text-sm">Loading {sku}…</span>
            </div>
        );
    }

    if (error || !payload?.success) {
        return (
            <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
                <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error || 'Product not found'}
                </div>
                <p className="mt-4 text-sm text-gray-500">
                    <Link href="/products" className="text-blue-600 underline">
                        Back to Products
                    </Link>
                </p>
            </div>
        );
    }

    const { product, platforms, stock } = payload;

    return (
        <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
            <nav className="mb-4 text-xs text-gray-500">
                <Link href="/products" className="hover:text-gray-900">
                    Products
                </Link>
                <span className="mx-1.5">/</span>
                <span className="font-mono text-gray-700">{product.sku}</span>
            </nav>

            <header className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md border border-gray-200 bg-gray-50">
                    {product.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={product.image_url}
                            alt=""
                            className="h-full w-full object-cover"
                        />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">
                            No image
                        </div>
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <h1 className="truncate text-2xl font-semibold text-gray-900">
                        {product.product_title || product.sku}
                    </h1>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                        <span className="font-mono">{product.sku}</span>
                        {product.category ? <span>· {product.category}</span> : null}
                        {!product.is_active ? (
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium uppercase tracking-wide text-gray-500">
                                Inactive
                            </span>
                        ) : null}
                    </div>
                </div>
            </header>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <DetailCard title="Attributes">
                    <DetailRow label="GTIN" value={product.gtin} mono />
                    <DetailRow label="UPC" value={product.upc} mono />
                    <DetailRow label="Zoho Item ID" value={product.zoho_item_id} mono />
                    <DetailRow label="Category" value={product.category} />
                </DetailCard>

                <DetailCard
                    title="Live stock"
                    action={
                        <Link
                            href={`/inventory?search=${encodeURIComponent(product.sku)}`}
                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                        >
                            Open in Inventory
                            <ExternalLink className="h-3 w-3" />
                        </Link>
                    }
                >
                    <DetailRow label="Warehouse qty" value={String(stock.warehouse_qty)} />
                    {stock.units_by_status.length > 0 ? (
                        <div className="border-t border-gray-100 pt-2">
                            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                                Serial units by status
                            </div>
                            <div className="flex flex-wrap gap-1">
                                {stock.units_by_status.map((s) => (
                                    <span
                                        key={s.status}
                                        className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-700"
                                    >
                                        {s.status.toLowerCase()}: {s.count}
                                    </span>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="text-xs text-gray-400">No serial units tracked.</div>
                    )}
                </DetailCard>

                <DetailCard
                    title={`Platform links (${platforms.length})`}
                    className="sm:col-span-2"
                >
                    {platforms.length === 0 ? (
                        <div className="text-xs text-gray-400">No platform links yet.</div>
                    ) : (
                        <ul className="divide-y divide-gray-100">
                            {platforms.map((p) => (
                                <li
                                    key={p.id}
                                    className="flex flex-wrap items-baseline justify-between gap-2 py-2"
                                >
                                    <div className="flex flex-wrap items-baseline gap-2">
                                        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-700">
                                            {p.platform}
                                        </span>
                                        {p.account_name ? (
                                            <span className="text-xs text-gray-500">{p.account_name}</span>
                                        ) : null}
                                        <span className="font-mono text-xs text-gray-700">
                                            {p.platform_sku || p.platform_item_id || '—'}
                                        </span>
                                    </div>
                                    {p.display_name ? (
                                        <span className="text-xs text-gray-500">{p.display_name}</span>
                                    ) : null}
                                </li>
                            ))}
                        </ul>
                    )}
                </DetailCard>
            </div>

            <div className="mt-6 text-xs text-gray-500">
                Looking for ops controls?{' '}
                <Link
                    href={`/admin/inventory-v2/sku/${encodeURIComponent(product.sku)}`}
                    className="text-blue-600 underline"
                >
                    Open admin drill-down
                </Link>
            </div>
        </div>
    );
}

interface DetailCardProps {
    title: string;
    action?: React.ReactNode;
    className?: string;
    children: React.ReactNode;
}

function DetailCard({ title, action, className, children }: DetailCardProps) {
    return (
        <section
            className={`rounded-lg border border-gray-200 bg-white p-4 ${className ?? ''}`}
        >
            <header className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
                {action}
            </header>
            <div className="space-y-1.5 text-sm">{children}</div>
        </section>
    );
}

interface DetailRowProps {
    label: string;
    value: string | null;
    mono?: boolean;
}

function DetailRow({ label, value, mono }: DetailRowProps) {
    return (
        <div className="flex items-baseline gap-2 text-xs">
            <span className="w-28 shrink-0 text-gray-500">{label}</span>
            <span className={`flex-1 truncate ${mono ? 'font-mono' : ''} ${value ? 'text-gray-900' : 'text-gray-400'}`}>
                {value || '—'}
            </span>
        </div>
    );
}
