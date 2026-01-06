'use client';

import PageLayout from '@/components/PageLayout';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Tool, Settings, History } from '@/components/Icons';
import { useState } from 'react';

function RepairSidebar() {
    const [isOpen, setIsOpen] = useState(true);

    return (
        <div className="relative flex-shrink-0 z-40 h-full">
            <AnimatePresence mode="wait">
                {isOpen && (
                    <motion.aside
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 300, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        transition={{ type: "spring", damping: 25, stiffness: 120 }}
                        className="bg-gray-950 text-white flex-shrink-0 h-full overflow-hidden border-r border-white/5 relative group"
                    >
                        <button
                            onClick={() => setIsOpen(false)}
                            className="absolute top-4 right-4 z-50 p-2 bg-white/5 hover:bg-white/10 text-white rounded-xl transition-all opacity-0 group-hover:opacity-100"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>

                        <div className="p-6 space-y-8">
                            <header>
                                <h2 className="text-xl font-black uppercase tracking-tighter">Repair Core</h2>
                                <p className="text-[9px] font-bold text-blue-500 uppercase tracking-widest mt-1">Diagnostic Tools</p>
                            </header>

                            <div className="space-y-2">
                                {[
                                    { icon: Tool, label: 'Active Repairs' },
                                    { icon: History, label: 'Repair Log' },
                                    { icon: Settings, label: 'Configuration' },
                                ].map((item, i) => (
                                    <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-all cursor-pointer group/item">
                                        <item.icon className="w-4 h-4 text-gray-500 group-hover/item:text-blue-400" />
                                        <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 group-hover/item:text-white">{item.label}</span>
                                    </div>
                                ))}
                            </div>

                            <div className="p-4 rounded-2xl bg-blue-600/10 border border-blue-500/20">
                                <p className="text-[9px] font-bold text-blue-400 uppercase leading-relaxed italic">
                                    New features coming soon to the repair workstation.
                                </p>
                            </div>
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

export default function RepairPage() {
    return (
        <PageLayout
            sheetId="1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE"
            gid="408116623"
            showChecklist={false}
            customSidebar={<RepairSidebar />}
        />
    );
}
