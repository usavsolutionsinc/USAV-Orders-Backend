'use client';

import { useState } from 'react';
import { Search, ChevronLeft, ChevronRight } from './Icons';
import { motion, AnimatePresence } from 'framer-motion';

export default function ShippedSidebar() {
    const [isOpen, setIsOpen] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');

    return (
        <div className="relative flex-shrink-0 z-40 h-full">
            <AnimatePresence mode="wait">
                {isOpen && (
                    <motion.aside
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 340, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        transition={{ type: "spring", damping: 25, stiffness: 120 }}
                        className="bg-gray-950 text-white flex-shrink-0 h-full overflow-hidden border-l border-white/5 relative group order-2"
                    >
                        <button
                            onClick={() => setIsOpen(false)}
                            className="absolute top-4 right-4 z-50 p-2 bg-white/5 hover:bg-white/10 text-white rounded-xl transition-all opacity-0 group-hover:opacity-100"
                            title="Collapse Menu"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>

                        <div className="p-6 h-full flex flex-col space-y-6 overflow-y-auto scrollbar-hide">
                            <header className="pr-12">
                                <h2 className="text-xl font-black tracking-tighter uppercase leading-none">
                                    Shipped
                                </h2>
                                <p className="text-[9px] font-bold text-blue-500 uppercase tracking-widest mt-1">
                                    Global Search
                                </p>
                            </header>
                            
                            <div className="space-y-6">
                                <div className="relative group">
                                    <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                                        <Search className="w-3.5 h-3.5 text-gray-500 group-focus-within:text-blue-400 transition-colors" />
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="SEARCH..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-10 pr-4 text-[10px] font-black tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all placeholder:text-gray-600"
                                    />
                                </div>

                                <div className="bg-white/5 p-5 rounded-2xl border border-white/10">
                                    <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-3">History</p>
                                    <div className="text-[9px] font-black text-blue-400/50 uppercase tracking-widest italic">
                                        No recent searches
                                    </div>
                                </div>

                                <div className="p-5 rounded-2xl bg-blue-600/10 border border-blue-500/20">
                                    <h3 className="text-[9px] font-black uppercase tracking-widest text-blue-400 mb-2">Tip</h3>
                                    <p className="text-[10px] leading-relaxed text-gray-400 font-medium italic">
                                        Use "Ctrl + F" inside the sheet for native search.
                                    </p>
                                </div>
                            </div>

                            <footer className="mt-auto pt-4 border-t border-white/5 opacity-30 text-center">
                                <p className="text-[7px] font-mono uppercase tracking-[0.2em]">USAV SEARCH</p>
                            </footer>
                        </div>
                    </motion.aside>
                )}
            </AnimatePresence>

            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="fixed top-20 right-0 z-[60] p-3 bg-white text-gray-950 rounded-l-2xl shadow-xl hover:bg-blue-600 hover:text-white transition-all duration-300 group"
                >
                    <ChevronLeft className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
                </button>
            )}
        </div>
    );
}
