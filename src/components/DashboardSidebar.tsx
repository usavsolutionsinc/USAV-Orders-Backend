'use client';

import { useState } from 'react';
import { Database, Loader2, Check, X, BarChart3, TrendingUp, Package, AlertCircle, ChevronLeft, ChevronRight } from './Icons';
import { motion, AnimatePresence } from 'framer-motion';

export default function DashboardSidebar() {
    const [isOpen, setIsOpen] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

    const handleSync = async () => {
        setIsSyncing(true);
        setStatus(null);
        try {
            const res = await fetch('/api/sync-sheets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'sync_all' }),
            });
            const data = await res.json();
            if (data.success) {
                const totalSheets = data.results.filter((r: any) => r.status === 'success').length;
                setStatus({ type: 'success', message: `Synced ${totalSheets} sheets to Neon DB` });
            } else {
                setStatus({ type: 'error', message: data.error || 'Sync failed' });
            }
        } catch (error) {
            setStatus({ type: 'error', message: 'Network error occurred' });
        } finally {
            setIsSyncing(false);
        }
    };

    return (
        <div className="relative flex-shrink-0 z-40 h-full">
            <AnimatePresence mode="wait">
                {isOpen && (
                    <motion.aside
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 340, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        transition={{ type: "spring", damping: 25, stiffness: 120 }}
                        className="bg-gray-950 text-white flex-shrink-0 h-full overflow-hidden border-r border-white/5 relative group"
                    >
                        <button
                            onClick={() => setIsOpen(false)}
                            className="absolute top-4 right-4 z-50 p-2 bg-white/5 hover:bg-white/10 text-white rounded-xl transition-all opacity-0 group-hover:opacity-100"
                            title="Collapse Menu"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>

                        <div className="p-6 h-full flex flex-col space-y-6 overflow-y-auto scrollbar-hide">
                            <header>
                                <h2 className="text-xl font-black tracking-tighter uppercase leading-none">
                                    Management
                                </h2>
                                <p className="text-[9px] font-bold text-blue-500 uppercase tracking-widest mt-1">
                                    Database & Metrics
                                </p>
                            </header>
                            
                            <div className="space-y-4">
                                <button
                                    onClick={handleSync}
                                    disabled={isSyncing}
                                    className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:opacity-50 text-white rounded-2xl p-4 flex flex-col items-center gap-2 transition-all group active:scale-95 shadow-lg shadow-emerald-600/20"
                                >
                                    {isSyncing ? (
                                        <Loader2 className="w-6 h-6 animate-spin" />
                                    ) : (
                                        <Database className="w-6 h-6 group-hover:scale-110 transition-transform" />
                                    )}
                                    <div className="text-center">
                                        <p className="text-[10px] font-black uppercase tracking-widest">Sync All to Neon DB</p>
                                        <p className="text-[8px] font-bold opacity-60 uppercase mt-0.5">Neon DB as Source of Truth</p>
                                    </div>
                                </button>

                                {status && (
                                    <div className={`p-4 rounded-2xl border ${status.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'} flex items-start gap-3`}>
                                        {status.type === 'success' ? <Check className="w-4 h-4 mt-0.5 shrink-0" /> : <X className="w-4 h-4 mt-0.5 shrink-0" />}
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-black uppercase tracking-widest">{status.type === 'success' ? 'Success' : 'Error'}</p>
                                            <p className="text-[9px] font-medium leading-relaxed">{status.message}</p>
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="bg-white/5 p-4 rounded-2xl border border-white/10 hover:bg-white/[0.08] transition-all">
                                        <div className="flex items-center gap-2 mb-2">
                                            <BarChart3 className="w-3.5 h-3.5 text-blue-400" />
                                            <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">Efficiency</span>
                                        </div>
                                        <p className="text-xl font-black tracking-tighter text-blue-400">94%</p>
                                    </div>
                                    <div className="bg-white/5 p-4 rounded-2xl border border-white/10 hover:bg-white/[0.08] transition-all">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Package className="w-3.5 h-3.5 text-purple-400" />
                                            <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">Inventory</span>
                                        </div>
                                        <p className="text-xl font-black tracking-tighter text-purple-400">8.2k</p>
                                    </div>
                                </div>
                            </div>

                            <footer className="mt-auto pt-4 border-t border-white/5 opacity-30 text-center">
                                <p className="text-[7px] font-mono uppercase tracking-[0.2em]">USAV INFRASTRUCTURE</p>
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
