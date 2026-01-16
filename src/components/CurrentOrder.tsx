'use client';

import React from 'react';
import { Package } from './Icons';

interface CurrentOrderProps {
    orderId?: string;
    productTitle?: string;
}

export default function CurrentOrder({ orderId, productTitle }: CurrentOrderProps) {
    if (!orderId && !productTitle) {
        return null;
    }

    return (
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2 mb-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
                <p className="text-[9px] font-black text-blue-600 uppercase tracking-widest">Current Order</p>
            </div>

            {orderId && (
                <div className="space-y-1">
                    <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">Order ID</p>
                    <p className="text-xs font-mono font-bold text-gray-700">{orderId}</p>
                </div>
            )}

            {productTitle && (
                <div className="space-y-1">
                    <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">Product</p>
                    <p className="text-base font-black text-gray-900 leading-tight tracking-tight">
                        {productTitle}
                    </p>
                </div>
            )}
        </div>
    );
}
