'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from './Icons';
import { motion, AnimatePresence } from 'framer-motion';
import MultiSkuSnBarcode from './MultiSkuSnBarcode';

export default function BarcodeSidebar() {
    const [isOpen, setIsOpen] = useState(true);

    return (
        <>
            <AnimatePresence>
                {isOpen && (
                    <motion.aside
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 400, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="bg-gray-50 border-r border-gray-200 overflow-hidden flex-shrink-0"
                    >
                        <div className="h-full overflow-y-auto">
                            <div className="p-4 border-b border-gray-300 bg-gray-900 text-white">
                                <h2 className="text-lg font-bold">SKU Label Generator</h2>
                                <p className="text-xs text-gray-300 mt-1">Scan, generate, and print SKU labels</p>
                            </div>
                            <div className="h-[calc(100%-72px)]">
                                <MultiSkuSnBarcode />
                            </div>
                        </div>
                    </motion.aside>
                )}
            </AnimatePresence>

            <button
                onClick={() => setIsOpen(!isOpen)}
                className="fixed left-0 bottom-4 bg-blue-600 text-white p-2 rounded-r-md shadow-lg hover:bg-blue-700 transition-colors z-50"
                title={isOpen ? 'Hide Barcode Scanner' : 'Show Barcode Scanner'}
            >
                {isOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
        </>
    );
}

