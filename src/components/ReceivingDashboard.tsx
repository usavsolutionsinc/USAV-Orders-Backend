'use client';

import React, { useState } from 'react';
import ReceivingLogs from './station/ReceivingLogs';
import { AnimatePresence } from 'framer-motion';
import { ReceivingDetailsStack, ReceivingDetailsLog } from './station/ReceivingDetailsStack';

export default function ReceivingDashboard() {
    const [selectedLog, setSelectedLog] = useState<ReceivingDetailsLog | null>(null);

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
                            window.dispatchEvent(new CustomEvent('usav-refresh-data'));
                            window.dispatchEvent(new CustomEvent('receiving-focus-scan'));
                        }}
                        onDeleted={(_id) => {
                            setSelectedLog(null);
                            window.dispatchEvent(new CustomEvent('usav-refresh-data'));
                        }}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
