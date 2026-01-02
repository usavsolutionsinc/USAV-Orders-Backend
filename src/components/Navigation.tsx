'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
    { name: 'Orders', href: '/orders' },
    { name: 'Tech_1', href: '/tech/1' },
    { name: 'Tech_2', href: '/tech/2' },
    { name: 'Tech_3', href: '/tech/3' },
    { name: 'Packer_1', href: '/packer/1' },
    { name: 'Packer_2', href: '/packer/2' },
    { name: 'Shipped', href: '/shipped' },
    { name: 'Sku-Stock', href: '/sku-stock' },
    { name: 'Sku', href: '/sku' },
];

export default function Navigation() {
    const pathname = usePathname();

    return (
        <nav className="bg-gray-900 text-white shadow-lg">
            <div className="px-4">
                <div className="flex items-center h-14 space-x-1">
                    <Link 
                        href="/" 
                        className="text-xl font-bold mr-6 hover:text-gray-300 transition-colors"
                    >
                        USAV Orders
                    </Link>
                    {navItems.map((item) => {
                        const isActive = pathname === item.href;
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                                    isActive
                                        ? 'bg-gray-700 text-white'
                                        : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                                }`}
                            >
                                {item.name}
                            </Link>
                        );
                    })}
                </div>
            </div>
        </nav>
    );
}

