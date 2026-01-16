'use client';

import React, { useState, useEffect } from 'react';
import StationLayout from './station/StationLayout';
import StationNav from './station/StationNav';
import ReceivingLogs from './station/ReceivingLogs';
import ReceivingPanel from './ReceivingPanel';
import { Package, TrendingUp, Clock, AlertCircle } from './Icons';

export default function ReceivingDashboard() {
    const [history, setHistory] = useState<any[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);

    useEffect(() => {
        fetchHistory();
    }, []);

    const handleEntryAdded = () => {
        fetchHistory();
    };

    const fetchHistory = async () => {
        setIsLoadingHistory(true);
        try {
            // Fetch more data (500 records) to ensure accurate week counts
            const res = await fetch('/api/receiving-logs?limit=500');
            if (!res.ok) throw new Error('Failed to fetch');
            const data = await res.json();
            if (Array.isArray(data)) {
                setHistory(data);
            }
        } catch (err) {
            console.error("Failed to fetch receiving history:", err);
        } finally {
            setIsLoadingHistory(false);
        }
    };

    const getTodayCount = () => {
        if (history.length === 0) return 0;
        const today = new Date().toDateString();
        return history.filter(h => {
            const date = new Date(h.timestamp || '');
            return date.toDateString() === today;
        }).length;
    };

    const getWeekCount = () => {
        if (history.length === 0) return 0;
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        return history.filter(h => {
            const date = new Date(h.timestamp || '');
            return date >= weekAgo;
        }).length;
    };

    const getAverageTime = () => {
        if (history.length === 0) return '0m';
        
        const today = new Date().toDateString();
        const todayLogs = history.filter(h => {
            const date = new Date(h.timestamp || '');
            return date.toDateString() === today;
        }).sort((a, b) => {
            const dateA = new Date(a.timestamp);
            const dateB = new Date(b.timestamp);
            return dateA.getTime() - dateB.getTime();
        });

        if (todayLogs.length < 2) return '0m';

        const timeDiffs: number[] = [];
        for (let i = 1; i < todayLogs.length; i++) {
            const prevTime = new Date(todayLogs[i - 1].timestamp).getTime();
            const currTime = new Date(todayLogs[i].timestamp).getTime();
            const diffMinutes = (currTime - prevTime) / (1000 * 60);
            
            // Filter out gaps > 60 minutes (likely breaks)
            if (diffMinutes > 0 && diffMinutes <= 60) {
                timeDiffs.push(diffMinutes);
            }
        }

        if (timeDiffs.length === 0) return '0m';

        const avgMinutes = timeDiffs.reduce((sum, val) => sum + val, 0) / timeDiffs.length;
        return `${avgMinutes.toFixed(1)}m`;
    };

    return (
        <div className="flex h-full w-full">
            <StationNav />
            <ReceivingPanel onEntryAdded={handleEntryAdded} />
            <div className="flex-1 flex flex-col overflow-hidden">
                <ReceivingLogs 
                    history={history} 
                    isLoading={isLoadingHistory}
                />
            </div>
        </div>
    );
}
