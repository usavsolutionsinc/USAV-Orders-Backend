'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  LayoutDashboard, 
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
    { name: 'Dashboard/Orders', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Receiving', href: '/receiving', icon: ClipboardList },
    { name: 'Repair', href: '/repair', icon: Tool },
    { name: 'Sku Stock', href: '/sku-stock', icon: Box },
];

const stationItems = [
    { name: 'Technicians', href: '/tech/1', icon: Wrench, type: 'Station' },
    { name: 'Packers', href: '/packer/4', icon: User, type: 'Station' },
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
    const [lastTechStationHref, setLastTechStationHref] = useState('/tech/1');

    // Persist collapsed state
    useEffect(() => {
        const saved = localStorage.getItem('sidebar-collapsed');
        if (saved !== null) {
            setIsCollapsed(saved === 'true');
        } else {
            setIsCollapsed(true); // Default to collapsed if not set
        }
    }, []);

    useEffect(() => {
        const savedTechHref = localStorage.getItem('last-tech-station-href');
        if (savedTechHref && /^\/tech\/\d+$/.test(savedTechHref)) {
            setLastTechStationHref(savedTechHref);
        }
    }, []);

    useEffect(() => {
        if (!pathname) return;
        if (!/^\/tech\/\d+$/.test(pathname)) return;
        localStorage.setItem('last-tech-station-href', pathname);
        setLastTechStationHref(pathname);
    }, [pathname]);

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
            router.push(`/dashboard?shipped&search=${encodeURIComponent(searchQuery.trim())}`);
            setSearchQuery('');
        }
    };

    const handleNewOrdersClick = (e: React.MouseEvent) => {
        if (pathname === '/dashboard') {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent('dashboard-open-intake'));
        }
    };

    const getFirstPathSegment = (path: string) => {
        const [segment = ''] = path.split('/').filter(Boolean);
        return segment === 'packers' ? 'packer' : segment;
    };

    const isPathActive = (href: string) => {
        if (!pathname) return false;

        const hrefSegment = getFirstPathSegment(href);
        const pathnameSegment = getFirstPathSegment(pathname);

        // Station links should stay active for any user id within that station section.
        if (hrefSegment === 'tech' || hrefSegment === 'packer') {
            return pathnameSegment === hrefSegment;
        }

        return pathname === href || pathname.startsWith(`${href}/`);
    };

    const renderNavItem = (item: any, isQuickAccess = false) => {
        const href = item.name === 'Technicians' ? lastTechStationHref : item.href;
        const isActive = isPathActive(href);
        const Icon = item.icon;
        
        return (
            <Link
                key={item.href}
                href={href}
                title={isCollapsed ? item.name : undefined}
                className={`group flex items-center transition-all duration-300 relative ${
                    isCollapsed ? 'justify-center py-2.5 rounded-l-xl' : 'gap-5 px-6 py-3 rounded-2xl'
                } ${
                    isActive
                        ? isCollapsed 
                            ? 'text-blue-600 bg-blue-50/50'
                            : 'bg-blue-600 text-white shadow-xl shadow-blue-600/25 scale-[1.02]'
                        : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                }`}
            >
                <div className={`transition-transform duration-300 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`}>
                    <Icon className={`w-5 h-5 ${isActive ? (isCollapsed ? 'text-blue-600' : 'text-white') : 'text-gray-400 group-hover:text-blue-500'}`} />
                </div>
                {!isCollapsed && (
                    <div className="flex flex-col items-start text-left">
                        <span className="text-sm font-black tracking-tight uppercase whitespace-nowrap">{item.name}</span>
                        {item.type && <span className="text-[8px] font-bold text-gray-400 uppercase tracking-widest leading-none mt-0.5">{item.type}</span>}
                    </div>
                )}
                {isActive && !isCollapsed && (
                    <motion.div 
                        layoutId="activeIndicator"
                        className="ml-auto w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" 
                    />
                )}
                {isActive && isCollapsed && (
                    <div className="absolute right-0 top-0 bottom-0 w-1 bg-blue-600 rounded-l-full shadow-[0_0_8px_rgba(37,99,235,0.4)]" />
                )}
            </Link>
        );
    };

    return (
        <motion.aside
            animate={{ width: isCollapsed ? 56 : 300 }}
            transition={{ type: 'spring', damping: 25, stiffness: 150 }}
            onMouseLeave={handleSidebarMouseLeave}
            className="h-screen bg-white border-r border-gray-200 flex flex-col relative z-50 flex-shrink-0 no-print print:hidden"
            style={{ height: '100vh', minHeight: '100vh', maxHeight: '100vh' }}
        >
            {/* Top Bar Area inside Sidebar */}
            <div className={`flex items-center transition-all duration-300 ${isCollapsed ? 'p-2 flex justify-center mt-2' : 'justify-between p-6 pb-2 mt-2'}`}>
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

            <div className={`flex-1 flex flex-col overflow-y-auto scrollbar-hide pb-6 ${isCollapsed ? 'px-0' : 'px-4 pt-10'}`} style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
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
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-10 pr-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all placeholder:text-gray-400"
                            />
                        </form>

                        <div className="grid grid-cols-2 gap-2">
                            <Link
                                href="/dashboard?new=true"
                                onClick={handleNewOrdersClick}
                                className="flex items-center justify-center gap-2 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl transition-all active:scale-95 shadow-lg shadow-emerald-500/20"
                            >
                                <Plus className="w-4 h-4" />
                                <span className="text-[10px] font-black uppercase tracking-wider">Orders</span>
                            </Link>

                            <Link
                                href="/repair?new=true"
                                className="flex items-center justify-center gap-2 py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl transition-all active:scale-95 shadow-lg shadow-orange-500/20"
                            >
                                <Plus className="w-4 h-4" />
                                <span className="text-[10px] font-black uppercase tracking-wider">Repair</span>
                            </Link>
                        </div>
                    </div>
                )}

                {isCollapsed && (
                    <div className="mb-6 space-y-2 flex flex-col items-center">
                        <Link
                            href="/dashboard?new=true"
                            onClick={handleNewOrdersClick}
                            title="New Shipped"
                            className="p-2 bg-emerald-500 text-white rounded-xl shadow-lg shadow-emerald-500/20 active:scale-95 transition-all"
                        >
                            <Plus className="w-4 h-4" />
                        </Link>
                        <Link
                            href="/repair?new=true"
                            title="New Repair"
                            className="p-2 bg-orange-500 text-white rounded-xl shadow-lg shadow-orange-500/20 active:scale-95 transition-all"
                        >
                            <Plus className="w-4 h-4" />
                        </Link>
                    </div>
                )}

                {/* Main Navigation */}
                <nav className="space-y-1 flex-1">
                    {!isCollapsed && (
                        <div className="mb-2 px-2">
                            <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600">Main</h2>
                        </div>
                    )}
                    
                    {mainNavItems.map(item => renderNavItem(item))}

                    {/* Staff Section */}
                    <div className={isCollapsed ? "pt-2" : "pt-6"}>
                        {!isCollapsed ? (
                            <div className="flex items-center justify-between px-2 mb-2">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
                                    Stations
                                </h3>
                            </div>
                        ) : (
                            <div className="border-t border-gray-100 my-2 mx-2" />
                        )}
                        <div className="space-y-1">
                            {stationItems.map(item => renderNavItem(item))}
                        </div>
                    </div>

                    {/* Bottom Navigation */}
                    <div className={isCollapsed ? "pt-2" : "pt-6"}>
                        {!isCollapsed ? (
                            <div className="border-t border-gray-100 my-6 mx-2" />
                        ) : (
                            <div className="border-t border-gray-100 my-2 mx-2" />
                        )}
                        {bottomNavItems.map(item => renderNavItem(item))}
                    </div>
                </nav>
            </div>
        </motion.aside>
    );
}
