'use client';

import React, { useState, useEffect } from 'react';
import { PackerTable } from './PackerTable';
import { StationDetailsHandler } from './station/StationDetailsHandler';

interface PackerDashboardProps {
    packerId: string;
    showStaffSelector?: boolean;
}

export default function PackerDashboard({ packerId, showStaffSelector = true }: PackerDashboardProps) {
    const [refreshNonce, setRefreshNonce] = useState(0);
    useEffect(() => {
        void showStaffSelector;
    }, [showStaffSelector]);

    useEffect(() => {
        const handleRefresh = () => setRefreshNonce((value) => value + 1);
        window.addEventListener('usav-refresh-data', handleRefresh as any);
        return () => {
            window.removeEventListener('usav-refresh-data', handleRefresh as any);
        };
    }, []);

    return (
        <>
        <div className="flex h-full w-full relative">
            <div className="flex-1 overflow-hidden">
                <PackerTable key={`${packerId}-${refreshNonce}`} packedBy={parseInt(packerId)} />
            </div>
        </div>
        <StationDetailsHandler stationRole="packer" />
        </>
    );
}
