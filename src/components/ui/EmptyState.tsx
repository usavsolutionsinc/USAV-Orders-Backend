'use client';

import React from 'react';

interface EmptyStateProps {
    icon?: React.ReactNode;
    title: string;
    description?: string;
    action?: React.ReactNode;
    className?: string;
}

/**
 * Empty state component for consistent empty views
 */
export function EmptyState({
    icon,
    title,
    description,
    action,
    className = '',
}: EmptyStateProps) {
    return (
        <div className={`flex flex-col items-center justify-center text-center space-y-4 py-12 ${className}`}>
            {icon && (
                <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center border border-gray-100">
                    {icon}
                </div>
            )}
            <div className="space-y-2">
                <h3 className="text-lg font-black text-gray-900">{title}</h3>
                {description && (
                    <p className="text-sm text-gray-500 max-w-sm">{description}</p>
                )}
            </div>
            {action && <div className="pt-2">{action}</div>}
        </div>
    );
}
