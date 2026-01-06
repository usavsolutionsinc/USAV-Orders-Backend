'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';

const navItems = [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Orders', href: '/orders' },
    { name: 'Repair', href: '/repair' },
    { name: 'Michael', href: '/tech/1' },
    { name: 'Thuc', href: '/tech/2' },
    { name: 'Sang', href: '/tech/3' },
    { name: 'Tuan', href: '/packer/1' },
    { name: 'Thuy', href: '/packer/2' },
    { name: 'Shipped', href: '/shipped' },
    { name: 'Receiving', href: '/receiving' },
    { name: 'Sku-Stock', href: '/sku-stock' },
    { name: 'Sku', href: '/sku' },
    { name: 'Quarters', href: '/previous-quarters' },
    { name: 'Admin', href: '/admin' },
];

export default function Navigation() {
    const pathname = usePathname();

    return (
        <nav className="bg-gray-950 text-white sticky top-0 z-[100] border-b border-white/5">
            <div className="px-4">
                <div className="flex items-center h-14 justify-between">
                    <div className="flex items-center space-x-6">
                        <Link 
                            href="/" 
                            className="flex items-center group"
                        >
                            <span className="text-xl font-black tracking-tighter hover:text-blue-400 transition-all uppercase">
                                USAV
                            </span>
                        </Link>
                        
                        <div className="hidden lg:flex items-center space-x-1">
                            {navItems.map((item) => {
                                const isActive = pathname === item.href;
                                // We'll render Admin separately if we want it on the far right, 
                                // but for now let's just use the items and filter/map them.
                                if (item.name === 'Admin') return null;
                                
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className={`px-3 py-1.5 rounded-lg text-[10px] font-black tracking-wider uppercase transition-all duration-300 whitespace-nowrap ${
                                            isActive
                                                ? 'bg-blue-600 text-white shadow-lg'
                                                : 'text-gray-500 hover:text-white hover:bg-white/5'
                                        }`}
                                    >
                                        {item.name}
                                    </Link>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex items-center">
                        <Link
                            href="/admin"
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-black tracking-wider uppercase transition-all duration-300 ${
                                pathname === '/admin'
                                    ? 'bg-blue-600 text-white shadow-lg'
                                    : 'text-gray-500 hover:text-white hover:bg-white/5'
                            }`}
                        >
                            Admin
                        </Link>
                    </div>
                </div>
            </div>
        </nav>
    );
}
