'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight } from '@/components/Icons';
import ReceivingEntryForm from '@/components/ReceivingEntryForm';
import ReceivingTaskList from '@/components/ReceivingTaskList';
import ReceivingSidebar from '@/components/ReceivingSidebar';

export default function ReceivingPage() {
    const [entryFormOpen, setEntryFormOpen] = useState(true);
    const [rightPanelOpen, setRightPanelOpen] = useState(true);

    const sheetId = "1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE";
    const gid = "1105987606";
    
    const baseUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
    const queryParams = new URLSearchParams();
    queryParams.append('gid', gid);
    queryParams.append('rm', 'minimal');
    queryParams.append('single', 'true');
    queryParams.append('widget', 'false');
    const iframeUrl = `${baseUrl}?${queryParams.toString()}#gid=${gid}`;

    return (
        <div className="flex h-full w-full bg-gray-950 overflow-hidden">
            {/* LEFT SIDE: New Shipment Entry Form */}
            <div className="relative flex-shrink-0 z-30 flex h-full">
                <AnimatePresence mode="wait">
                    {entryFormOpen && (
                        <motion.div 
                            initial={{ width: 0, opacity: 0 }}
                            animate={{ width: 380, opacity: 1 }}
                            exit={{ width: 0, opacity: 0 }}
                            transition={{ type: "spring", damping: 25, stiffness: 120 }}
                            className="bg-gray-950 border-r border-white/5 h-full overflow-hidden relative group"
                        >
                            <button
                                onClick={() => setEntryFormOpen(false)}
                                className="absolute top-4 right-4 z-50 p-2 bg-white/5 hover:bg-white/10 text-white rounded-xl transition-all opacity-0 group-hover:opacity-100"
                                title="Collapse Form"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            <div className="w-[380px] h-full overflow-y-auto scrollbar-hide">
                                <ReceivingEntryForm />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
                
                {!entryFormOpen && (
                    <button
                        onClick={() => setEntryFormOpen(true)}
                        className="fixed top-20 left-0 z-[60] p-3 bg-white text-gray-950 rounded-r-2xl shadow-xl hover:bg-green-600 hover:text-white transition-all duration-300 group"
                    >
                        <ChevronRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
                    </button>
                )}
            </div>

            {/* CENTER: Google Sheet */}
            <div className="flex-1 flex flex-col relative overflow-hidden bg-white z-10">
                <div className="flex-1 w-full h-full relative group">
                    <iframe
                        key={`${sheetId}-${gid}`}
                        src={iframeUrl}
                        className="w-full h-full border-none opacity-0 animate-[fadeIn_0.5s_ease-out_forwards_0.5s]"
                        allow="clipboard-read; clipboard-write"
                        title="Google Sheet Viewer"
                    />
                </div>
            </div>

            {/* RIGHT SIDE: Urgent Ship & Receiving Tasks */}
            <div className="relative flex-shrink-0 z-30 flex h-full">
                {!rightPanelOpen && (
                    <button
                        onClick={() => setRightPanelOpen(true)}
                        className="fixed top-20 right-0 z-[60] p-3 bg-white text-gray-950 rounded-l-2xl shadow-xl hover:bg-blue-600 hover:text-white transition-all duration-300 group"
                    >
                        <ChevronLeft className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
                    </button>
                )}

                <AnimatePresence mode="wait">
                    {rightPanelOpen && (
                        <motion.div 
                            initial={{ width: 0, opacity: 0 }}
                            animate={{ width: 400, opacity: 1 }}
                            exit={{ width: 0, opacity: 0 }}
                            transition={{ type: "spring", damping: 25, stiffness: 120 }}
                            className="bg-gray-950 border-l border-white/5 h-full overflow-hidden relative group flex flex-col"
                        >
                            <button
                                onClick={() => setRightPanelOpen(false)}
                                className="absolute top-4 left-4 z-50 p-2 bg-white/5 hover:bg-white/10 text-white rounded-xl transition-all opacity-0 group-hover:opacity-100"
                                title="Collapse Tools"
                            >
                                <ChevronRight className="w-4 h-4" />
                            </button>
                            
                            <div className="flex-1 overflow-y-auto scrollbar-hide">
                                {/* Using ReceivingSidebar component content here or composing it */}
                                <div className="border-b border-white/5">
                                    <ReceivingSidebar hideToggle />
                                </div>
                                <div className="flex-1 min-h-[400px]">
                                    <ReceivingTaskList />
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <style jsx global>{`
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    );
}
