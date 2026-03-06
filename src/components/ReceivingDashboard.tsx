'use client';

import React, { useEffect, useState } from 'react';
import ReceivingLogs from './station/ReceivingLogs';
import { AnimatePresence } from 'framer-motion';
import { ReceivingDetailsStack, type ReceivingDetailsLog } from './station/ReceivingDetailsStack';
import { useQueryClient } from '@tanstack/react-query';

export default function ReceivingDashboard() {
    const [selectedLog, setSelectedLog] = useState<ReceivingDetailsLog | null>(null);
    const queryClient = useQueryClient();

    // Mode 2 sidebar fires this event when a PENDING entry is clicked
    useEffect(() => {
        const handleSelectLog = (e: Event) => {
            const custom = e as CustomEvent<ReceivingDetailsLog>;
            if (custom.detail) setSelectedLog(custom.detail);
        };
        window.addEventListener('receiving-select-log', handleSelectLog);
        return () => window.removeEventListener('receiving-select-log', handleSelectLog);
    }, []);

    return (
        <div className="flex h-full w-full bg-white overflow-hidden">
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <ReceivingLogs
                    onSelectLog={(log) => setSelectedLog(log)}
                    selectedLogId={selectedLog?.id || null}
                />
            </div>

            <AnimatePresence>
                {selectedLog && (
                    <ReceivingDetailsStack
                        log={selectedLog}
                        onClose={() => setSelectedLog(null)}
                        onUpdated={() => {
                            setSelectedLog(null);
                            queryClient.invalidateQueries({ queryKey: ['receiving-logs'] });
                            window.dispatchEvent(new CustomEvent('receiving-focus-scan'));
                        }}
                        onDeleted={(_id) => {
                            setSelectedLog(null);
                            queryClient.invalidateQueries({ queryKey: ['receiving-logs'] });
                        }}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
