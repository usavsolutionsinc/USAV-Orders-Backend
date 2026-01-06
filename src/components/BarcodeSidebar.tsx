'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from './Icons';
import { motion, AnimatePresence } from 'framer-motion';
import MultiSkuSnBarcode from './MultiSkuSnBarcode';

export default function BarcodeSidebar() {
    const [isOpen, setIsOpen] = useState(true);

    return (
        <div className="relative flex-shrink-0 z-40 h-full">
            <AnimatePresence mode="wait">
                {isOpen && (
                    <motion.aside
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 400, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        transition={{ type: "spring", damping: 25, stiffness: 120 }}
                        className="bg-gray-950 text-white flex-shrink-0 h-full overflow-hidden border-l border-white/5 relative group order-2"
                    >
                        <button
                            onClick={() => setIsOpen(false)}
                            className="absolute top-4 left-4 z-50 p-2 bg-white/5 hover:bg-white/10 text-white rounded-xl transition-all opacity-0 group-hover:opacity-100"
                            title="Collapse Menu"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>

                        <div className="h-full flex flex-col overflow-hidden">
                            <header className="p-6 border-b border-white/5 bg-white/5 pr-12">
                                <h2 className="text-xl font-black tracking-tighter uppercase leading-none">
                                    SKU Generator
                                </h2>
                                <p className="text-[9px] font-bold text-blue-500 uppercase tracking-widest mt-1">
                                    Label Production
                                </p>
                            </header>
                            <div className="flex-1 overflow-y-auto scrollbar-hide">
                                <MultiSkuSnBarcode />
                            </div>
                            <footer className="p-4 border-t border-white/5 opacity-30 mt-auto text-center">
                                <p className="text-[7px] font-mono uppercase tracking-[0.2em]">USAV GEN</p>
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
