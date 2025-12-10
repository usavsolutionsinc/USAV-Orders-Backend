'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Navigation() {
    const pathname = usePathname();

    const links = [
        { href: '/', label: 'Orders' },
        { href: '/shipped', label: 'Shipped' },
        { href: '/receiving', label: 'Receiving' },
        { href: '/sku-stock', label: 'Sku-Stock' },
        { href: '/sku', label: 'Sku' },
        { href: '/logs', label: 'Logs' },
    ];

    const technicians = Array.from({ length: 10 }, (_, i) => i + 1);
    const packers = Array.from({ length: 10 }, (_, i) => i + 1);

    return (
        <nav className="bg-[#0a192f] text-white shadow-md z-50 relative">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-12">
                    <div className="flex items-center">
                        <div className="flex-shrink-0 font-bold text-lg mr-10">
                            USAV Enterprise
                        </div>
                        <div className="hidden md:block">
                            <div className="flex items-baseline space-x-4">
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

                                {/* Technicians Dropdown */}
                                <div className="relative group">
                                    <button className="px-3 py-2 rounded-md text-sm font-medium text-gray-300 hover:bg-[#112240] hover:text-white flex items-center">
                                        Technicians
                                        <svg className="ml-1 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                    </button>
                                    <div className="absolute left-0 mt-0 w-40 bg-white rounded-md shadow-lg py-1 hidden group-hover:block border border-gray-200">
                                        {technicians.map(id => (
                                            <Link
                                                key={id}
                                                href={`/technician/${id}`}
                                                className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                            >
                                                Technician {id}
                                            </Link>
                                        ))}
                                    </div>
                                </div>

                                {/* Packers Dropdown */}
                                <div className="relative group">
                                    <button className="px-3 py-2 rounded-md text-sm font-medium text-gray-300 hover:bg-[#112240] hover:text-white flex items-center">
                                        Packers
                                        <svg className="ml-1 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                    </button>
                                    <div className="absolute left-0 mt-0 w-40 bg-white rounded-md shadow-lg py-1 hidden group-hover:block border border-gray-200">
                                        {packers.map(id => (
                                            <Link
                                                key={id}
                                                href={`/packer/${id}`}
                                                className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                            >
                                                Packer {id}
                                            </Link>
                                        ))}
                                    </div>
                                </div>

                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </nav>
    );
}
