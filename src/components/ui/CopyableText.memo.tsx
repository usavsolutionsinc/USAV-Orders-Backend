'use client';

import React, { useState, memo } from 'react';
import { Copy, Check } from '../Icons';

interface CopyableTextProps {
    text: string;
    className?: string;
    disabled?: boolean;
}

/**
 * Memoized version of CopyableText for performance
 * Only re-renders when props change
 */
export const CopyableTextMemo = memo(function CopyableText({ 
    text, 
    className = '', 
    disabled = false 
}: CopyableTextProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!text || disabled || text === '---') return;
        
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // Show last 8 characters, no dots
    const displayText = text.length > 8 ? text.slice(-8) : text;
    const isEmpty = !text || text === '---' || disabled;

    if (isEmpty) {
        return (
            <div className={`${className} flex items-center justify-center w-full opacity-40`}>
                <span className="text-left w-full">---</span>
            </div>
        );
    }

    return (
        <button 
            onClick={handleCopy}
            className={`${className} group relative flex items-center justify-between gap-1 hover:brightness-95 active:scale-95 transition-all w-full`}
            title={`Click to copy: ${text}`}
        >
            <span className="truncate flex-1 text-left">{displayText}</span>
            {copied ? (
                <Check className="w-2 h-2" />
            ) : (
                <Copy className="w-2 h-2 opacity-0 group-hover:opacity-40 transition-opacity" />
            )}
        </button>
    );
}, (prevProps, nextProps) => {
    // Custom comparison for better performance
    return prevProps.text === nextProps.text && 
           prevProps.className === nextProps.className && 
           prevProps.disabled === nextProps.disabled;
});
