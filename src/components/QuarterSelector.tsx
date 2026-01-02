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

    // Construct modern iframe URL
    const iframeUrl = `https://docs.google.com/spreadsheets/d/${selectedQuarter.sheetId}/edit?rm=minimal&single=true&widget=false`;

    return (
        <div className="flex h-full w-full bg-gray-50 overflow-hidden">
            <AnimatePresence mode="wait">
                {isOpen && (
                    <motion.aside
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 320, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        transition={{ type: "spring", damping: 20, stiffness: 100 }}
                        className="bg-white border-r border-gray-200 flex-shrink-0 z-40 shadow-2xl overflow-hidden"
                    >
                        <div className="p-8 h-full flex flex-col">
                            <div className="mb-8">
                                <h2 className="text-2xl font-black tracking-tighter text-gray-900 uppercase">
                                    Quarters
                                </h2>
                                <p className="text-[10px] font-bold text-blue-600 uppercase tracking-[0.2em] mt-1">
                                    Archive Access
                                </p>
                            </div>

                            <div className="mb-8 p-4 bg-gray-900 rounded-2xl text-white shadow-[0_10px_30px_rgba(0,0,0,0.2)]">
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Currently Viewing</p>
                                <p className="text-xl font-black text-blue-400">{selectedQuarter.label}</p>
                            </div>
                            
                            <div className="space-y-3 flex-1">
                                {quarters.map((quarter) => (
                                    <button
                                        key={quarter.sheetId}
                                        onClick={() => setSelectedQuarter(quarter)}
                                        className={`w-full group relative overflow-hidden px-6 py-4 rounded-2xl text-left transition-all duration-300 ${
                                            selectedQuarter.sheetId === quarter.sheetId
                                                ? 'bg-blue-600 text-white shadow-xl shadow-blue-200 ring-2 ring-blue-600 ring-offset-2'
                                                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-100'
                                        }`}
                                    >
                                        <div className="relative z-10 flex items-center justify-between">
                                            <span className={`font-black text-lg ${selectedQuarter.sheetId === quarter.sheetId ? 'text-white' : 'text-gray-900'}`}>
                                                {quarter.label}
                                            </span>
                                            <ChevronRight className={`w-4 h-4 transition-transform ${selectedQuarter.sheetId === quarter.sheetId ? 'translate-x-0 opacity-100' : '-translate-x-2 opacity-0'}`} />
                                        </div>
                                    </button>
                                ))}
                            </div>

                            <div className="pt-6 border-t border-gray-100 mt-auto">
                                <div className="text-[9px] font-mono text-gray-400 uppercase tracking-widest">
                                    SECURE CLOUD STORAGE // 2026
                                </div>
                            </div>
                        </div>
                    </motion.aside>
                )}
            </AnimatePresence>

            <div className="flex-1 flex flex-col relative bg-white">
                {/* Fixed Toggle Switch */}
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className={`absolute left-0 bottom-8 z-50 p-3 bg-gray-950 text-white rounded-r-2xl shadow-xl hover:bg-blue-600 transition-all group`}
                >
                    {isOpen ? (
                        <ChevronLeft className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
                    ) : (
                        <ChevronRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
                    )}
                </button>

                <div className="flex-1 overflow-hidden w-full h-full relative">
                    <iframe
                        key={selectedQuarter.sheetId}
                        src={iframeUrl}
                        className="w-full h-full border-none opacity-0 animate-[fadeIn_0.5s_ease-out_forwards]"
                        allow="clipboard-read; clipboard-write"
                    />
                </div>
            </div>

            <style jsx global>{`
                @keyframes fadeIn {
                    from { opacity: 0; transform: scale(0.99); }
                    to { opacity: 1; transform: scale(1); }
                }
            `}</style>
        </div>
    );
}
