'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Navigation() {
    const pathname = usePathname();

    const links = [
        { href: '/', label: 'Orders' },
        { href: '/shipped', label: 'Shipped' },
        { href: '/receiving', label: 'Receiving' },
    ];

    return (
        <nav className="bg-[#0a192f] text-white shadow-md">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-12">
                    <div className="flex items-center">
                        <div className="flex-shrink-0 font-bold text-lg">
                            USAV Enterprise
                        </div>
                        <div className="hidden md:block">
                            <div className="ml-10 flex items-baseline space-x-4">
                                {links.map((link) => {
                                    const isActive = pathname === link.href;
                                    return (
                                        <Link
                                            key={link.href}
                                            href={link.href}
                                            className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive
                                                    ? 'bg-white text-[#0a192f]'
                                                    : 'text-gray-300 hover:bg-[#112240] hover:text-white'
                                                }`}
                                        >
                                            {link.label}
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </nav>
    );
}
