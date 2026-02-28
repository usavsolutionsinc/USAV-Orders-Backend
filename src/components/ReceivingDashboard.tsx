'use client';

import React, { useState, useEffect } from 'react';
import ReceivingLogs from './station/ReceivingLogs';
import { AnimatePresence } from 'framer-motion';
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

    return (
        <div className="flex h-full w-full bg-white overflow-hidden">
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
