'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

const navItems = [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Shipped', href: '/dashboard?shipped=' },
    { name: 'FBA', href: '/dashboard?fba=' },
    { name: 'Repair', href: '/repair' },
    { name: 'Tech', href: '/tech?staffId=1' },
    { name: 'Packer', href: '/packer?staffId=4' },
    { name: 'Receiving', href: '/receiving' },
    { name: 'Sku-Stock', href: '/sku-stock' },
    { name: 'Sku', href: '/sku' },
    { name: 'Quarters', href: '/previous-quarters' },
    { name: 'Admin', href: '/admin' },
];

export default function Navigation() {
    const pathname = usePathname();
    const searchParams = useSearchParams();

    return (
        <nav className={`bg-white text-gray-900 sticky top-0 z-[100] border-b border-gray-200`}>
            <div className="px-4">
                <div className="flex items-center h-14 justify-between">
                    <div className="flex items-center space-x-6">
                        <Link 
                            href="/" 
                            className="flex items-center group"
                        >
                            <span className="text-xl font-black tracking-tighter hover:text-blue-600 transition-all uppercase text-gray-900">
                                USAV
                            </span>
                        </Link>
                        
                        <div className="hidden lg:flex items-center space-x-1">
                            {navItems.map((item) => {
                                const isActive =
                                    item.name === 'Shipped'
                                        ? pathname === '/dashboard' && searchParams.has('shipped')
                                        : item.name === 'FBA'
                                        ? pathname === '/dashboard' && searchParams.has('fba')
                                        : item.name === 'Dashboard'
                                        ? pathname === '/dashboard' && !searchParams.has('shipped') && !searchParams.has('fba')
                                        : item.name === 'Tech'
                                        ? Boolean(pathname?.startsWith('/tech'))
                                        : item.name === 'Packer'
                                        ? Boolean(pathname?.startsWith('/packer'))
                                        : pathname === item.href;
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
                                                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
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
                                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
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
