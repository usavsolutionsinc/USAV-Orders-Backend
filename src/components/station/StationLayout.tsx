'use client';

import React, { useState } from 'react';

interface StationLayoutProps {
    children: React.ReactNode;
    navContent: React.ReactNode;
    historyContent: React.ReactNode;
    stationType: 'packing' | 'testing';
    stationId: string;
}

export default function StationLayout({ 
    children, 
    historyContent, 
    stationType
}: StationLayoutProps) {
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
