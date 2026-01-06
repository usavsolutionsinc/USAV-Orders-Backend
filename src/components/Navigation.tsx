'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';

const navItems = [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Admin', href: '/admin' },
    { name: 'Orders', href: '/orders' },
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
];

export default function Navigation() {
    const pathname = usePathname();

    return (
        <nav className="bg-gray-950/95 backdrop-blur-xl text-white sticky top-0 z-[100] border-b border-white/5 shadow-2xl">
            <div className="px-6 mx-auto max-w-[1800px]">
                <div className="flex items-center h-20 justify-between">
                    <div className="flex items-center space-x-12">
                        <Link 
                            href="/" 
                            className="flex items-center group"
                        >
                            <div className="flex flex-col">
                                <span className="text-2xl font-black tracking-tighter leading-none group-hover:text-blue-400 transition-all uppercase">
                                    USAV <span className="text-blue-500">OS</span>
                                </span>
                                <span className="text-[8px] font-black tracking-[0.4em] text-gray-500 uppercase mt-1 group-hover:text-blue-500/50 transition-all">
                                    Operations Core
                                </span>
                            </div>
                        </Link>
                        
                        <div className="hidden xl:flex items-center space-x-1 bg-white/5 p-1 rounded-2xl border border-white/5">
                            {navItems.map((item) => {
                                const isActive = pathname === item.href;
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className={`px-5 py-2.5 rounded-xl text-[10px] font-black tracking-[0.1em] uppercase transition-all duration-500 whitespace-nowrap relative group/nav ${
                                            isActive
                                                ? 'bg-blue-600 text-white shadow-[0_0_30px_rgba(37,99,235,0.4)]'
                                                : 'text-gray-500 hover:text-white hover:bg-white/5'
                                        }`}
                                    >
                                        <span className="relative z-10">{item.name}</span>
                                        {isActive && (
                                            <motion.div 
                                                layoutId="navGlow"
                                                className="absolute inset-0 bg-blue-400/20 blur-xl rounded-xl"
                                            />
                                        )}
                                    </Link>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex items-center gap-6">
                        <div className="hidden lg:flex flex-col items-end">
                            <div className="flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                    System Online
                                </span>
                            </div>
                            <div className="text-[8px] font-mono text-gray-600 uppercase tracking-widest mt-0.5">
                                v2.0 // NODE_PRIMARY_IAD
                            </div>
                        </div>
                        
                        <div className="h-10 w-px bg-white/10" />
                        
                        <div className="flex items-center gap-3">
                            <div className="flex flex-col items-end">
                                <span className="text-[10px] font-black text-white uppercase tracking-wider">
                                    Admin Terminal
                                </span>
                                <span className="text-[8px] font-mono text-blue-500 uppercase tracking-[0.2em]">
                                    ROOT_ACCESS
                                </span>
                            </div>
                            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 p-0.5 shadow-lg shadow-blue-900/20 group cursor-pointer overflow-hidden border border-white/10">
                                <div className="w-full h-full rounded-[14px] bg-gray-950 flex items-center justify-center font-black text-xs text-blue-400 group-hover:bg-transparent group-hover:text-white transition-all">
                                    US
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </nav>
    );
}
