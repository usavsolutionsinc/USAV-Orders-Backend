'use client';

import { Menu } from './Icons';
import { useHeader } from '@/contexts/HeaderContext';

interface HeaderProps {
    onMenuClick: () => void;
    sidebarOpen: boolean;
}

export default function Header({ onMenuClick, sidebarOpen }: HeaderProps) {
    const { panelContent } = useHeader();

    return (
        <header className="fixed top-0 left-0 right-0 h-14 bg-white border-b border-gray-200 z-[100] flex items-center px-4">
            {/* Hamburger Menu */}
            <button
                onClick={onMenuClick}
                className={`p-2.5 rounded-xl transition-all duration-300 border ${
                    sidebarOpen 
                        ? 'bg-gray-100 border-gray-300 text-gray-900' 
                        : 'bg-white border-gray-200 text-gray-900 hover:bg-gray-50'
                }`}
                aria-label="Toggle menu"
            >
                <Menu className="w-5 h-5" />
            </button>

            {/* Panel-specific content */}
            <div className="flex-1 flex items-center justify-center">
                {panelContent}
            </div>

            {/* Right side spacer for symmetry */}
            <div className="w-[42px]" />
        </header>
    );
}
