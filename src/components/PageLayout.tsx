'use client';

import Sidebar from './Sidebar';
import Checklist from './Checklist';
import { useState } from 'react';
import { ChevronRight, ChevronLeft } from './Icons';
import { motion, AnimatePresence } from 'framer-motion';

interface PageLayoutProps {
    role?: 'technician' | 'packer';
    userId?: string;
    sheetId: string;
    gid?: string;
    showChecklist?: boolean;
    showSidebar?: boolean;
    editMode?: boolean;
    customSidebar?: React.ReactNode;
}

export default function PageLayout({ 
    role, 
    userId = '1', 
    sheetId, 
    gid,
    showChecklist = false,
    showSidebar = false,
    editMode = false,
    customSidebar
}: PageLayoutProps) {
    const [checklistOpen, setChecklistOpen] = useState(true);

    // Modern 2026 URL Construction
    const baseUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
    const queryParams = new URLSearchParams();
    
    if (gid) {
        queryParams.append('gid', gid);
    }

    if (!editMode) {
        queryParams.append('rm', 'minimal');
        queryParams.append('single', 'true');
        queryParams.append('widget', 'false');
    }
    
    // Construct full URL with both query param and hash for maximum compatibility
    const iframeUrl = `${baseUrl}?${queryParams.toString()}${gid ? `#gid=${gid}` : ''}`;

    return (
        <div className="flex h-full w-full bg-gray-950 overflow-hidden">
            {/* Left Sidebar(s) Container */}
            <div className="flex-shrink-0 z-50 flex h-full">
                {showSidebar && <Sidebar />}
                {customSidebar}
                
                <AnimatePresence mode="wait">
                    {showChecklist && role && checklistOpen && (
                        <motion.div 
                            initial={{ width: 0, opacity: 0 }}
                            animate={{ width: 340, opacity: 1 }}
                            exit={{ width: 0, opacity: 0 }}
                            transition={{ type: "spring", damping: 25, stiffness: 120 }}
                            className="bg-gray-950 border-r border-white/5 flex flex-col z-40 overflow-hidden relative group"
                        >
                            <button
                                onClick={() => setChecklistOpen(false)}
                                className="absolute top-4 right-4 z-50 p-2 bg-white/5 hover:bg-white/10 text-white rounded-xl transition-all opacity-0 group-hover:opacity-100"
                                title="Collapse Menu"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            <div className="w-[340px] h-full">
                                <Checklist role={role} userId={userId} />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col relative overflow-hidden bg-white">
                {/* Fixed Overlay Toggles for UX */}
                {showChecklist && !checklistOpen && (
                    <button
                        onClick={() => setChecklistOpen(true)}
                        className="fixed top-20 left-0 z-[60] p-3 bg-white text-gray-950 rounded-r-2xl shadow-xl hover:bg-blue-600 hover:text-white transition-all duration-300 group"
                    >
                        <ChevronRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
                    </button>
                )}

                <div className="flex-1 w-full h-full relative group">
                    <iframe
                        key={`${sheetId}-${gid}-${editMode}`} // Key ensures iframe reloads when mode/tab changes
                        src={iframeUrl}
                        className="w-full h-full border-none opacity-0 animate-[fadeIn_0.5s_ease-out_forwards_0.5s]"
                        allow="clipboard-read; clipboard-write"
                        title="Google Sheet Viewer"
                    />
                </div>
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
