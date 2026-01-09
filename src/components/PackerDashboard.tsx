'use client';

import React, { useState, useEffect } from 'react';
import StationLayout from './station/StationLayout';
import StationNav from './station/StationNav';
import StationHistory from './station/StationHistory';
import StationPacking from './station/StationPacking';

interface PackerDashboardProps {
    packerId: string;
}

export default function PackerDashboard({ packerId }: PackerDashboardProps) {
    const [history, setHistory] = useState<any[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [todayCount, setTodayCount] = useState(0);
    const [goal] = useState(50);

    useEffect(() => {
        fetchHistory();
    }, []);

    const fetchHistory = async () => {
        setIsLoadingHistory(true);
        try {
            const res = await fetch(`/api/packing-logs?packerId=${packerId}`);
            if (!res.ok) throw new Error('Failed to fetch');
            const data = await res.json();
            if (Array.isArray(data)) {
                // Normalize data immediately
                const normalizedData = data.map((log: any) => ({
                    ...log,
                    timestamp: log.packedAt || log.timestamp,
                    title: log.product || log.title,
                    tracking: log.trackingNumber || log.tracking,
                    status: log.carrier || log.status,
                    id: log.id || `log-${Math.random()}`
                }));
                
                setHistory(normalizedData);
                const today = new Date().toISOString().split('T')[0];
                const count = normalizedData.filter((log: any) => {
                    try {
                        return log.timestamp && log.timestamp.split('T')[0] === today;
                    } catch (e) { return false; }
                }).length;
                setTodayCount(count);
            }
        } catch (err) {
            console.error("Failed to fetch history:", err);
        } finally {
            setIsLoadingHistory(false);
        }
    };

    return (
        <StationLayout
            stationType="packing"
            stationId={packerId}
            navContent={<StationNav />}
            historyContent={
                <StationHistory 
                    history={history} 
                    isLoading={isLoadingHistory} 
                    title="Packer History"
                    stationType="packing"
                />
            }
        >
            <StationPacking 
                packerId={packerId}
                todayCount={todayCount}
                goal={goal}
                onPacked={fetchHistory}
            />
        </StationLayout>
    );
}
