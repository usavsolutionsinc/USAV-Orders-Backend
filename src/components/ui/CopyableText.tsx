'use client';

import React, { MouseEvent, ReactNode, useState } from 'react';
import { Copy, Check, MapPin } from '../Icons';

export interface IdentifierRowProps {
    text: string;
    displayText: string;
    icon: ReactNode;
    underlineClassName: string;
}

export function IdentifierRow({ text, displayText, icon, underlineClassName }: IdentifierRowProps) {
    const [copied, setCopied] = useState(false);
    const isEmpty = !text || text === '---';

    const handleCopy = (event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        if (isEmpty) return;
        navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className={`flex min-w-0 items-center gap-3 border-b-2 pb-1 ${underlineClassName}`}>
            <div className="flex h-6 w-6 shrink-0 items-center justify-center text-black">
                {icon}
            </div>
            <div className="min-w-0 flex-1 truncate text-[12px] font-black tracking-tight text-black">
                {isEmpty ? '---' : displayText}
            </div>
            <button
                type="button"
                onClick={handleCopy}
                disabled={isEmpty}
                title={isEmpty ? 'Nothing to copy' : `Copy ${text}`}
                className="flex h-5 w-5 shrink-0 items-center justify-center text-black transition-transform hover:scale-105 disabled:cursor-default disabled:opacity-30"
            >
                {copied
                    ? <Check className="h-4 w-4 text-black" />
                    : <span className="text-[13px] leading-none">📋</span>}
            </button>
        </div>
    );
}

export const OrderIdRow = ({ text }: { text: string }) => (
    <IdentifierRow
        text={text}
        displayText={text ? `#${text}` : '---'}
        icon={<span className="text-[18px] font-black leading-none">#</span>}
        underlineClassName="border-gray-300"
    />
);

export const TrackingRow = ({ text }: { text: string }) => (
    <IdentifierRow
        text={text}
        displayText={text || '---'}
        icon={<MapPin className="h-5 w-5 text-red-600" />}
        underlineClassName="border-blue-500"
    />
);

export const SerialRow = ({ text, displayText }: { text: string; displayText?: string }) => (
    <IdentifierRow
        text={text}
        displayText={displayText ?? (text || '---')}
        icon={<span className="text-[17px] leading-none">🏷️</span>}
        underlineClassName="border-emerald-500"
    />
);

interface CopyableTextProps {
    text: string;
    displayText?: string;
    className?: string;
    disabled?: boolean;
    variant?: 'serial' | 'order' | 'tracking' | 'default';
}

/**
 * A text component that can be copied to clipboard on click
 * Supports different display lengths for various IDs
 */
export function CopyableText({ text, displayText, className = '', disabled = false, variant = 'default' }: CopyableTextProps) {
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

    const resolvedDisplayText = displayText ?? getDisplayText();
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
            <span className="truncate text-left">{resolvedDisplayText}</span>
            {copied ? (
                <Check className="w-2.5 h-2.5 text-emerald-600" />
            ) : (
                <Copy className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400" />
            )}
        </button>
    );
}
