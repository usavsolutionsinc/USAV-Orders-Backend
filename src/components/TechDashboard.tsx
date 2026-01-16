'use client';

import React, { useState, useEffect } from 'react';
import StationLayout from './station/StationLayout';
import StationNav from './station/StationNav';
import TechLogs from './station/TechLogs';
import StationTesting from './station/StationTesting';

interface TechDashboardProps {
    techId: string;
    sheetId: string;
    gid?: string;
}

export default function TechDashboard({ techId, sheetId, gid }: TechDashboardProps) {
    const [history, setHistory] = useState<any[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);

    // Color mapping based on technician ID
    const getTechInfo = (id: string) => {
        if (id === '1') return { name: 'Michael', color: 'green' as const };
        if (id === '2') return { name: 'Thuc', color: 'blue' as const };
        return { name: 'Sang', color: 'purple' as const };
    };

    const techInfo = getTechInfo(techId);

    useEffect(() => {
        fetchHistory();
    }, []);

    const fetchHistory = async () => {
        setIsLoadingHistory(true);
        try {
            const res = await fetch(`/api/tech-logs?techId=${techId}`);
            if (!res.ok) throw new Error('Failed to fetch');
            const data = await res.json();
            if (Array.isArray(data)) {
                setHistory(data);
            }
        } catch (err) {
            console.error("Failed to fetch history:", err);
        } finally {
            setIsLoadingHistory(false);
        }
    };

    const getTodayCount = () => {
        if (history.length === 0) return 0;
        const mostRecent = history[0];
        const recordDate = new Date(mostRecent.timestamp).toDateString();
        const todayDate = new Date().toDateString();
        return recordDate === todayDate ? (mostRecent.count || 0) : 0;
    };

    return (
        <StationLayout
            stationType="testing"
            stationId={techId}
            navContent={<StationNav />}
            historyContent={
                <TechLogs 
                    history={history} 
                    isLoading={isLoadingHistory}
                    techId={techId}
                />
            }
        >
            <StationTesting 
                userId={techId}
                userName={techInfo.name}
                sheetId={sheetId}
                gid={gid}
                themeColor={techInfo.color}
                todayCount={getTodayCount()}
                onComplete={fetchHistory}
            />
        </StationLayout>
    );
}
