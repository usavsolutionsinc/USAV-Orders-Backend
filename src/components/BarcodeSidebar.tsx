'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from './Icons';
import { motion, AnimatePresence } from 'framer-motion';
import MultiSkuSnBarcode from './MultiSkuSnBarcode';

export default function BarcodeSidebar() {
    return (
        <div className="relative flex-shrink-0 z-40 h-full">
            <aside
                className="bg-white text-gray-900 flex-shrink-0 h-full overflow-hidden border-r border-gray-200 relative group w-[400px]"
            >
                <div className="h-full flex flex-col overflow-hidden">
                    <header className="p-6 border-b border-gray-100 bg-gray-50">
                        <h2 className="text-xl font-black tracking-tighter uppercase leading-none text-gray-900">
                            SKU Generator
                        </h2>
                        <p className="text-[9px] font-bold text-blue-600 uppercase tracking-widest mt-1">
                            Label Production
                        </p>
                    </header>
                    <div className="flex-1 overflow-y-auto scrollbar-hide">
                        <MultiSkuSnBarcode />
                    </div>
                    <footer className="p-4 border-t border-gray-100 opacity-30 mt-auto text-center">
                        <p className="text-[7px] font-mono uppercase tracking-[0.2em] text-gray-500">USAV GEN</p>
                    </footer>
                </div>
            </aside>
        </div>
    );
}
