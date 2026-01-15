'use client';

import React from 'react';

type BadgeVariant = 'ups' | 'usps' | 'fedex' | 'unknown' | 'success' | 'error' | 'warning' | 'info';

interface StatusBadgeProps {
    variant: BadgeVariant;
    children: React.ReactNode;
    className?: string;
}

/**
 * Status badge component with predefined color variants
 */
export function StatusBadge({ variant, children, className = '' }: StatusBadgeProps) {
    const variants: Record<BadgeVariant, string> = {
        ups: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
        usps: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
        fedex: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
        unknown: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
        success: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
        error: 'bg-red-500/10 text-red-600 border-red-500/20',
        warning: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
        info: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    };

    return (
        <span className={`inline-flex items-center px-2 py-1 rounded-lg border text-[10px] font-black uppercase tracking-wider ${variants[variant]} ${className}`}>
            {children}
        </span>
    );
}

/**
 * Get badge variant based on carrier name
 */
export function getCarrierVariant(carrier: string): BadgeVariant {
    const normalized = carrier.toLowerCase();
    if (normalized.includes('ups')) return 'ups';
    if (normalized.includes('usps')) return 'usps';
    if (normalized.includes('fedex')) return 'fedex';
    return 'unknown';
}
