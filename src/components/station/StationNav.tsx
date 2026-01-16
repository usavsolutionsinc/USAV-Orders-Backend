'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { 
  LayoutDashboard, 
  ShoppingCart, 
  PackageCheck, 
  Wrench, 
  User, 
  Settings, 
  History,
  Box,
  ClipboardList,
  Calendar,
  ShieldCheck,
  Search,
  Plus
} from '../Icons';

const navItems = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Orders', href: '/orders', icon: ShoppingCart },
    { name: 'Shipped', href: '/shipped', icon: PackageCheck },
    { name: 'Michael (Tech)', href: '/tech/1', icon: User },
    { name: 'Thuc (Tech)', href: '/tech/2', icon: User },
    { name: 'Sang (Tech)', href: '/tech/3', icon: User },
    { name: 'Tuan (Packer)', href: '/packer/1', icon: User },
    { name: 'Thuy (Packer)', href: '/packer/2', icon: User },
    { name: 'Receiving', href: '/receiving', icon: ClipboardList },
    { name: 'Sku Stock', href: '/sku-stock', icon: Box },
    { name: 'Sku Manager', href: '/sku', icon: Settings },
    { name: 'Quarters', href: '/previous-quarters', icon: Calendar },
    { name: 'Admin', href: '/admin', icon: ShieldCheck },
];

export default function StationNav() {
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

    return (
        <div className="flex flex-col h-full bg-white px-4 py-8 overflow-y-auto no-scrollbar">
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
                    href="/repair"
                    className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white rounded-xl transition-all active:scale-95 shadow-lg shadow-orange-500/20"
                >
                    <Plus className="w-4 h-4" />
                    <span className="text-sm font-black uppercase tracking-wider">Repair Service</span>
                </Link>
            </div>

            <div className="mb-6 px-2">
                <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600 mb-1">Navigation</h2>
                <p className="text-2xl font-black text-gray-900 tracking-tighter">Menu</p>
            </div>
            
            <nav className="space-y-1">
                {navItems.map((item) => {
                    const isActive = pathname === item.href;
                    const Icon = item.icon;
                    
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`flex items-center gap-4 px-4 py-4 rounded-2xl transition-all active:scale-[0.98] ${
                                isActive
                                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-100'
                                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                            }`}
                        >
                            <Icon className={`w-5 h-5 ${isActive ? 'text-white' : 'text-gray-400'}`} />
                            <span className="text-sm font-bold tracking-tight">{item.name}</span>
                            {isActive && (
                                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                            )}
                        </Link>
                    );
                })}
            </nav>

            <div className="mt-auto pt-10 pb-6 px-4">
                <div className="p-6 bg-gray-50 rounded-[2rem] border border-gray-100">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Version</p>
                    <p className="text-xs font-bold text-gray-900">v2.6 Stable Build</p>
                </div>
            </div>
        </div>
    );
}
