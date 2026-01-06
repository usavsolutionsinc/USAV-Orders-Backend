'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from './Icons';
import { motion, AnimatePresence } from 'framer-motion';
import MultiSkuSnBarcode from './MultiSkuSnBarcode';

export default function BarcodeSidebar() {
    const [isOpen, setIsOpen] = useState(true);

    return (
        <div className="flex h-full relative">
            <AnimatePresence>
                {isOpen && (
                    <motion.aside
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 400, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        transition={{ type: "spring", damping: 25, stiffness: 120 }}
                        className="bg-gray-950 text-white flex-shrink-0 z-40 overflow-hidden border-l border-white/5 order-2"
                    >
                        <div className="h-full flex flex-col overflow-hidden">
                            <header className="p-8 border-b border-white/5 bg-white/5 pr-16">
                                <h2 className="text-2xl font-black tracking-tighter uppercase leading-none">
                                    SKU Generator
                                </h2>
                                <p className="text-[10px] font-bold text-blue-500 uppercase tracking-[0.3em] mt-1">
                                    Label Production Core
                                </p>
                            </header>
                            <div className="flex-1 overflow-y-auto scrollbar-hide">
                                <MultiSkuSnBarcode />
                            </div>
                            <footer className="p-6 border-t border-white/5 opacity-30 mt-auto">
                                <p className="text-[8px] font-mono uppercase tracking-[0.4em]">USAV OS GEN // CORE v2.0</p>
                            </footer>
                        </div>
                    </motion.aside>
                )}
            </AnimatePresence>

            <button
                onClick={() => setIsOpen(!isOpen)}
                className="fixed top-20 right-4 z-[70] p-3 bg-white text-gray-950 rounded-2xl shadow-[0_10px_30px_rgba(0,0,0,0.5)] hover:bg-blue-600 hover:text-white transition-all duration-300 group"
            >
                {isOpen ? (
                    <ChevronRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
                ) : (
                    <ChevronLeft className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
                )}
            </button>
        </div>
    );
}

