'use client';

import React from 'react';
import { Loader2 } from '../Icons';

interface LoadingSpinnerProps {
    size?: 'sm' | 'md' | 'lg';
    className?: string;
    fullScreen?: boolean;
}

/**
 * Loading spinner component with different size variants
 */
export function LoadingSpinner({ 
    size = 'md', 
    className = '',
    fullScreen = false,
}: LoadingSpinnerProps) {
    const sizeClasses = {
        sm: 'w-4 h-4',
        md: 'w-6 h-6',
        lg: 'w-8 h-8',
    };

    const spinner = (
        <Loader2 className={`animate-spin ${sizeClasses[size]} ${className}`} />
    );

    if (fullScreen) {
        return (
            <div className="flex items-center justify-center w-full h-full min-h-[200px]">
                {spinner}
            </div>
        );
    }

    return spinner;
}
