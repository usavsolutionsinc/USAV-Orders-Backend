'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from './Icons';
import { motion, AnimatePresence } from 'framer-motion';

const quarters = [
    { label: "Q4 25'", sheetId: '1xzGV0cm7WEwX_vx8N-icA8SZQllNq9APhhILzCahww0' },
    { label: "Q3 25'", sheetId: '1RGOnktpMew-Hsu5EoUVp2GSZwDxG-MKZYnEUph0W9GU' },
    { label: "Q2 25'", sheetId: '1a8Xddl0PDcvlhjcraRCcFrkyPfvDi_pXd6BKRLTuMFs' },
];

export default function QuarterSelector() {
    const [isOpen, setIsOpen] = useState(true);
    const [selectedQuarter, setSelectedQuarter] = useState(quarters[0]);

    const iframeUrl = `https://docs.google.com/spreadsheets/d/${selectedQuarter.sheetId}/edit#rm=minimal&single=true&widget=false`;

    return (
        <div className="flex h-full w-full">
            <AnimatePresence>
                {isOpen && (
                    <motion.aside
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 280, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="bg-gray-50 border-r border-gray-200 overflow-hidden flex-shrink-0"
                    >
                        <div className="p-4 h-full overflow-y-auto">
                            <h2 className="text-lg font-bold text-gray-900 mb-4">Previous Quarters</h2>
                            
                            <div className="space-y-2">
                                {quarters.map((quarter) => (
                                    <button
                                        key={quarter.sheetId}
                                        onClick={() => setSelectedQuarter(quarter)}
                                        className={`w-full text-left px-4 py-3 rounded-lg font-medium transition-all ${
                                            selectedQuarter.sheetId === quarter.sheetId
                                                ? 'bg-blue-600 text-white shadow-md'
                                                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
                                        }`}
                                    >
                                        {quarter.label}
                                    </button>
                                ))}
                            </div>

                            <div className="mt-6 p-3 bg-blue-50 rounded-lg border border-blue-200">
                                <p className="text-xs text-blue-800 font-medium">
                                    Currently viewing: <span className="font-bold">{selectedQuarter.label}</span>
                                </p>
                            </div>
                        </div>
                    </motion.aside>
                )}
            </AnimatePresence>

            <button
                onClick={() => setIsOpen(!isOpen)}
                className="fixed left-0 bottom-4 bg-gray-900 text-white p-2 rounded-r-md shadow-lg hover:bg-gray-700 transition-colors z-50"
                title={isOpen ? 'Hide Quarter Selector' : 'Show Quarter Selector'}
            >
                {isOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>

            <div className="flex-1 overflow-hidden w-full">
                <iframe
                    key={selectedQuarter.sheetId}
                    src={iframeUrl}
                    width="100%"
                    height="100%"
                    frameBorder="0"
                    style={{
                        border: 'none',
                        display: 'block',
                        background: 'white',
                        width: '100%'
                    }}
                    allow="clipboard-read; clipboard-write"
                />
            </div>
        </div>
    );
}

