'use client';

import { Search, X, Loader2, Clipboard } from '../Icons';

interface SearchBarProps {
    value: string;
    onChange: (value: string) => void;
    onSearch?: (value: string) => void;
    onClear?: () => void;
    inputRef?: React.Ref<HTMLInputElement>;
    placeholder?: string;
    isSearching?: boolean;
    className?: string;
    variant?: 'blue' | 'orange' | 'emerald' | 'purple' | 'red' | 'gray';
    size?: 'default' | 'compact';
    rightElement?: React.ReactNode;
}

export function SearchBar({
    value,
    onChange,
    onSearch,
    onClear,
    inputRef,
    placeholder = "Search...",
    isSearching = false,
    className = "",
    variant = 'blue',
    size = 'default',
    rightElement
}: SearchBarProps) {
    const focusRingColor = {
        blue: 'focus:ring-blue-500/10 focus:border-blue-500',
        orange: 'focus:ring-orange-500/10 focus:border-orange-500',
        emerald: 'focus:ring-emerald-500/10 focus:border-emerald-500',
        purple: 'focus:ring-purple-500/10 focus:border-purple-500',
        red: 'focus:ring-red-500/10 focus:border-red-500',
        gray: 'focus:ring-gray-900/10 focus:border-gray-900',
    }[variant];

    const iconColor = {
        blue: 'group-focus-within:text-blue-600',
        orange: 'group-focus-within:text-orange-600',
        emerald: 'group-focus-within:text-emerald-600',
        purple: 'group-focus-within:text-purple-600',
        red: 'group-focus-within:text-red-600',
        gray: 'group-focus-within:text-gray-900',
    }[variant];

    const loaderColor = {
        blue: 'text-blue-600',
        orange: 'text-orange-600',
        emerald: 'text-emerald-600',
        purple: 'text-purple-600',
        red: 'text-red-600',
        gray: 'text-gray-900',
    }[variant];

    const sizeClasses = size === 'compact'
        ? {
            icon: 'left-3.5',
            input: 'pl-10 pr-9 py-2.5 text-[10px] rounded-xl',
            clear: 'right-2.5',
          }
        : {
            icon: 'left-4',
            input: 'pl-11 pr-10 py-3 text-[11px] rounded-2xl',
            clear: 'right-3',
          };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (onSearch) onSearch(value);
    };

    const handleClear = () => {
        onChange('');
        if (onClear) onClear();
    };

    const handlePaste = async () => {
        try {
            const text = await navigator.clipboard.readText();
            const trimmed = text.trim();
            if (trimmed) onChange(trimmed);
        } catch {
            // clipboard permission denied
        }
    };

    return (
        <div className={`flex items-center gap-2 ${className}`}>
            <form onSubmit={handleSubmit} className="relative group flex-1">
                <div className={`absolute ${sizeClasses.icon} top-1/2 -translate-y-1/2 text-gray-400 ${iconColor} transition-colors`}>
                    <Search className="w-4 h-4" />
                </div>
                <input 
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    className={`w-full border border-gray-100 bg-gray-50 font-bold ${focusRingColor} outline-none transition-all shadow-inner ${sizeClasses.input}`}
                />
                <div className={`absolute ${sizeClasses.clear} top-1/2 -translate-y-1/2 flex items-center gap-1`}>
                    {isSearching ? (
                        <Loader2 className={`w-4 h-4 animate-spin ${loaderColor}`} />
                    ) : value ? (
                        <button 
                            type="button"
                            onClick={handleClear}
                            className="p-1 hover:bg-gray-200 rounded-lg transition-all text-gray-400"
                            title="Clear search"
                            aria-label="Clear search"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    ) : (
                        <button 
                            type="button"
                            onClick={handlePaste}
                            className="p-1 hover:bg-gray-200 rounded-lg transition-all text-gray-400"
                            title="Paste from clipboard"
                            aria-label="Paste from clipboard"
                        >
                            <Clipboard className="w-3 h-3" />
                        </button>
                    )}
                </div>
            </form>
            {rightElement && (
                <div className="flex-shrink-0">
                    {rightElement}
                </div>
            )}
        </div>
    );
}
