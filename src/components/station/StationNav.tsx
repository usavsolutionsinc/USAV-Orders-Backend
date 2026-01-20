'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  LayoutDashboard, 
  PackageCheck, 
  Wrench, 
  User, 
  Settings,
  Box,
  ClipboardList,
  Calendar,
  ShieldCheck,
  Search,
  Plus,
  X,
  Tool
} from '../Icons';

interface StationNavProps {
  isOpen?: boolean;
  onClose?: () => void;
}

// Reordered navigation items (removed Orders)
const mainNavItems = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Receiving', href: '/receiving', icon: ClipboardList },
    { name: 'Shipped', href: '/shipped', icon: PackageCheck },
    { name: 'Repair', href: '/repair', icon: Tool },
    { name: 'Sku Stock', href: '/sku-stock', icon: Box },
];

const packerItems = [
    { name: 'Tuan (Packer 1)', href: '/packer/1', icon: User },
    { name: 'Thuy (Packer 2)', href: '/packer/2', icon: User },
];

const techItems = [
    { name: 'Michael (Tech 1)', href: '/tech/1', icon: Wrench },
    { name: 'Thuc (Tech 2)', href: '/tech/2', icon: Wrench },
    { name: 'Sang (Tech 3)', href: '/tech/3', icon: Wrench },
];

const bottomNavItems = [
    { name: 'Sku Manager', href: '/sku', icon: Settings },
    { name: 'Quarters', href: '/previous-quarters', icon: Calendar },
    { name: 'Admin', href: '/admin', icon: ShieldCheck },
];

export default function StationNav({ isOpen = true, onClose }: StationNavProps) {
    const pathname = usePathname();
    const router = useRouter();
    const [searchQuery, setSearchQuery] = useState('');

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        if (searchQuery.trim()) {
            router.push(`/shipped?search=${encodeURIComponent(searchQuery.trim())}`);
            setSearchQuery('');
        }
    };

    const handleNavClick = () => {
        if (onClose) {
            onClose();
        }
    };

    const renderNavItem = (item: typeof mainNavItems[0]) => {
        const isActive = pathname === item.href;
        const Icon = item.icon;
        
        return (
            <Link
                key={item.href}
                href={item.href}
                onClick={handleNavClick}
                className={`group flex items-center gap-4 px-4 py-3 rounded-2xl transition-all duration-300 relative ${
                    isActive
                        ? 'bg-blue-600 text-white shadow-xl shadow-blue-600/25 scale-[1.02]'
                        : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                }`}
            >
                <div className={`transition-transform duration-300 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`}>
                    <Icon className={`w-5 h-5 ${isActive ? 'text-white' : 'text-gray-400 group-hover:text-blue-500'}`} />
                </div>
                <span className="text-sm font-black tracking-tight uppercase whitespace-nowrap">{item.name}</span>
                {isActive && (
                    <motion.div 
                        layoutId="activeIndicator"
                        className="ml-auto w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" 
                    />
                )}
            </Link>
        );
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    {onClose && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={onClose}
                            className="fixed inset-0 bg-black/20 z-[140] backdrop-blur-sm"
                        />
                    )}

                    {/* Sidebar */}
                    <motion.div
                        initial={{ x: '-100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '-100%' }}
                        transition={{ type: 'spring', damping: 25, stiffness: 120 }}
                        className="fixed top-0 left-0 h-screen w-[280px] bg-white z-[150] shadow-2xl flex flex-col overflow-hidden"
                    >
                        {/* Close button */}
                        {onClose && (
                            <button
                                onClick={onClose}
                                className="absolute top-4 right-4 p-2 hover:bg-gray-100 rounded-lg transition-all z-10"
                                aria-label="Close menu"
                            >
                                <X className="w-5 h-5 text-gray-600" />
                            </button>
                        )}

                        <div className="flex flex-col h-full px-4 py-6 overflow-y-auto">
                            {/* Logo Area */}
                            <div className="mb-8 px-2 flex items-center gap-3">
                                <div>
                                    <h1 className="text-2xl font-black text-gray-900 leading-tight tracking-tighter uppercase">USAV</h1>
                                </div>
                            </div>

                            {/* Search Bar and Repair Button */}
                            <div className="mb-6 space-y-3">
                                <form onSubmit={handleSearch} className="relative">
                                    <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                                        <Search className="w-4 h-4 text-gray-400" />
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="Quick search..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2.5 pl-10 pr-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all placeholder:text-gray-400"
                                    />
                                </form>

                                <Link
                                    href="/repair?new=true"
                                    onClick={handleNavClick}
                                    className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white rounded-xl transition-all active:scale-95 shadow-lg shadow-orange-500/20"
                                >
                                    <Plus className="w-4 h-4" />
                                    <span className="text-sm font-black uppercase tracking-wider">Repair Service</span>
                                </Link>
                            </div>

                            {/* Navigation Header */}
                            <div className="mb-4 px-2">
                                <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600 mb-1">Navigation</h2>
                                <p className="text-xl font-black text-gray-900 tracking-tighter">Menu</p>
                            </div>
                            
                            {/* Main Navigation */}
                            <nav className="space-y-1 flex-1">
                                {mainNavItems.map(renderNavItem)}

                                {/* Packers Section */}
                                <div className="pt-4">
                                    <h3 className="px-2 mb-2 text-[9px] font-black uppercase tracking-[0.2em] text-gray-400">
                                        Packers
                                    </h3>
                                    <div className="space-y-1">
                                        {packerItems.map(renderNavItem)}
                                    </div>
                                </div>

                                {/* Techs Section */}
                                <div className="pt-4">
                                    <h3 className="px-2 mb-2 text-[9px] font-black uppercase tracking-[0.2em] text-gray-400">
                                        Techs
                                    </h3>
                                    <div className="space-y-1">
                                        {techItems.map(renderNavItem)}
                                    </div>
                                </div>

                                {/* Bottom Navigation */}
                                <div className="pt-4">
                                    {bottomNavItems.map(renderNavItem)}
                                </div>
                            </nav>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
