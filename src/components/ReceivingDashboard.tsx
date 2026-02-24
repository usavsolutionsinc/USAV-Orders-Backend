'use client';

import React, { useState, useEffect } from 'react';
import ReceivingLogs from './station/ReceivingLogs';
import ReceivingPanel from './ReceivingPanel';
import { AnimatePresence } from 'framer-motion';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/lib/timezone';
import { ReceivingDetailsStack, ReceivingDetailsLog } from './station/ReceivingDetailsStack';

export default function ReceivingDashboard() {
    const [history, setHistory] = useState<any[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [selectedLog, setSelectedLog] = useState<ReceivingDetailsLog | null>(null);

    useEffect(() => {
        fetchHistory();
    }, []);

    useEffect(() => {
        const handleRefresh = () => fetchHistory();
        window.addEventListener('usav-refresh-data', handleRefresh as any);
        return () => window.removeEventListener('usav-refresh-data', handleRefresh as any);
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
        const today = getCurrentPSTDateKey();
        return history.filter(h => {
            return toPSTDateKey(h.timestamp || '') === today;
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
        
        const today = getCurrentPSTDateKey();
        const todayLogs = history.filter(h => {
            return toPSTDateKey(h.timestamp || '') === today;
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
        <div className="flex h-full w-full bg-white overflow-hidden">
            <ReceivingPanel 
                onEntryAdded={handleEntryAdded} 
                todayCount={getTodayCount()}
                averageTime={getAverageTime()}
            />
            
            <div className="flex-1 flex flex-col min-w-0">
                {/* Dashboard Logs View */}
                <div className="flex-1 overflow-hidden">
                    <ReceivingLogs 
                        history={history} 
                        isLoading={isLoadingHistory}
                        onSelectLog={(log) => setSelectedLog(log)}
                        selectedLogId={selectedLog?.id || null}
                    />
                </div>
            </div>

            <AnimatePresence>
                {selectedLog && (
                    <ReceivingDetailsStack
                        log={selectedLog}
                        onClose={() => setSelectedLog(null)}
                        onUpdated={() => {
                            setSelectedLog(null);
                            fetchHistory();
                            window.dispatchEvent(new CustomEvent('receiving-focus-scan'));
                        }}
                        onDeleted={(id) => {
                            setSelectedLog(null);
                            setHistory((prev: any[]) => prev.filter((row) => String(row.id) !== String(id)));
                            window.dispatchEvent(new CustomEvent('usav-refresh-data'));
                        }}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
