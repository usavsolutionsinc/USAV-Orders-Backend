'use client';

import Sidebar from './Sidebar';
import Checklist from './Checklist';
import { useState } from 'react';
import { ChevronRight, ChevronLeft } from './Icons';

interface PageLayoutProps {
    role?: 'technician' | 'packer';
    userId?: string;
    sheetId: string;
    gid?: string;
    showChecklist?: boolean;
    showSidebar?: boolean;
}

export default function PageLayout({ 
    role, 
    userId = '1', 
    sheetId, 
    gid,
    showChecklist = false,
    showSidebar = false 
}: PageLayoutProps) {
    const [checklistOpen, setChecklistOpen] = useState(true);

    // Modern 2026 URL Construction
    // Using widget=true and headers=false for a cleaner integrated look
    const iframeUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/htmlembed?${gid ? `gid=${gid}&` : ''}widget=false&chrome=false&headers=false&range=A1:Z1000`;
    
    // For editable sheets, we use the /edit URL with query parameters
    const editableUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit?${gid ? `gid=${gid}&` : ''}rm=minimal&single=true&widget=false`;

    return (
        <div className="flex h-full w-full bg-gray-100 overflow-hidden">
            {/* Left Sidebar (KPI or Checklist) */}
            {showSidebar && <Sidebar />}
            
            {showChecklist && role && (
                <div 
                    className={`transition-all duration-500 ease-in-out bg-white border-r border-gray-200 flex flex-col shadow-2xl z-40 ${
                        checklistOpen ? 'w-[400px]' : 'w-0'
                    }`}
                >
                    <div className="flex-1 overflow-hidden min-w-[400px]">
                        <Checklist role={role} userId={userId} />
                    </div>
                </div>
            )}

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col relative overflow-hidden bg-white">
                {/* Fixed Overlay Toggles for UX */}
                {showChecklist && (
                    <button
                        onClick={() => setChecklistOpen(!checklistOpen)}
                        className={`absolute left-0 bottom-8 z-50 p-3 bg-gray-900 text-white rounded-r-2xl shadow-[5px_0_15px_rgba(0,0,0,0.3)] hover:bg-blue-600 transition-all duration-300 group`}
                    >
                        {checklistOpen ? (
                            <ChevronLeft className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
                        ) : (
                            <ChevronRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
                        )}
                    </button>
                )}

                <div className="flex-1 w-full h-full relative group">
                    {/* Progress Loader Simulation for 2026 feel */}
                    <div className="absolute top-0 left-0 w-full h-0.5 bg-blue-500/20 z-10">
                        <div className="h-full bg-blue-500 animate-[loading_2s_ease-in-out_infinite]" style={{ width: '30%' }}></div>
                    </div>

                    <iframe
                        src={editableUrl}
                        className="w-full h-full border-none opacity-0 animate-[fadeIn_0.5s_ease-out_forwards_0.5s]"
                        allow="clipboard-read; clipboard-write"
                        title="Google Sheet Viewer"
                    />
                </div>
            </div>

            <style jsx global>{`
                @keyframes loading {
                    0% { transform: translateX(-100%); width: 10%; }
                    50% { width: 40%; }
                    100% { transform: translateX(300%); width: 10%; }
                }
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    );
}
