'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
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
  Tool,
  Menu,
  ChevronLeft,
  ChevronRight
} from '../Icons';

interface StationNavProps {
  // No longer needs isOpen/onClose as it's permanent
}

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

export default function StationNav() {
    const pathname = usePathname();
    const router = useRouter();
    const [searchQuery, setSearchQuery] = useState('');
    const [isCollapsed, setIsCollapsed] = useState(true); // Default to collapsed

    // Persist collapsed state
    useEffect(() => {
        const saved = localStorage.getItem('sidebar-collapsed');
        if (saved !== null) {
            setIsCollapsed(saved === 'true');
        } else {
            setIsCollapsed(true); // Default to collapsed if not set
        }
    }, []);

    const toggleCollapsed = () => {
        const newState = !isCollapsed;
        setIsCollapsed(newState);
        localStorage.setItem('sidebar-collapsed', String(newState));
    };

    const handleHamburgerMouseEnter = () => {
        setIsCollapsed(false);
    };

    const handleSidebarMouseLeave = () => {
        setIsCollapsed(true);
        localStorage.setItem('sidebar-collapsed', 'true');
    };

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        if (searchQuery.trim()) {
            router.push(`/shipped?search=${encodeURIComponent(searchQuery.trim())}`);
            setSearchQuery('');
        }
    };

    const renderNavItem = (item: typeof mainNavItems[0], isQuickAccess = false) => {
        const isActive = pathname === item.href;
        const Icon = item.icon;
        
        return (
            <Link
                key={item.href}
                href={item.href}
                title={isCollapsed ? item.name : undefined}
                className={`group flex items-center transition-all duration-300 relative ${
                    isCollapsed ? 'p-2.5 rounded-xl' : 'gap-4 px-4 rounded-2xl'
                } ${
                    isActive
                        ? isCollapsed 
                            ? 'text-blue-600'
                            : 'bg-blue-600 text-white shadow-xl shadow-blue-600/25 scale-[1.02]'
                        : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                }`}
            >
                <div className={`transition-transform duration-300 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`}>
                    <Icon className={`w-5 h-5 ${isActive ? (isCollapsed ? 'text-blue-600' : 'text-white') : 'text-gray-400 group-hover:text-blue-500'}`} />
                </div>
                {!isCollapsed && (
                    <span className="text-sm font-black tracking-tight uppercase whitespace-nowrap">{item.name}</span>
                )}
                {isActive && !isCollapsed && (
                    <motion.div 
                        layoutId="activeIndicator"
                        className="ml-auto w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" 
                    />
                )}
                {isActive && isCollapsed && (
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-blue-600 rounded-l-full shadow-[0_0_8px_rgba(37,99,235,0.4)]" />
                )}
            </Link>
        );
    };

    return (
        <motion.aside
            animate={{ width: isCollapsed ? 64 : 280 }}
            transition={{ type: 'spring', damping: 25, stiffness: 150 }}
            onMouseLeave={handleSidebarMouseLeave}
            className="h-screen bg-white border-r border-gray-200 flex flex-col relative z-50 flex-shrink-0 no-print print:hidden"
            style={{ height: '100vh', minHeight: '100vh', maxHeight: '100vh' }}
        >
            {/* Top Bar Area inside Sidebar */}
            <div className={`flex items-center mb-4 ${isCollapsed ? 'p-4' : 'justify-between p-4'}`}>
                {!isCollapsed && (
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-black text-gray-900 leading-tight tracking-tighter uppercase">USAV</h1>
                    </div>
                )}
                <button
                    onClick={toggleCollapsed}
                    onMouseEnter={handleHamburgerMouseEnter}
                    className={`transition-all duration-300 border ${
                        isCollapsed 
                            ? 'bg-white border-gray-200 text-gray-900 hover:bg-gray-50 p-2.5 rounded-xl'
                            : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100 hover:text-gray-900 p-2.5 rounded-xl'
                    }`}
                    aria-label="Toggle menu"
                >
                    {isCollapsed ? <Menu className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
                </button>
            </div>

            <div className={`flex-1 flex flex-col overflow-y-auto scrollbar-hide pb-6 ${isCollapsed ? 'pl-3 pr-0' : 'px-3'}`} style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                {/* Quick Search Area */}
                {!isCollapsed && (
                    <div className="mb-6 space-y-3 px-1">
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
                            href="/shipped?new=true"
                            className="flex items-center justify-start gap-2 px-6 py-2.5 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white rounded-xl transition-all active:scale-95 shadow-lg shadow-green-500/20"
                        >
                            <Plus className="w-4 h-4" />
                            <span className="text-sm font-black uppercase tracking-wider">Shipped</span>
                        </Link>

                        <Link
                            href="/repair?new=true"
                            className="flex items-center justify-start gap-2 px-6 py-2.5 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white rounded-xl transition-all active:scale-95 shadow-lg shadow-orange-500/20"
                        >
                            <Plus className="w-4 h-4" />
                            <span className="text-sm font-black uppercase tracking-wider">Repair</span>
                        </Link>
                    </div>
                )}

                {isCollapsed && (
                    <div className="mb-6 space-y-3">
                        <Link
                            href="/shipped?new=true"
                            title="New Shipped"
                            className="flex items-center p-2.5 bg-gradient-to-br from-green-500 to-emerald-500 text-white rounded-l-2xl shadow-lg shadow-green-500/20 active:scale-95 transition-all"
                        >
                            <Plus className="w-5 h-5" />
                        </Link>
                        <Link
                            href="/repair?new=true"
                            title="New Repair"
                            className="flex items-center p-2.5 bg-gradient-to-br from-orange-500 to-red-500 text-white rounded-l-2xl shadow-lg shadow-orange-500/20 active:scale-95 transition-all"
                        >
                            <Plus className="w-5 h-5" />
                        </Link>
                    </div>
                )}

                {/* Main Navigation */}
                <nav className="space-y-1 flex-1">
                    {!isCollapsed && (
                        <div className="mb-2 px-2">
                            <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600">Navigation</h2>
                        </div>
                    )}
                    
                    {mainNavItems.map(item => renderNavItem(item))}

                    {/* Packers Section */}
                    <div className="pt-4">
                        {!isCollapsed ? (
                            <h3 className="px-2 mb-2 text-[9px] font-black uppercase tracking-[0.2em] text-gray-400">
                                Packers
                            </h3>
                        ) : (
                            <div className="border-t border-gray-100 my-4" />
                        )}
                        <div className="space-y-1">
                            {packerItems.map(item => renderNavItem(item))}
                        </div>
                    </div>

                    {/* Techs Section */}
                    <div className="pt-4">
                        {!isCollapsed ? (
                            <h3 className="px-2 mb-2 text-[9px] font-black uppercase tracking-[0.2em] text-gray-400">
                                Techs
                            </h3>
                        ) : (
                            <div className="border-t border-gray-100 my-4" />
                        )}
                        <div className="space-y-1">
                            {techItems.map(item => renderNavItem(item))}
                        </div>
                    </div>

                    {/* Bottom Navigation */}
                    <div className="pt-4">
                        {!isCollapsed && (
                            <div className="border-t border-gray-100 my-4" />
                        )}
                        {bottomNavItems.map(item => renderNavItem(item))}
                    </div>
                </nav>
            </div>

        </motion.aside>
    );
}
