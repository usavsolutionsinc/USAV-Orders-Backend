'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Receiving', href: '/receiving' },
    { name: 'Orders', href: '/orders' },
    { name: 'Michael', href: '/tech/1' },
    { name: 'Thuc', href: '/tech/2' },
    { name: 'Sang', href: '/tech/3' },
    { name: 'Tuan', href: '/packer/1' },
    { name: 'Thuy', href: '/packer/2' },
    { name: 'Shipped', href: '/shipped' },
    { name: 'Sku-Stock', href: '/sku-stock' },
    { name: 'Sku', href: '/sku' },
    { name: 'Quarters', href: '/previous-quarters' },
];

export default function Navigation() {
    const pathname = usePathname();

    return (
        <nav className="bg-gray-950/90 backdrop-blur-md text-white sticky top-0 z-[100] border-b border-white/10">
            <div className="px-6">
                <div className="flex items-center h-16 justify-between">
                    <div className="flex items-center space-x-8">
                        <Link 
                            href="/" 
                            className="text-xl font-black tracking-tighter hover:text-blue-400 transition-all uppercase"
                        >
                            USAV <span className="text-blue-500">OS</span>
                        </Link>
                        <div className="hidden lg:flex items-center space-x-1 overflow-x-auto scrollbar-hide">
                            {navItems.map((item) => {
                                const isActive = pathname === item.href;
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className={`px-4 py-2 rounded-full text-xs font-bold tracking-wider uppercase transition-all duration-300 whitespace-nowrap ${
                                            isActive
                                                ? 'bg-blue-600 text-white shadow-[0_0_20px_rgba(37,99,235,0.4)]'
                                                : 'text-gray-400 hover:text-white hover:bg-white/5'
                                        }`}
                                    >
                                        {item.name}
                                    </Link>
                                );
                            })}
                        </div>
                    </div>
                    <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest hidden sm:block">
                        v2.0.26 // SYSTEM STABLE
                    </div>
                </div>
            </div>
        </nav>
    );
}
