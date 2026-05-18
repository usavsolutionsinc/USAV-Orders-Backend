import { Suspense } from 'react';
import Link from 'next/link';
import { ProductDetail } from '@/components/products/ProductDetail';

interface ProductDetailPageProps {
    params: Promise<{ sku: string }>;
}

export default async function ProductDetailPage({ params }: ProductDetailPageProps) {
    const { sku: rawSku } = await params;
    const sku = decodeURIComponent(rawSku || '').trim();

    if (!sku) {
        return (
            <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
                <p className="text-sm text-gray-500">
                    Missing SKU.{' '}
                    <Link href="/products" className="text-blue-600 underline">
                        Back to Products
                    </Link>
                </p>
            </div>
        );
    }

    return (
        <div className="min-h-full bg-gray-50">
            <Suspense fallback={<div className="p-6 text-sm text-gray-400">Loading {sku}…</div>}>
                <ProductDetail sku={sku} />
            </Suspense>
        </div>
    );
}
