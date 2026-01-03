'use client';

import { useState } from 'react';
import { Search, ChevronLeft, ChevronRight } from './Icons';
import { motion, AnimatePresence } from 'framer-motion';

export default function ShippedSidebar() {
    const [isOpen, setIsOpen] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');

    return (
        <>
            <AnimatePresence>
                {isOpen && (
                    <motion.aside
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 340, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        transition={{ type: "spring", damping: 25, stiffness: 120 }}
                        className="bg-gray-950 text-white flex-shrink-0 z-40 overflow-hidden border-r border-white/5"
                    >
                        <div className="p-8 h-full flex flex-col space-y-8 overflow-y-auto scrollbar-hide">
                            <header>
                                <h2 className="text-2xl font-black tracking-tighter uppercase leading-none">
                                    Shipped
                                </h2>
                                <p className="text-[10px] font-bold text-blue-500 uppercase tracking-[0.3em] mt-1">
                                    Global Search
                                </p>
                            </header>
                            
                            <div className="space-y-6">
                                <div className="relative group">
                                    <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                                        <Search className="w-4 h-4 text-gray-500 group-focus-within:text-blue-400 transition-colors" />
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="SEARCH SHEET..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-xs font-black tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all placeholder:text-gray-600"
                                    />
                                    <div className="mt-2 flex items-center gap-2 px-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                                        <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">
                                            Press Enter to locate
                                        </span>
                                    </div>
                                </div>

                                <div className="bg-white/5 p-6 rounded-3xl border border-white/10">
                                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4">Search History</p>
                                    <div className="space-y-3">
                                        <div className="text-[10px] font-black text-blue-400/50 uppercase tracking-widest py-2 border-b border-white/5 italic">
                                            No recent searches
                                        </div>
                                    </div>
                                </div>

                                <div className="p-6 rounded-3xl bg-blue-600/10 border border-blue-500/20">
                                    <h3 className="text-[10px] font-black uppercase tracking-widest text-blue-400 mb-2">Pro Tip</h3>
                                    <p className="text-[11px] leading-relaxed text-gray-400 font-medium italic">
                                        Use "Ctrl + F" inside the sheet for native highlighting if the sidebar search is not enough.
                                    </p>
                                </div>
                            </div>

                            <footer className="mt-auto pt-6 border-t border-white/5 opacity-30">
                                <p className="text-[8px] font-mono uppercase tracking-[0.4em]">USAV OS SEARCH // v2.0</p>
                            </footer>
                        </div>
                    </motion.aside>
                )}
            </AnimatePresence>

            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`fixed left-0 bottom-8 z-[60] p-3 bg-white text-gray-950 rounded-r-2xl shadow-[10px_0_30px_rgba(0,0,0,0.5)] hover:bg-blue-600 hover:text-white transition-all duration-300 group`}
            >
                {isOpen ? (
                    <ChevronLeft className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
                ) : (
                    <ChevronRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
                )}
            </button>
        </>
    );
}

