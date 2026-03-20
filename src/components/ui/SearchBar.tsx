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
    leadingIcon?: React.ReactNode;
    autoFocus?: boolean;
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
    rightElement,
    leadingIcon,
    autoFocus = false,
}: SearchBarProps) {
    const iconColor = 'group-focus-within:text-blue-600 group-hover:text-blue-600';

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
            icon: 'left-0.5',
            input: 'h-7 pl-5 pr-7 text-[12px]',
            clear: 'right-0.5',
            rightSlot: 'h-7',
          }
        : {
            icon: 'left-0.5',
            input: 'h-8 pl-6 pr-8 text-[13px]',
            clear: 'right-1',
            rightSlot: 'h-8',
          };
    const iconNode = leadingIcon || <Search className="w-[14px] h-[14px]" />;

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
        <div className={`flex w-full min-w-0 items-center gap-2 ${className}`}>
            <form
                onSubmit={handleSubmit}
                className="relative group w-full min-w-0 flex-1 border-b-2 border-blue-200 transition-colors duration-150 ease-out hover:border-blue-300 focus-within:border-blue-500 focus-within:hover:border-blue-500"
            >
                <div className={`absolute ${sizeClasses.icon} top-1/2 -translate-y-1/2 text-gray-400 ${iconColor} transition-colors duration-150`}>
                    {iconNode}
                </div>
                <input 
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    autoFocus={autoFocus}
                    className={`w-full border-0 bg-transparent font-bold text-gray-900 placeholder:text-gray-400 outline-none ${sizeClasses.input}`}
                />
                <div className={`absolute ${sizeClasses.clear} top-1/2 -translate-y-1/2 flex items-center gap-1`}>
                    {isSearching ? (
                        <Loader2 className={`w-[14px] h-[14px] animate-spin ${loaderColor}`} />
                    ) : value ? (
                        <button 
                            type="button"
                            onClick={handleClear}
                            className="p-0.5 transition-all duration-100 ease-out text-gray-400 hover:text-gray-900 active:scale-95"
                            title="Clear search"
                            aria-label="Clear search"
                        >
                            <X className="w-[13px] h-[13px]" />
                        </button>
                    ) : (
                        <button 
                            type="button"
                            onClick={handlePaste}
                            className="p-0.5 transition-all duration-100 ease-out text-gray-400 hover:text-blue-600 active:scale-95"
                            title="Paste from clipboard"
                            aria-label="Paste from clipboard"
                        >
                            <Clipboard className="w-[13px] h-[13px]" />
                        </button>
                    )}
                </div>
            </form>
            {rightElement && (
                <div className={`flex shrink-0 items-center ${sizeClasses.rightSlot}`}>
                    {rightElement}
                </div>
            )}
        </div>
    );
}
