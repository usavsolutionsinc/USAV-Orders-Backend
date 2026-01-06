'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, BarChart3, TrendingUp, Package, AlertCircle } from './Icons';
import { motion, AnimatePresence } from 'framer-motion';

export default function Sidebar() {
    const [isOpen, setIsOpen] = useState(true);

    return (
        <div className="relative flex-shrink-0 z-40">
            <AnimatePresence mode="wait">
                {isOpen && (
                    <motion.aside
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 340, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        transition={{ type: "spring", damping: 25, stiffness: 120 }}
                        className="bg-gray-950 text-white flex-shrink-0 h-full overflow-hidden border-r border-white/5"
                    >
                        <div className="p-8 h-full flex flex-col space-y-8 overflow-y-auto scrollbar-hide">
                            <header>
                                <h2 className="text-2xl font-black tracking-tighter uppercase leading-none">
                                    Metrics
                                </h2>
                                <p className="text-[10px] font-bold text-blue-500 uppercase tracking-[0.3em] mt-1">
                                    Live Performance Feed
                                </p>
                            </header>
                            
                            <div className="space-y-4">
                                {/* Modern KPI Cards */}
                                <div className="bg-white/5 p-6 rounded-3xl border border-white/10 hover:bg-white/[0.08] transition-all group">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="p-2 bg-blue-500/20 rounded-xl">
                                            <BarChart3 className="w-5 h-5 text-blue-400" />
                                        </div>
                                        <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest bg-emerald-400/10 px-2 py-1 rounded-md">
                                            +12.4%
                                        </span>
                                    </div>
                                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Daily Throughput</p>
                                    <p className="text-4xl font-black tracking-tighter">1,284</p>
                                </div>

                                <div className="bg-white/5 p-6 rounded-3xl border border-white/10 hover:bg-white/[0.08] transition-all">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="p-2 bg-emerald-500/20 rounded-xl">
                                            <TrendingUp className="w-5 h-5 text-emerald-400" />
                                        </div>
                                        <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest bg-emerald-400/10 px-2 py-1 rounded-md">
                                            Optimal
                                        </span>
                                    </div>
                                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Cycle Time</p>
                                    <p className="text-4xl font-black tracking-tighter">4.2<span className="text-xl text-gray-500">m</span></p>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-white/5 p-5 rounded-3xl border border-white/10">
                                        <div className="flex items-center gap-2 mb-3">
                                            <Package className="w-4 h-4 text-purple-400" />
                                            <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">Stock</span>
                                        </div>
                                        <p className="text-2xl font-black tracking-tighter text-purple-400">8.2k</p>
                                    </div>
                                    <div className="bg-white/5 p-5 rounded-3xl border border-white/10">
                                        <div className="flex items-center gap-2 mb-3">
                                            <AlertCircle className="w-4 h-4 text-orange-400" />
                                            <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">Alerts</span>
                                        </div>
                                        <p className="text-2xl font-black tracking-tighter text-orange-400">03</p>
                                    </div>
                                </div>

                                {/* Modern Chart Block */}
                                <div className="bg-blue-600 p-6 rounded-3xl shadow-[0_15px_30px_rgba(37,99,235,0.3)]">
                                    <h3 className="text-xs font-black uppercase tracking-widest mb-4 opacity-80">Weekly Load</h3>
                                    <div className="h-24 flex items-end justify-between gap-1.5">
                                        {[30, 45, 62, 38, 71, 55, 83].map((height, i) => (
                                            <motion.div 
                                                key={i} 
                                                initial={{ height: 0 }}
                                                animate={{ height: `${height}%` }}
                                                transition={{ delay: i * 0.1, duration: 0.8 }}
                                                className="flex-1 bg-white/20 rounded-t-lg hover:bg-white/40 transition-all cursor-pointer relative group/bar"
                                            >
                                                <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-white text-blue-600 text-[8px] font-black px-1.5 py-0.5 rounded opacity-0 group-hover/bar:opacity-100 transition-opacity">
                                                    {height}%
                                                </div>
                                            </motion.div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <footer className="mt-auto pt-6 border-t border-white/5 opacity-30">
                                <p className="text-[8px] font-mono uppercase tracking-[0.4em]">USAV OS CORE v2 // ENCRYPTED ACCESS</p>
                            </footer>
                        </div>
                    </motion.aside>
                )}
            </AnimatePresence>

            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`absolute top-4 z-[60] p-3 bg-white text-gray-950 rounded-r-2xl shadow-[10px_0_30px_rgba(0,0,0,0.5)] hover:bg-blue-600 hover:text-white transition-all duration-300 group ${
                    isOpen ? 'left-full' : 'fixed left-0'
                }`}
            >
                {isOpen ? (
                    <ChevronLeft className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
                ) : (
                    <ChevronRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
                )}
            </button>
        </div>
    );
}
