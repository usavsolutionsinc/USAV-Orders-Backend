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

    // Force packing stations to stay on MAIN tab on mobile
    useEffect(() => {
        if (isMobile && stationType === 'packing' && activeTab !== 'MAIN') {
            setActiveTab('MAIN');
        }
    }, [isMobile, stationType, activeTab]);

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
        // Simplified mobile layout - just show main content for all station types
        return (
            <div className="fixed inset-0 bg-white overflow-hidden flex flex-col">
                <div className="flex-1 relative overflow-hidden">
                    {children}
                </div>
            </div>
        );
    }

    // Desktop Layout
    return (
        <div className="flex h-full w-full bg-white overflow-hidden">
            <div className="flex-1 flex overflow-hidden w-full">
                {/* Main Content - takes full width for packing stations, minimum 350px for testing */}
                <div className={`flex flex-col bg-gray-50/30 overflow-hidden transition-all duration-300 ${stationType === 'packing' ? 'flex-1 min-w-0' : 'w-[400px] min-w-[350px] border-r border-gray-100 flex-shrink-0'}`}>
                    {children}
                </div>

                {/* Right History Sidebar - Full Width for testing, hidden for packing */}
                <div className={`flex flex-col min-w-0 bg-white overflow-hidden ${stationType === 'packing' ? 'w-0 hidden' : 'flex-1'}`}>
                    {historyContent}
                </div>
            </div>
        </div>
    );
}
