'use client';

import React from 'react';

interface ActiveProductInfoProps {
    orderId?: string;
    productTitle?: string;
}

export default function ActiveProductInfo({ orderId, productTitle }: ActiveProductInfoProps) {
    // Don't render if no data
    if (!orderId && !productTitle) {
        return null;
    }

    return (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
                Current Order -
            </p>
            {orderId && (
                <p className="text-xs font-mono font-semibold text-gray-600">
                    {orderId}
                </p>
            )}
            {productTitle && (
                <p className="text-base font-black text-gray-900 leading-tight tracking-tight">
                    {productTitle}
                </p>
            )}
        </div>
    );
}
