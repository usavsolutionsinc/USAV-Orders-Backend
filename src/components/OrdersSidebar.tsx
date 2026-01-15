'use client';

import { useState } from 'react';
import { Database, Loader2, Check, X } from './Icons';
import { motion, AnimatePresence } from 'framer-motion';

export default function OrdersSidebar() {
    const [isOpen, setIsOpen] = useState(true);
    const [isTransferring, setIsTransferring] = useState(false);
    const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
    const [manualSheetName, setManualSheetName] = useState('');

    const handleTransfer = async () => {
        setIsTransferring(true);
        setStatus(null);
        try {
            const res = await fetch('/api/google-sheets/transfer-orders', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    manualSheetName: manualSheetName.trim() || undefined
                }),
            });
            const data = await res.json();
            if (data.success) {
                const message = data.rowCount > 0 
                    ? `Successfully transferred ${data.rowCount} order${data.rowCount === 1 ? '' : 's'}` 
                    : 'Orders are already transferred';
                setStatus({ type: 'success', message });
            } else {
                setStatus({ type: 'error', message: data.error || 'Transfer failed' });
            }
        } catch (error) {
            setStatus({ type: 'error', message: 'Network error occurred' });
        } finally {
            setIsTransferring(false);
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
                        <div className="p-6 h-full flex flex-col space-y-6 overflow-y-auto scrollbar-hide">
                            <header>
                                <h2 className="text-xl font-black tracking-tighter uppercase leading-none">
                                    Order Management
                                </h2>
                                <p className="text-[9px] font-bold text-blue-500 uppercase tracking-widest mt-1">
                                    Sheet Tools
                                </p>
                            </header>
                            
                            <div className="space-y-4">
                                {/* Manual Sheet Entry Field */}
                                <div className="space-y-2">
                                    <label className="block">
                                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1 block">
                                            Manual Sheet Name (Optional)
                                        </span>
                                        <input
                                            type="text"
                                            value={manualSheetName}
                                            onChange={(e) => setManualSheetName(e.target.value)}
                                            placeholder="e.g., Sheet_01_14_2026"
                                            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-[11px] font-mono text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                            disabled={isTransferring}
                                        />
                                    </label>
                                    <p className="text-[8px] text-gray-500 font-medium italic leading-relaxed">
                                        Enter sheet tab name to override auto-detection (e.g., Sheet_01_14_2026)
                                    </p>
                                </div>

                                <button
                                    onClick={handleTransfer}
                                    disabled={isTransferring}
                                    className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:opacity-50 text-white rounded-2xl p-4 flex flex-col items-center gap-2 transition-all group active:scale-95 shadow-lg shadow-blue-600/20"
                                >
                                    {isTransferring ? (
                                        <Loader2 className="w-6 h-6 animate-spin" />
                                    ) : (
                                        <Database className="w-6 h-6 group-hover:scale-110 transition-transform" />
                                    )}
                                    <div className="text-center">
                                        <p className="text-[10px] font-black uppercase tracking-widest">Import Latest Orders</p>
                                        <p className="text-[8px] font-bold opacity-60 uppercase mt-0.5">From Master Sheet</p>
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

                                <div className="p-5 rounded-2xl bg-white/5 border border-white/10">
                                    <h3 className="text-[9px] font-black uppercase tracking-widest text-gray-500 mb-2">Instructions</h3>
                                    <p className="text-[10px] leading-relaxed text-gray-400 font-medium italic">
                                        This will read the latest daily sheet from the Master Spreadsheet and transfer orders with tracking to the local orders sheet.
                                    </p>
                                </div>
                            </div>

                            <footer className="mt-auto pt-4 border-t border-white/5 opacity-30 text-center">
                                <p className="text-[7px] font-mono uppercase tracking-[0.2em]">USAV AUTOMATION</p>
                            </footer>
                        </div>
                    </motion.aside>
                )}
            </AnimatePresence>
        </div>
    );
}
