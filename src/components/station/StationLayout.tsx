'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, useAnimation } from 'framer-motion';
import { Menu, History, ChevronLeft, ChevronRight, LayoutDashboard, Package, Wrench } from '../Icons';

interface StationLayoutProps {
    children: React.ReactNode;
    navContent: React.ReactNode;
    historyContent: React.ReactNode;
    stationType: 'packing' | 'testing';
    stationId: string;
}

export default function StationLayout({ 
    children, 
    navContent, 
    historyContent, 
    stationType,
    stationId 
}: StationLayoutProps) {
    const [activeTab, setActiveTab] = useState<'NAV' | 'MAIN' | 'HISTORY'>('MAIN');
    const [isMobile, setIsMobile] = useState(false);
    const [isNavCollapsed, setIsNavCollapsed] = useState(false);

    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 1024);
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    const x = useMotionValue(0);
    const controls = useAnimation();

    const handleDragEnd = (event: any, info: any) => {
        const threshold = 100;
        if (info.offset.x < -threshold) {
            // Swipe Left -> Move to next tab
            if (activeTab === 'NAV') setActiveTab('MAIN');
            // History disabled on mobile as per request
            // else if (activeTab === 'MAIN') setActiveTab('HISTORY');
        } else if (info.offset.x > threshold) {
            // Swipe Right -> Move to previous tab
            if (activeTab === 'HISTORY') setActiveTab('MAIN');
            else if (activeTab === 'MAIN') setActiveTab('NAV');
        }
        controls.start({ x: 0 });
    };

    const getXOffset = () => {
        if (activeTab === 'NAV') return '0%';
        if (activeTab === 'MAIN') return '-100%';
        if (activeTab === 'HISTORY') return '-200%';
        return '0%';
    };

    if (isMobile) {
        return (
            <div className="fixed inset-0 bg-white overflow-hidden flex flex-col">
                {/* Mobile Swipe Area */}
                <div className="flex-1 relative overflow-hidden">
                    <motion.div
                        drag="x"
                        dragConstraints={{ left: 0, right: 0 }}
                        onDragEnd={handleDragEnd}
                        animate={{ x: getXOffset() }}
                        transition={{ type: "spring", damping: 25, stiffness: 200 }}
                        className="flex h-full w-[300%]"
                    >
                        {/* Nav Pane */}
                        <div className="w-full h-full overflow-hidden">
                            {navContent}
                        </div>
                        {/* Main Pane */}
                        <div className="w-full h-full overflow-hidden border-x border-gray-100">
                            {children}
                        </div>
                        {/* History Pane (Hidden/Disabled on Mobile) */}
                        <div className="w-full h-full overflow-hidden">
                            <div className="flex items-center justify-center h-full text-gray-400">
                                <p className="text-xs uppercase tracking-widest font-black">History Disabled on Mobile</p>
                            </div>
                        </div>
                    </motion.div>
                </div>

                {/* Mobile Tab Indicators / Minimal Nav */}
                <div className="h-14 flex items-center justify-between px-10 bg-white border-t border-gray-50">
                    {stationType !== 'packing' ? (
                        <button 
                            onClick={() => setActiveTab('NAV')}
                            className={`p-2 rounded-xl transition-all ${activeTab === 'NAV' ? 'text-blue-600' : 'text-gray-300'}`}
                        >
                            <LayoutDashboard className="w-6 h-6" />
                        </button>
                    ) : (
                        <div className="w-10" />
                    )}
                    
                    <div className="flex gap-1.5 h-1 items-center flex-1 justify-center">
                        {stationType !== 'packing' && (
                            <div className={`h-full rounded-full transition-all duration-300 ${activeTab === 'NAV' ? 'w-6 bg-blue-600' : 'w-2 bg-gray-100'}`} />
                        )}
                        <div className={`h-full rounded-full transition-all duration-300 ${activeTab === 'MAIN' ? 'w-6 bg-blue-600' : 'w-2 bg-gray-100'}`} />
                        {/* History Indicator Hidden on Mobile */}
                    </div>

                    {/* History Button Hidden on Mobile */}
                    <div className="w-10" />
                </div>
            </div>
        );
    }

    // Desktop Layout
    return (
        <div className="flex h-full w-full bg-white overflow-hidden">
            <div className="flex-1 flex overflow-hidden w-full">
                {/* Main Content */}
                <div className={`flex flex-col min-w-0 bg-gray-50/30 overflow-hidden transition-all duration-300 ${stationType === 'testing' ? 'w-[400px] border-r border-gray-100 flex-shrink-0' : 'w-0 hidden'}`}>
                    {children}
                </div>

                {/* Right History Sidebar - Full Width */}
                <div className="flex-1 flex flex-col min-w-0 bg-white overflow-hidden">
                    {historyContent}
                </div>
            </div>
        </div>
    );
}
