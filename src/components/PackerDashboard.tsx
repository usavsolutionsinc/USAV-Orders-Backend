'use client';

import React, { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
    const queryClient = useQueryClient();
    const { activeOrderPane, setActiveOrderPane } = usePackerOrderPane();

    useEffect(() => {
        void showStaffSelector;
    }, [showStaffSelector]);

    useEffect(() => {
        // `usav-refresh-data` used to remount the whole pane via a `key` nonce
        // (dropped cache + scroll). Invalidate the packer-logs query instead so
        // React Query refetches in place (station-table-unification §Phase 2).
        const handleRefresh = () => queryClient.invalidateQueries({ queryKey: ['packer-logs'] });
        window.addEventListener('usav-refresh-data', handleRefresh as EventListener);
        return () => {
            window.removeEventListener('usav-refresh-data', handleRefresh as EventListener);
        };
    }, [queryClient]);

    return (
        <>
            <div className="relative flex h-full w-full">
                <div className="relative min-h-0 flex-1 overflow-hidden">
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
