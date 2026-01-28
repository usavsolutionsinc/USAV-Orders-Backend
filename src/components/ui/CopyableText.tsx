'use client';

import React, { useState } from 'react';
import { Copy, Check } from '../Icons';

interface CopyableTextProps {
    text: string;
    className?: string;
    disabled?: boolean;
    variant?: 'serial' | 'order' | 'tracking' | 'default';
}

/**
 * A text component that can be copied to clipboard on click
 * Supports different display lengths for various IDs
 */
export function CopyableText({ text, className = '', disabled = false, variant = 'default' }: CopyableTextProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!text || disabled || text === '---') return;
        
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // Calculate display text based on variant
    const getDisplayText = () => {
        if (!text) return '---';
        
        switch (variant) {
            case 'serial':
                return text.length > 6 ? text.slice(-6) : text;
            case 'order':
            case 'tracking':
                return text.length > 10 ? text.slice(-10) : text;
            default:
                return text.length > 8 ? text.slice(-8) : text;
        }
    };

    const displayText = getDisplayText();
    const isEmpty = !text || text === '---' || disabled;

    if (isEmpty) {
        return (
            <div className={`${className} flex items-center justify-start w-full opacity-40`}>
                <span className="text-left">---</span>
            </div>
        );
    }

    return (
        <button 
            onClick={handleCopy}
            className={`${className} group relative flex items-center justify-start gap-2 hover:brightness-95 active:scale-95 transition-all w-fit`}
            title={`Click to copy: ${text}`}
        >
            <span className="truncate text-left">{displayText}</span>
            {copied ? (
                <Check className="w-2.5 h-2.5 text-emerald-600" />
            ) : (
                <Copy className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400" />
            )}
        </button>
    );
}
