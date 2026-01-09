'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, BarChart3, TrendingUp, Package, AlertCircle } from './Icons';
import { motion, AnimatePresence } from 'framer-motion';

export default function Sidebar() {
    const [isOpen, setIsOpen] = useState(true);

    return (
        <div className="relative flex-shrink-0 z-40 h-full">
            <AnimatePresence mode="wait">
                {isOpen && (
                    <motion.aside
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 340, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        transition={{ type: "spring", damping: 25, stiffness: 120 }}
                        className="bg-white text-gray-900 flex-shrink-0 h-full overflow-hidden border-r border-gray-100 relative group"
                    >
                        <button
                            onClick={() => setIsOpen(false)}
                            className="absolute top-4 right-4 z-50 p-2 bg-gray-50 hover:bg-gray-100 text-gray-400 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                            title="Collapse Menu"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>

                        <div className="p-6 h-full flex flex-col space-y-6 overflow-y-auto scrollbar-hide">
                            <header>
                                <h2 className="text-xl font-black tracking-tighter uppercase leading-none text-gray-900">
                                    Metrics
                                </h2>
                                <p className="text-[9px] font-bold text-blue-600 uppercase tracking-widest mt-1">
                                    Live Performance
                                </p>
                            </header>
                            
                            <div className="space-y-4">
                                <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100 hover:bg-gray-100 transition-all">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="p-2 bg-blue-500/10 rounded-xl">
                                            <BarChart3 className="w-4 h-4 text-blue-600" />
                                        </div>
                                        <span className="text-[9px] font-black text-emerald-600 uppercase tracking-widest bg-emerald-50 px-2 py-1 rounded-md">
                                            +12.4%
                                        </span>
                                    </div>
                                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">Throughput</p>
                                    <p className="text-3xl font-black tracking-tighter text-gray-900">1,284</p>
                                </div>

                                <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100 hover:bg-gray-100 transition-all">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="p-2 bg-emerald-500/10 rounded-xl">
                                            <TrendingUp className="w-4 h-4 text-emerald-600" />
                                        </div>
                                        <span className="text-[9px] font-black text-emerald-600 uppercase tracking-widest bg-emerald-50 px-2 py-1 rounded-md">
                                            Optimal
                                        </span>
                                    </div>
                                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">Cycle Time</p>
                                    <p className="text-3xl font-black tracking-tighter text-gray-900">4.2<span className="text-lg text-gray-400 ml-1">m</span></p>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Package className="w-3.5 h-3.5 text-purple-600" />
                                            <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest">Stock</span>
                                        </div>
                                        <p className="text-xl font-black tracking-tighter text-purple-600">8.2k</p>
                                    </div>
                                    <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                                        <div className="flex items-center gap-2 mb-2">
                                            <AlertCircle className="w-3.5 h-3.5 text-orange-600" />
                                            <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest">Alerts</span>
                                        </div>
                                        <p className="text-xl font-black tracking-tighter text-orange-600">03</p>
                                    </div>
                                </div>

                                <div className="bg-blue-600 p-5 rounded-2xl shadow-lg">
                                    <h3 className="text-[9px] font-black uppercase tracking-widest mb-3 opacity-80 text-white">Weekly Load</h3>
                                    <div className="h-20 flex items-end justify-between gap-1">
                                        {[30, 45, 62, 38, 71, 55, 83].map((height, i) => (
                                            <motion.div 
                                                key={i} 
                                                initial={{ height: 0 }}
                                                animate={{ height: `${height}%` }}
                                                transition={{ delay: i * 0.1, duration: 0.8 }}
                                                className="flex-1 bg-white/20 rounded-t-md hover:bg-white/40 transition-all cursor-pointer relative group/bar"
                                            >
                                                <div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-white text-blue-600 text-[7px] font-black px-1 py-0.5 rounded opacity-0 group-hover/bar:opacity-100 transition-opacity whitespace-nowrap">
                                                    {height}%
                                                </div>
                                            </motion.div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <footer className="mt-auto pt-4 border-t border-white/5 opacity-30 text-center">
                                <p className="text-[7px] font-mono uppercase tracking-[0.2em]">USAV CORE</p>
                            </footer>
                        </div>
                    </motion.aside>
                )}
            </AnimatePresence>

            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="fixed top-20 left-0 z-[60] p-3 bg-white text-gray-950 rounded-r-2xl shadow-xl hover:bg-blue-600 hover:text-white transition-all duration-300 group"
                >
                    <ChevronRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
                </button>
            )}
        </div>
    );
}
