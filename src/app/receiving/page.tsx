'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight } from '@/components/Icons';
import ReceivingEntryForm from '@/components/ReceivingEntryForm';
import ReceivingTaskList from '@/components/ReceivingTaskList';
import ReceivingSidebar from '@/components/ReceivingSidebar';

export default function ReceivingPage() {
    const [entryFormOpen, setEntryFormOpen] = useState(true);
    const [taskListOpen, setTaskListOpen] = useState(true);

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
            {/* 1. Urgent Tracking Sidebar (Left - Always exists, handles its own toggle) */}
            <ReceivingSidebar />
            
            {/* 2. Entry Form (Left Sidebar - Next to Urgent Tracking) */}
            <div className="relative flex-shrink-0 z-30 flex h-full">
                <AnimatePresence mode="wait">
                    {entryFormOpen && (
                        <motion.div 
                            initial={{ width: 0, opacity: 0 }}
                            animate={{ width: 380, opacity: 1 }}
                            exit={{ width: 0, opacity: 0 }}
                            transition={{ type: "spring", damping: 25, stiffness: 120 }}
                            className="bg-gray-950 border-r border-white/5 h-full overflow-hidden"
                        >
                            <div className="w-[380px] h-full overflow-y-auto scrollbar-hide">
                                <ReceivingEntryForm />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
                
                {/* Entry Form Toggle Button - Pinned to its right edge */}
                <button
                    onClick={() => setEntryFormOpen(!entryFormOpen)}
                    className={`absolute top-4 z-[60] p-3 bg-white text-gray-950 rounded-r-2xl shadow-[10px_0_30px_rgba(0,0,0,0.5)] hover:bg-green-600 hover:text-white transition-all duration-300 group ${
                        entryFormOpen ? 'left-full' : 'left-0'
                    }`}
                    title="Toggle Entry Form"
                >
                    {entryFormOpen ? (
                        <ChevronLeft className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
                    ) : (
                        <ChevronRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
                    )}
                </button>
            </div>

            {/* 3. Main Content Area - Google Sheet */}
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

            {/* 4. Task List (Right Sidebar) */}
            <div className="relative flex-shrink-0 z-30 flex h-full">
                <AnimatePresence mode="wait">
                    {taskListOpen && (
                        <motion.div 
                            initial={{ width: 0, opacity: 0 }}
                            animate={{ width: 400, opacity: 1 }}
                            exit={{ width: 0, opacity: 0 }}
                            transition={{ type: "spring", damping: 25, stiffness: 120 }}
                            className="bg-gray-950 border-l border-white/5 h-full overflow-hidden"
                        >
                            <div className="w-[400px] h-full">
                                <ReceivingTaskList />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Task List Toggle Button - Top Right of screen (inside menu when expanded) */}
                <button
                    onClick={() => setTaskListOpen(!taskListOpen)}
                    className="fixed top-4 right-4 z-[70] p-3 bg-white text-gray-950 rounded-2xl shadow-[0_10px_30px_rgba(0,0,0,0.5)] hover:bg-blue-600 hover:text-white transition-all duration-300 group"
                    title="Toggle Task List"
                >
                    {taskListOpen ? (
                        <ChevronRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
                    ) : (
                        <ChevronLeft className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
                    )}
                </button>
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
