'use client';

import React, { useState } from 'react';
import ReceivingLogs from './station/ReceivingLogs';
import { AnimatePresence } from 'framer-motion';
import { ReceivingDetailsStack, ReceivingDetailsLog } from './station/ReceivingDetailsStack';
import { useQueryClient } from '@tanstack/react-query';

export default function ReceivingDashboard() {
    const [selectedLog, setSelectedLog] = useState<ReceivingDetailsLog | null>(null);
    const queryClient = useQueryClient();

    return (
        <div className="flex h-full w-full bg-white overflow-hidden">
            <div className="flex-1 flex flex-col min-w-0">
                <div className="flex-1 overflow-hidden">
                    {/* ReceivingLogs now self-fetches via TanStack Query with week navigation */}
                    <ReceivingLogs
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
                            // Targeted invalidation — no global event bus needed.
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
