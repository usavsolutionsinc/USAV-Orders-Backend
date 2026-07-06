'use client';

import React, { useState, useEffect } from 'react';
import { PackerRightPane } from '@/components/packer/PackerRightPane';
import { usePackerOrderPane } from '@/components/packer/usePackerOrderPane';
import { StationDetailsHandler } from './station/StationDetailsHandler';
import { useRealtimeToasts } from '@/hooks/useRealtimeToasts';

interface PackerDashboardProps {
    packerId: string;
    showStaffSelector?: boolean;
}

export default function PackerDashboard({ packerId, showStaffSelector = true }: PackerDashboardProps) {
    useRealtimeToasts('packer');
    const [refreshNonce, setRefreshNonce] = useState(0);
    const { activeOrderPane, setActiveOrderPane } = usePackerOrderPane();

    useEffect(() => {
        void showStaffSelector;
    }, [showStaffSelector]);

    useEffect(() => {
        const handleRefresh = () => setRefreshNonce((value) => value + 1);
        window.addEventListener('usav-refresh-data', handleRefresh as EventListener);
        return () => {
            window.removeEventListener('usav-refresh-data', handleRefresh as EventListener);
        };
    }, []);

    return (
        <>
            <div className="relative flex h-full w-full">
                <div key={refreshNonce} className="relative min-h-0 flex-1 overflow-hidden">
                    <PackerRightPane
                        packerId={packerId}
                        activeOrderPane={activeOrderPane}
                        onCloseActiveOrder={() => setActiveOrderPane(null)}
                    />
                </div>
            </div>
            <StationDetailsHandler stationRole="packer" />
        </>
    );
}
