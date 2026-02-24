'use client';

import { Search, X, Loader2 } from '../Icons';

interface SearchBarProps {
    value: string;
    onChange: (value: string) => void;
    onSearch?: (value: string) => void;
    onClear?: () => void;
    inputRef?: React.Ref<HTMLInputElement>;
    placeholder?: string;
    isSearching?: boolean;
    className?: string;
    variant?: 'blue' | 'orange' | 'emerald' | 'purple' | 'red';
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
    rightElement
}: SearchBarProps) {
    const focusRingColor = {
        blue: 'focus:ring-blue-500/10 focus:border-blue-500',
        orange: 'focus:ring-orange-500/10 focus:border-orange-500',
        emerald: 'focus:ring-emerald-500/10 focus:border-emerald-500',
        purple: 'focus:ring-purple-500/10 focus:border-purple-500',
        red: 'focus:ring-red-500/10 focus:border-red-500',
    }[variant];

    const iconColor = {
        blue: 'group-focus-within:text-blue-600',
        orange: 'group-focus-within:text-orange-600',
        emerald: 'group-focus-within:text-emerald-600',
        purple: 'group-focus-within:text-purple-600',
        red: 'group-focus-within:text-red-600',
    }[variant];

    const loaderColor = {
        blue: 'text-blue-600',
        orange: 'text-orange-600',
        emerald: 'text-emerald-600',
        purple: 'text-purple-600',
        red: 'text-red-600',
    }[variant];

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (onSearch) onSearch(value);
    };

    const handleClear = () => {
        onChange('');
        if (onClear) onClear();
    };

    return (
        <div className={`flex items-center gap-2 ${className}`}>
            <form onSubmit={handleSubmit} className="relative group flex-1">
                <div className={`absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 ${iconColor} transition-colors`}>
                    <Search className="w-4 h-4" />
                </div>
                <input 
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    className={`w-full pl-11 pr-10 py-3 bg-gray-50 border border-gray-100 rounded-2xl text-[11px] font-bold ${focusRingColor} outline-none transition-all shadow-inner`}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    {isSearching ? (
                        <Loader2 className={`w-4 h-4 animate-spin ${loaderColor}`} />
                    ) : value && (
                        <button 
                            type="button"
                            onClick={handleClear}
                            className="p-1 hover:bg-gray-200 rounded-lg transition-all text-gray-400"
                        >
                            <X className="w-3 h-3" />
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
