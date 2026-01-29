'use client';

import Sidebar from './Sidebar';
import { useState } from 'react';
import { ChevronRight, ChevronLeft } from './Icons';
import { motion, AnimatePresence } from 'framer-motion';

interface PageLayoutProps {
    role?: 'technician' | 'packer';
    userId?: string;
    sheetId: string;
    gid?: string;
    showSidebar?: boolean;
    editMode?: boolean;
    customSidebar?: React.ReactNode;
}

export default function PageLayout({ 
    role, 
    userId = '1', 
    sheetId, 
    gid,
    showSidebar = false,
    editMode = false,
    customSidebar
}: PageLayoutProps) {
    // ... rest of the file ...

    // Modern 2026 URL Construction
    const baseUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
    const queryParams = new URLSearchParams();
    
    if (gid) {
        queryParams.append('gid', gid);
    }

    // Always use minimal view as per 2026 requirements
    queryParams.append('rm', 'minimal');
    queryParams.append('single', 'true');
    queryParams.append('widget', 'false');
    
    // Construct full URL with both query param and hash for maximum compatibility
    const iframeUrl = `${baseUrl}?${queryParams.toString()}${gid ? `#gid=${gid}` : ''}`;

    return (
        <div className="flex h-full w-full bg-white overflow-hidden">
            {/* Left Sidebar(s) Container */}
            <div className="flex-shrink-0 z-50 flex h-full">
                {showSidebar && <Sidebar />}
                {customSidebar}
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col relative overflow-hidden bg-white">
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
